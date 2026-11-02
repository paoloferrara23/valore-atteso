// api/genera-edizione.js — Pipeline 3 fasi: Opus Writer → Opus Editor → salva
const { createClient } = require('@supabase/supabase-js');
const { requireAdminOrAgent, isAgent, serviceKey } = require('./_lib/admin-auth');
const { editorialChecks, appliesTo } = require('./_lib/editorial-checks');
const { guardedClient, AgentPermissionError } = require('./_lib/redazione-guard');
// Permessi dell'agente redazione: solo bozze. Nessun accesso a iscritti, a sent_*, a draft_token;
// nessun published, nessun insert/delete (api/_lib/redazione-guard.js).
const supabase = guardedClient(createClient(process.env.SUPABASE_URL, serviceKey() || process.env.SUPABASE_KEY));
const EDITION_COLS = 'id,num,title,subtitle,date,opener,sections,tags,published,factcheck,created_at';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const { logUsage } = require('./_lib/ai-usage');

// ── Chiamata Claude ───────────────────────────────────────────────────────────
async function callClaude(messages, system, model = 'claude-sonnet-4-6', maxTokens = 4000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  if (!r.ok) {
    const t = await r.text();
    if (/credit balance is too low|Plans & Billing|billing/i.test(t)) {
      throw new Error('Credito Anthropic esaurito. Ricarica su console.anthropic.com → Plans & Billing, poi riprova.');
    }
    throw new Error(`Anthropic ${r.status}: ${t.slice(0,200)}`);
  }
  const d = await r.json();
  logUsage('genera-edizione', model, d.usage);
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ── Leggi Wiki context da Supabase ────────────────────────────────────────────
async function getWikiContext() {
  try {
    const { data: rows } = await supabase
      .from('editorial_wiki')
      .select('categoria,chiave,valore')
      .order('categoria', { ascending: true });

    if (!rows || !rows.length) return '';

    const stile    = rows.filter(r => r.categoria === 'stile').map(r => `• ${r.chiave}: ${r.valore}`).join('\n');
    const edizioni = rows.filter(r => r.categoria === 'edizione').slice(-8).map(r => r.valore).join('\n');
    const club     = rows.filter(r => r.categoria === 'club_analizzato').slice(-20).map(r => r.valore).join('\n');
    const errori   = rows.filter(r => r.categoria === 'errore').map(r => r.valore).join('\n');

    return `=== WIKI EDITORIALE VALORE ATTESO ===

STILE E REGOLE:
${stile}

EDIZIONI PRECEDENTI (evita di ripetere stessi temi e club):
${edizioni}

CLUB GIÀ ANALIZZATI RECENTEMENTE:
${club}

ERRORI DA EVITARE (segnalati dall'editore):
${errori}

=== FINE WIKI ===`;
  } catch(e) {
    console.warn('Wiki non disponibile:', e.message);
    return '';
  }
}

// ── Parser JSON robusto ───────────────────────────────────────────────────────
function parseJSON(text) {
  const raw = text.replace(/```json|```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Nessun JSON trovato');
  return JSON.parse(
    match[0]
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/"((?:[^"\\]|\\.)*)"/g, (m, s) => '"' + s.replace(/\n/g, ' ').replace(/\r/g, '') + '"')
  );
}

// ── Prompt sezione ────────────────────────────────────────────────────────────
function sezionePrompt(label, scelta) {
  if (!scelta) return `${label}: (nessun tema selezionato)`;
  if (scelta.custom) return `${label}: "${scelta.custom}" (tema libero)`;
  return `${label}: "${scelta.titolo || scelta.title}"
Angolo: ${scelta.angolo || 'analitico'}
Sommario Scout: ${scelta.sommario || scelta.summary}
DATI VERIFICATI SCOUT (usa SOLO questi):
${(scelta.dati_chiave || scelta.kpi_preview || []).map(d => '• ' + d).join('\n')}
FONTE PRIMARIA: ${scelta.fonte_principale || scelta.source}`;
}

// ── Genera una singola sezione (chiamata breve, parallelizzabile) ──────────────
async function generaSezione(label, scelta, genSystem) {
  const prompt = `Genera la sezione "${label}" dell'edizione di Valore Atteso.

${sezionePrompt(label, scelta)}

Scrivi 180-250 parole, tono Valore Atteso "make it simple".
Rispondi SOLO JSON (nessun testo prima o dopo):
{"label":"${label}","title":"...","body":"...","kpis":[{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."}],"verdict":"...","sources":["fonte reale"]}`;
  const raw = await callClaude([{ role: 'user', content: prompt }], genSystem, 'claude-sonnet-4-6', 1600);
  return parseJSON(raw);
}


// ── Controlli editoriali bloccanti (dalla #027) ───────────────────────────────
// Dopo la generazione la bozza passa dai controlli deterministici (api/_lib/editorial-checks.js).
// Se uno fallisce, torna al modello con l'elenco degli errori (sezione per sezione, in parallelo, per
// restare nei 60 secondi); al massimo 2 giri. Il fact-check gira dopo (barriera 3) e la copertura dei
// numeri è verificata dalla barriera pre-invio: qui non si valuta (factcheck:false).
const MAX_ROUNDS = 2;
const ROUND_BUDGET_MS = 24000; // un giro parte solo se ne restano almeno ~30 dei 60 secondi

function candidateOf(draft, meta, sections, date) {
  return { num: draft.num, title: meta.title || '', subtitle: meta.subtitle || '', opener: meta.opener || '', date, tags: ['Il Bilancio', 'Il Deal', 'La Metrica'], sections, factcheck: null };
}

async function fixSezione(sec, errors, genSystem) {
  const prompt = `Correggi la sezione "${sec.label}" di Valore Atteso. I controlli automatici hanno trovato questi errori:
${errors.map(e => '- ' + e.message).join('\n')}

Regole: correggi SOLO questi punti, senza inventare dati; se una cifra non torna usa il valore corretto oppure toglila. Se un'espressione è ripetuta, riscrivila in modo diverso. Mantieni 3 KPI, le fonti e il formato. Niente testate nel testo.

SEZIONE ATTUALE:
${JSON.stringify(sec)}

Rispondi SOLO JSON con la stessa struttura: {"label":"${sec.label}","title":"...","body":"...","kpis":[{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."}],"verdict":"...","sources":["..."]}`;
  const raw = await callClaude([{ role: 'user', content: prompt }], genSystem, 'claude-sonnet-4-6', 1800);
  return parseJSON(raw);
}

async function fixTesta(meta, sections, errors, genSystem) {
  const prompt = `Correggi titolo, sottotitolo e apertura dell'edizione di Valore Atteso. I controlli automatici hanno trovato questi errori:
${errors.map(e => '- ' + e.message).join('\n')}

Regole: usa solo numeri presenti nelle sezioni, scritti con lo stesso valore; titolo al massimo 70 caratteri con un numero; sottotitolo al massimo 140; niente testate, anglicismi o toni sensazionalistici.

ATTUALE: ${JSON.stringify({ title: meta.title, subtitle: meta.subtitle, opener: meta.opener })}
SEZIONI: ${sections.map(s => `${s.label}: ${s.title} | KPI ${(s.kpis || []).map(k => k.value).join(', ')}`).join('\n')}

Rispondi SOLO JSON: {"title":"...","subtitle":"...","opener":"..."}`;
  const raw = await callClaude([{ role: 'user', content: prompt }], genSystem, 'claude-sonnet-4-6', 800);
  return parseJSON(raw);
}

async function controlliConCorrezione(draft, meta, sections, date, genSystem, t0) {
  let rounds = 0;
  let errors = [];
  for (;;) {
    const checks = editorialChecks(candidateOf(draft, meta, sections, date), { factcheck: false });
    errors = checks.filter(c => c.type === 'error');
    if (!errors.length || rounds >= MAX_ROUNDS || Date.now() - t0 > ROUND_BUDGET_MS) {
      return { sections, meta, rounds, errors, warnings: checks.filter(c => c.type === 'warning') };
    }
    rounds++;
    const bySec = [0, 1, 2].map(i => errors.filter(e => e.section === i));
    const head = errors.filter(e => e.section === undefined);
    const jobs = [0, 1, 2].map(i => (bySec[i].length && sections[i]
      ? fixSezione(sections[i], bySec[i], genSystem).catch(e => { console.warn('Correzione sezione fallita:', e.message); return sections[i]; })
      : Promise.resolve(sections[i])));
    const fixedSections = await Promise.all(jobs);
    sections = fixedSections.map((x, i) => ({ ...sections[i], ...x, label: sections[i].label }));
    if (head.length) {
      try { meta = { ...meta, ...(await fixTesta(meta, sections, head, genSystem)) }; }
      catch (e) { console.warn('Correzione testata fallita:', e.message); }
    }
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const t0 = Date.now();
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!requireAdminOrAgent(req, res)) return;

  try {
    const { editionId, bilancio, deal, metrica, date, hint, regenSezione } = req.body;
    if (!editionId) return res.status(400).json({ error: 'editionId obbligatorio' });
    // L'agente (x-agent-key) produce la bozza ma non rigenera sezioni già scritte: lo decide Paolo dalla Control Room.
    if (regenSezione && isAgent(req)) return res.status(403).json({ error: 'Rigenerazione non consentita all\'agente: usa la Control Room' });

    const { data: editions } = await supabase.from('editions').select(EDITION_COLS).eq('id', editionId).limit(1);
    if (!editions?.length) return res.status(404).json({ error: 'Bozza non trovata' });
    const draft = editions[0];

    // Leggi Wiki context
    const wikiContext = await getWikiContext();
    console.log(`Wiki context: ${wikiContext.length} caratteri`);

    // ── MODALITÀ: rigenera singola sezione ──────────────────────────────────
    if (regenSezione) {
      const sezIdx = { bilancio: 0, deal: 1, metrica: 2 }[regenSezione];
      if (sezIdx === undefined) return res.status(400).json({ error: 'Sezione non valida' });
      const sezLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
      const sezCorrente = draft.sections?.[sezIdx];
      if (!sezCorrente) return res.status(400).json({ error: 'Sezione non trovata' });

      // FASE 1: Writer
      const writerPrompt = `Riscrivi la sezione "${sezLabels[sezIdx]}" migliorando qualità e precisione.
TEMA ATTUALE: "${sezCorrente.title || sezCorrente.titolo}"
TESTO DA MIGLIORARE: ${JSON.stringify(sezCorrente)}

ISTRUZIONI: mantieni tema, migliora dati, aggiungi fonti se mancanti, rendi il verdict più incisivo.
Rispondi SOLO JSON: {"label":"${sezLabels[sezIdx]}","title":"...","body":"...","kpis":[{"label":"...","value":"...","sub":"..."},...],"verdict":"...","sources":["..."]}`;

      const writerRaw = await callClaude([{ role: 'user', content: writerPrompt }],
        `Sei il redattore senior di Valore Atteso.\n${wikiContext}`, 'claude-sonnet-4-6');

      // FASE 2: Editor
      const editorPrompt = `Revisiona criticamente questa sezione. Trova e correggi:
1. Dati non verificati → sostituisci con [dato da verificare]
2. Incoerenze con il tema
3. Linguaggio non professionale
4. KPI con valori inventati
5. Leggibilità ("make it simple"): spezza le frasi troppo lunghe, sciogli le subordinate annidate, spiega ogni tecnicismo in 3-5 parole, togli il tono da report. Mantieni il rigore e i dati: semplice = chiaro, non superficiale.
6. Competizioni europee e regole UEFA: se il testo afferma che un club è in Champions/Europa/Conference League o che è soggetto alle regole UEFA (Squad Cost Ratio 70%), verifica la coerenza con la stagione reale. Le regole UEFA valgono solo per i club nelle coppe UEFA; per gli altri valgono le regole domestiche (es. Premier League SCR 85%, PSR). Nel dubbio, sostituisci con [da verificare] o riformula senza l'affermazione.
7. Trattini lunghi: rimuovi OGNI trattino lungo (long dash e en dash) e riscrivi con virgole, due punti, punti o parentesi.

SEZIONE DA REVISIONARE:
${writerRaw}

Rispondi SOLO JSON migliorato con stessa struttura.`;

      const editorRaw = await callClaude([{ role: 'user', content: editorPrompt }],
        `Sei il direttore editoriale di Valore Atteso. Il tuo compito è trovare errori e rendere il testo più chiaro e leggibile (frasi brevi, niente gergo non spiegato) senza perdere rigore.\n${wikiContext}`,
        'claude-sonnet-4-6');

      const newSez = parseJSON(editorRaw);
      const sections = [...(draft.sections || [])];
      sections[sezIdx] = newSez;

      await supabase.from('editions').update({ sections }).eq('id', editionId);
      return res.status(200).json({ ok: true, id: editionId, sezione: regenSezione });
    }

    // ── MODALITÀ: genera bozza completa (singola chiamata Sonnet) ──────────

    console.log('Generazione bozza...');
    const genSystem = `Sei il redattore senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Pubblico: professionisti M&A, PE, consulenza, finanza — gente competente ma con poco tempo.

PRINCIPIO GUIDA — "MAKE IT SIMPLE" (è il nostro tratto distintivo: i lettori ci scelgono perché ci capiscono in 8 minuti col caffè):
Far capire in fretta cose complesse è il valore di Valore Atteso. Scrivi SEMPLICE senza diventare semplicistico:
- Frasi brevi, una idea per frase. Evita subordinate annidate e incisi lunghi.
- Italiano piano e voce attiva. Vai dritto al punto: prima la conclusione, poi i numeri che la reggono.
- Spiega ogni tecnicismo (EBITDA, plusvalenza, PFN, multiplo, player trading) con 3-5 parole tra parentesi la prima volta che compare.
- Parla come a un collega competente, non come un comunicato stampa o una nota di ricerca.
- Ogni numero seguito dal "quindi": cosa significa, perché conta.
Resta comunque Valore Atteso: rigoroso, analitico, basato su fonti. Semplice = chiaro, non superficiale.

TEST DEL CAFFÈ (obbligatorio — il lettore ci legge in 8 minuti, col caffè, prima di una riunione): ogni frase deve essere chiara alla PRIMA lettura.
- Una frase = una idea. Se una frase ha più di una virgola o va riletta per capirla, spezzala in due.
- MAI spiegare un termine difficile con un altro termine difficile (es. non spiegare "cartolarizzare" con "usare come collateral"). Usa parole di tutti i giorni.
- Massimo UN tecnicismo per paragrafo, sempre sciolto in linguaggio comune subito dopo.
- Prima la frase in parole povere, poi semmai il termine tecnico tra parentesi — non il contrario.
- Se un tema è troppo astratto per spiegarlo semplice con un esempio concreto, semplifica l'angolo: meglio UN punto chiaro che tre punti densi. La chiarezza batte la completezza.

REGOLE ASSOLUTE:
1. Usa SOLO i dati forniti dallo Scout — ZERO dati inventati
2. I KPI devono venire esclusivamente dai "DATI VERIFICATI SCOUT"
3. Le fonti devono corrispondere alle "FONTI PRIMARIE" dello Scout
4. Se un dato non è nei dati Scout scrivi [dato da verificare]
5. Scrivi analitico ma LEGGIBILE (vedi "Make it simple"): frasi corte, nessun gergo non spiegato, mai tono da report o da comunicato
6. I dati finanziari devono avere contesto — ogni numero deve spiegare perché conta
7. Le tre sezioni non devono contraddirsi né ripetere gli stessi dati
8. FONTI PER CLASSE (regola dalla #027). Classi ammesse, in ordine di forza: UFFICIALE (comunicati e bilanci dei club, UEFA, FIFA, leghe, federazioni, società quotate: basta da solo); REPORT AUTOREVOLE (Deloitte, KPMG, PwC, EY e report pubblici di consulenze e fondi, con report e anno: basta da solo); STAMPA AUTOREVOLE (agenzie e grandi testate: va confermata da almeno un'altra fonte autorevole, altrimenti scrivi con cautela, ad esempio "secondo quanto riportato", SENZA nominare la testata); NON VERIFICATO (blog, social, aggregatori, siti di scommesse, newsletter di terzi, tutto il resto: NON può uscire). Mai nominare testate, agenzie o social nel testo, nemmeno come attribuzione: la fonte va solo nel campo "sources". Nessun blocco "Fonti" e nessun link nel testo. STIME: se un dato esiste solo come stima, resta generico (la cifra non è stata resa nota) senza riportarla. Se due fonti autorevoli si contraddicono dichiaralo nel testo oppure togli il dato. FORMATO "sources": documento + emittente + data, pulito, niente URL. Es: "AC Milan, Bilancio 2025/26, 28/09/2026"; "Deloitte, Football Money League 2026".
9. Ogni sezione: 180-250 parole, 3 KPI dai dati Scout, verdict incisivo, fonti reali
10. FORMATO KPI — i "key financials" devono essere CORTI. Il campo "value" è SOLO una cifra compatta con unità (es. "€13 mld", "70%", "£100M", "3,3 mld $", "104"), MAI una frase, max ~12 caratteri. Il contesto va nel "sub" (max ~30 caratteri). Il "label" è breve (max ~24 caratteri). Se un dato non è esprimibile in cifra breve, non usarlo come KPI.
11. COMPETIZIONI EUROPEE E REGOLE APPLICABILI — verifica prima di affermare: NON dare per scontato che un club giochi in Champions/Europa/Conference League. Le regole finanziarie UEFA (Fair Play Finanziario, Squad Cost Ratio 70%) valgono SOLO per i club iscritti alle competizioni UEFA di quella stagione. Per i club fuori dall'Europa valgono le regole domestiche (es. Premier League: Squad Cost Ratio 85%, PSR). Se lo status europeo di un club per la stagione in corso non è tra i DATI VERIFICATI SCOUT, NON affermarlo e non dedurne conseguenze regolamentari: scrivi [da verificare] oppure ometti.
12. PUNTEGGIATURA: VIETATO usare trattini lunghi (i caratteri long dash e en dash). Vale per corpo, titoli, KPI e verdict. Al loro posto usa virgole, due punti, punti o parentesi. Sono ammessi solo i trattini brevi dentro le parole o negli intervalli (es. post-Mondiale, 10-15M).
13. CONTROLLI AUTOMATICI (bloccanti, dalla #027): il testo viene ricontrollato da regole deterministiche. Rispettale subito. (a) Aritmetica: ogni differenza, rapporto, percentuale o divisione (per anni, per club) deve tornare e lo stesso valore deve comparire uguale in titolo, sottotitolo, apertura, testo, KPI e verdetto. Se tra due cifre c'è un salto (es. utile ordinario e risultato netto), scrivi il salto corretto, non un'altra cifra. (b) Date e stagioni coerenti: la stagione dei conti approvati è una sola in tutta la sezione; gli altri anni solo come confronto esplicito ("rispetto al 2024/25"). (c) Niente link, niente nomi di testate o social, niente blocco "Fonti". (d) Italiano senza anglicismi: niente deal, co-owned, mandate, exit, D2C, break-even, split, naming rights, asset, benchmark (usa accordo, contratto, in comproprietà, uscita, pareggio dei costi, diviso, diritti sul nome, patrimonio, confronto); zero nei titoli, al massimo 2 termini tecnici spiegati nel corpo. (e) Tono sobrio da analisi: vietati "basta un infortunio", "crollo", "disastro", "bruciato", "record d'Europa" e simili senza un dato verificato. (f) Il titolo dell'edizione è lungo al massimo 70 caratteri e contiene un numero verificato; il sottotitolo al massimo 140. (g) La Metrica ruota attorno a UN numero; il Deal attorno a un accordo; il Bilancio attorno a un conto economico; Deal e Metrica trattano temi diversi. (h) I tre verdetti hanno attacco e struttura diversi (mai "Per un advisor..." e "Per chi siede al tavolo..." insieme) e nessuna espressione è ripetuta tra testo e verdetto o tra sezioni. (i) Esattamente 3 KPI per sezione, con lo stesso valore scritto nel testo.
14. IMPAGINAZIONE DEL BODY: dividi ogni body in paragrafi brevi (2-4 frasi ciascuno), separati da una riga vuota (doppio a-capo tra un paragrafo e l'altro). Mai un unico blocco compatto: la spaziatura tra paragrafi rende la lettura più leggera e scorrevole.

${wikiContext}`;

    const sysConHint = hint ? `${genSystem}\n\nNOTA EDITORIALE PER QUESTA EDIZIONE: ${hint}` : genSystem;

    // Le tre sezioni in parallelo: chiamate brevi → restano sotto i 60s del piano Hobby
    const [secBilancio, secDeal, secMetrica] = await Promise.all([
      generaSezione('Il Bilancio', bilancio, sysConHint),
      generaSezione('Il Deal',     deal,     sysConHint),
      generaSezione('La Metrica',  metrica,  sysConHint),
    ]);
    let sections = [secBilancio, secDeal, secMetrica];
    console.log('3 sezioni generate.');

    // Meta (titolo/sottotitolo/opener): chiamata breve a valle delle sezioni
    const metaPrompt = `Genera titolo, sottotitolo e opener per l'edizione #${draft.num} di Valore Atteso.

I tre temi dell'edizione:
- Il Bilancio: ${secBilancio.title}
- Il Deal: ${secDeal.title}
- La Metrica: ${secMetrica.title}

L'opener è 2-3 frasi che legano i tre temi e invogliano a leggere, tono Valore Atteso "make it simple".

Per l'email servono anche:
- "preheader": una frase di 85-100 caratteri, senza puntini finali, con i numeri chiave.
- "tesi": tre frasi (una per sezione, nell'ordine Bilancio, Deal, Metrica), max 110 caratteri ciascuna, che dicono cosa significa il numero principale della sezione.
- "da_guardare": tre frasi brevi (una per sezione) su cosa seguire nelle prossime settimane: date, scadenze, documenti attesi.
Usa solo numeri presenti nelle sezioni, senza arrotondarli. Non nominare mai testate, agenzie o social. Niente trattino lungo.

Sezioni complete:
${sections.map(s => `${s.label}: ${s.title}\nKPI: ${(s.kpis || []).map(k => `${k.label} ${k.value}`).join('; ')}\n${String(s.body || '').slice(0, 1200)}`).join('\n\n')}

Rispondi SOLO JSON: {"title":"...","subtitle":"...","opener":"...","preheader":"...","tesi":["...","...","..."],"da_guardare":["...","...","..."]}`;
    let meta = { title: `Edizione #${draft.num}`, subtitle: '', opener: '' };
    try {
      const metaRaw = await callClaude([{ role: 'user', content: metaPrompt }], genSystem, 'claude-sonnet-4-6', 1200);
      meta = parseJSON(metaRaw);
    } catch (e) { console.warn('Meta non generata:', e.message); }

    // ── Controlli editoriali bloccanti (dalla #027) ──────────────────────────
    const editionDate = date || draft.date;
    let controlli = null;
    if (appliesTo(draft.num)) {
      const r = await controlliConCorrezione(draft, meta, sections, editionDate, genSystem, t0);
      sections = r.sections;
      meta = r.meta;
      controlli = { passed: r.errors.length === 0, rounds: r.rounds, errors: r.errors.map(e => e.message), warnings: r.warnings.map(e => e.message) };
      console.log(`Controlli editoriali: ${controlli.passed ? 'superati' : r.errors.length + ' errori residui'} (giri: ${r.rounds}).`);
    }

    // ── Salva bozza (sempre in bozza: published non si tocca) ───────────────
    await supabase.from('editions').update({
      title:    meta.title || `Edizione #${draft.num}`,
      subtitle: meta.subtitle || '',
      opener:   meta.opener || '',
      sections,
      date:     editionDate,
    }).eq('id', editionId);

    // Campi del template email (colonna `email`): in un update separato, così un errore
    // qui non perde la bozza. Se mancano, il template usa sottotitolo e titoli delle sezioni.
    try {
      const str = v => (typeof v === 'string' ? v.trim() : '');
      const tesi = Array.isArray(meta.tesi) ? meta.tesi.map(str) : [];
      const watch = (Array.isArray(meta.da_guardare) ? meta.da_guardare.map(str) : [])
        .map((text, i) => ({ label: sections[i] && sections[i].label, text }))
        .filter(w => w.label && w.text);
      const email = {
        ...(str(meta.preheader) ? { preheader: str(meta.preheader) } : {}),
        summary: sections.map((_, i) => (tesi[i] ? { thesis: tesi[i] } : {})),
        watch,
      };
      const { error: emErr } = await supabase.from('editions').update({ email }).eq('id', editionId);
      if (emErr) console.warn('Campi email non salvati:', emErr.message);
    } catch (e) { console.warn('Campi email non salvati:', e.message); }

    console.log(`Bozza #${draft.num} generata.`);
    return res.status(200).json({
      ok: true,
      id: editionId,
      title: meta.title,
      ...(controlli ? { controlli } : {})
    });

  } catch (e) {
    console.error('[genera-edizione]', e);
    if (e instanceof AgentPermissionError) return res.status(403).json({ error: e.message });
    return res.status(500).json({ error: e.message });
  }
};
