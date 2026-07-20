// scripts/scout.js — Scout Agent v2.1
// Web search libero su fonti certificate → verifica con Drive → brief + approvazione

const crypto = require('crypto');
const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');
const { logUsage } = require('../lib/ai-usage');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const SITE_URL       = process.env.SITE_URL || 'https://valoreatteso.com';
const DRIVE_API_KEY  = process.env.GOOGLE_DRIVE_API_KEY;
const DRIVE_FOLDER   = process.env.GOOGLE_DRIVE_FOLDER_ID;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

// ── Siti di riferimento prioritari (non esclusivi) ───────────────────────────
const SITI_PRIORITARI = `
PRIORITÀ ALTA (fonti istituzionali e specializzate):
deloitte.com, footballbenchmark.com, uefa.com, figc.it, fifa.com, pwc.com,
kpmg.com, registroimprese.it, borsaitaliana.it, football-observatory.com,
calcioefinanza.it, swissramble.substack.com, theesk.org, offthepitch.com,
sportico.com, sportspro.com, frontofficesports.com, capology.com

PRIORITÀ MEDIA (finanza e business generalista):
ft.com, reuters.com, bloomberg.com, ilsole24ore.com, forbes.com,
pe-insights.com, lazard.com, apollo.com, aresmgmt.com, cliffordchance.com,
secretariat-intl.com, europeanbusinessmagazine.com

ACCETTATE se rilevanti (altri media riconosciuti):
qualsiasi testata giornalistica o istituzione finanziaria/sportiva riconosciuta
a livello internazionale, purché la notizia sia verificabile e la fonte citabile.
NON accettate: blog personali, forum, social media, siti senza firma editoriale.`;

async function callClaude(messages, system, useSearch = false, model = 'claude-sonnet-4-6') {
  const body = {
    model,
    max_tokens: 6000,
    system,
    messages
  };
  if (useSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    body.tool_choice = { type: 'auto' };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Anthropic ${r.status}: ${t.slice(0,300)}`); }
  const data = await r.json();
  logUsage('scout', model, data.usage);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function supaUpsert(key, value, writtenBy) {
  await fetch(`${SUPA_URL}/rest/v1/agent_memory?on_conflict=key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ key, value, written_by: writtenBy, updated_at: new Date().toISOString() })
  });
}

// ── Leggi PDF da Google Drive ────────────────────────────────────────────────
async function leggiDrive() {
  if (!DRIVE_API_KEY || !DRIVE_FOLDER) {
    console.log('Drive non configurato — skip');
    return { files: [], context: '' };
  }

  try {
    // Lista file nella cartella
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=%27${DRIVE_FOLDER}%27+in+parents&key=${DRIVE_API_KEY}&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime+desc&pageSize=20`;
    const listRes = await fetch(listUrl);
    if (!listRes.ok) throw new Error(`Drive list: ${listRes.status}`);
    const listData = await listRes.json();
    const files = listData.files || [];

    console.log(`Drive: ${files.length} file trovati`);
    if (!files.length) return { files: [], context: '' };

    // Per ogni PDF estrai il testo via export
    const contenuti = [];
    for (const file of files.slice(0, 10)) { // max 10 file
      try {
        let testo = '';
        if (file.mimeType === 'application/pdf') {
          // Scarica come testo plain
          const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&key=${DRIVE_API_KEY}`;
          const exportRes = await fetch(exportUrl);
          if (exportRes.ok) {
            const rawText = await exportRes.text();
            // Prendi solo i primi 3000 caratteri per non saturare il contesto
            testo = rawText.replace(/\s+/g, ' ').trim().slice(0, 3000);
          }
        } else if (file.mimeType.includes('google-apps.document')) {
          const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&key=${DRIVE_API_KEY}`;
          const exportRes = await fetch(exportUrl);
          if (exportRes.ok) {
            testo = (await exportRes.text()).slice(0, 3000);
          }
        } else {
          // File non PDF/Doc — solo metadati
          testo = `[file binario — solo metadati disponibili]`;
        }
        contenuti.push({ nome: file.nome || file.name, testo, modificato: file.modifiedTime?.slice(0,10) });
      } catch (e) {
        console.warn(`Errore lettura ${file.name}:`, e.message);
      }
    }

    const context = contenuti
      .filter(c => c.testo && c.testo.length > 100)
      .map(c => `\n--- BIBLIOTECA VA: ${c.nome} (${c.modificato}) ---\n${c.testo}\n`)
      .join('\n');

    console.log(`Drive: ${contenuti.length} file letti, ${context.length} caratteri di contesto`);
    return { files: contenuti.map(c => c.nome), context };

  } catch (e) {
    console.error('Errore Drive:', e.message);
    return { files: [], context: '' };
  }
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ── Leggi lo storico dei temi dalle edizioni gia pubblicate (tabella editions) ──
async function leggiWiki() {
  if (!SUPA_URL || !SUPA_KEY) return '';
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/editions?published=eq.true&select=num,title,subtitle,sections&order=num.desc&limit=20`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    if (!r.ok) return '';
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return '';
    const lista = rows.map(e => {
      let temi = '';
      try {
        if (Array.isArray(e.sections)) {
          temi = e.sections.map(s => ((s.label ? s.label + ': ' : '') + (s.title || ''))).filter(Boolean).join(' · ');
        }
      } catch (_) {}
      return `#${e.num} — ${e.title}${e.subtitle ? ' | ' + e.subtitle : ''}${temi ? '\n   (' + temi + ')' : ''}`;
    }).join('\n');
    return `\n\nEDIZIONI GIÀ PUBBLICATE — TEMI/CLUB/DEAL DA NON RIPETERE:\nNON riproporre nessun club, deal, operazione, metrica o angolo gia trattato qui sotto. Un tema si puo riprendere SOLO se questa settimana e successo qualcosa di NUOVO, con dati nuovi e datati. Mai la stessa notizia.\n${lista}`;
  } catch(e) {
    console.warn('Storico edizioni fetch error:', e.message);
    return '';
  }
}

// ── Contesto stagionale dinamico ─────────────────────────────────────────
function contestoStagionale() {
  const now = new Date();
  const m = now.getMonth() + 1; // 1-12
  const y = now.getFullYear();

  const eventi = [];

  // Mondiale 2026 (giugno–luglio 2026)
  if (y === 2026 && (m === 6 || m === 7)) {
    eventi.push(`MONDIALE 2026 (giugno–luglio 2026) — PRIORITÀ MASSIMA, È L'EVENTO DEL MOMENTO:
  Il torneo è nel vivo (fase a eliminazione diretta / finale): è ciò di cui parla il mondo intero ADESSO. I lettori si aspettano da noi la LETTURA ECONOMICA di quello che stanno guardando — se è appena stata giocata la finale, l'angolo money della finale è quasi obbligato.
  Angoli business: montepremi FIFA e premio al vincitore (e impatto sui bilanci dei club di appartenenza dei giocatori), ricavi FIFA record del ciclo, Club Benefits Programme (compenso ai club per il rilascio dei nazionali), diritti TV per area geografica, attivazioni e ROI degli sponsor (Adidas, Coca-Cola, Visa, ecc.), economia delle città ospitanti e della finale, uplift commerciale e valore di mercato dei protagonisti, biglietteria e hospitality USA/Canada/Messico.
  L'ANGOLO VA: non la cronaca della partita, ma cosa significa in soldi — per club, investitori, sponsor, advisor.`);
  }

  // Mercato trasferimenti estivo
  if (m === 6 || m === 7 || m === 8) {
    eventi.push(`MERCATO ESTIVO APERTO (1 luglio – 31 agosto): cerca deal in corso o attesi, multipli EV/ricavi pagati, struttura equity/earn-out, ruolo fondi PE nel finanziamento acquisti.`);
  }

  // Fine stagione / bilanci annuali
  if (m === 5 || m === 6) {
    eventi.push(`FINE STAGIONE EUROPEA: bilanci annuali club in uscita, Revenue da Champions/Europa League, impatto PSR/FFP sui prossimi acquisti.`);
  }

  // Mercato invernale
  if (m === 1) {
    eventi.push(`MERCATO INVERNALE (gennaio): deal last-minute, prestiti con opzione, impatto su salary cap.`);
  }

  // Champions League finale / knockout
  if (m === 4 || m === 5) {
    eventi.push(`FASE FINALE CHAMPIONS LEAGUE: impatto economico dei quarti/semifinali/finale — distribuzione UEFA, premium TV, valorizzazione club.`);
  }

  // Fair play finanziario (scadenze tipiche settembre)
  if (m === 8 || m === 9) {
    eventi.push(`FAIR PLAY FINANZIARIO: UEFA pubblica aggiornamenti PSR/FFP — sanzioni, restrizioni mercato, compliance club Serie A/Premier.`);
  }

  if (!eventi.length) return '';
  return `\n\nCONTESTO STAGIONALE ATTUALE — cerca prioritariamente notizie legate a questi eventi:\n${eventi.join('\n')}`;
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const settimana = new Date().toLocaleDateString('it-IT');
  const setteGiorniFa = new Date(Date.now() - 7*86400000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  console.log('Scout v2.1 avviato:', new Date().toISOString());

  // ── Fase 1: Leggi biblioteca Drive + wiki storico + contesto stagionale ─
  const [{ files: driveFiles, context: driveContext }, wikiContext] = await Promise.all([leggiDrive(), leggiWiki()]);
  const stagionale = contestoStagionale();
  console.log('Contesto stagionale:', stagionale ? stagionale.slice(0, 100) + '...' : 'nessuno');

  const driveInfo = driveFiles.length > 0
    ? `\n\nBIBLIOTECA VA — DOCUMENTI CARICATI DA PAOLO (usa per verificare/integrare i numeri trovati online):\n${driveContext}\n\nFile disponibili: ${driveFiles.join(', ')}`
    : '\n\n[Nessun documento nella biblioteca Drive — usa solo fonti web]';

  // ── Fase 2: Web search ───────────────────────────────────────────────────
  console.log('Wiki storico:', wikiContext ? `${wikiContext.length} caratteri` : 'non disponibile');
  console.log('Fase 2: ricerca web...');

  const system = `Sei lo Scout senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Target lettori: professionisti M&A, PE, consulenza, finanza.

COMPITO QUESTA SETTIMANA:
1. Cerca con web search le notizie più rilevanti degli ultimi 7 giorni sul business del calcio europeo
2. Per ogni dato finanziario trovato online, verifica se c'è conferma nei documenti della Biblioteca VA
3. Genera un brief con raccomandazione singola forte + brief narrativo per Paolo

FRESCHEZZA E NON-RIDONDANZA — REGOLA INDEROGABILE:
- Ogni tema DEVE essere ancorato a un evento SPECIFICO e DATATO degli ULTIMI 7 GIORNI (dal ${setteGiorniFa} a oggi ${oggi}). Vietati i temi sempreverdi (es. "il debito della Juventus", "i ricavi del Real") senza una notizia NUOVA di questa settimana.
- VIETATO riproporre club, deal, operazioni o metriche gia trattati nelle edizioni passate (elenco in fondo al prompt). Se non c'e una novita fresca su un club, NON proporlo.
- Spazia oltre i soliti top club: cerca anche club minori, leghe, fondi, normativa, diritti TV, sponsor, stadi, naming rights — purche con angolo finanziario e data recente.
- Se la settimana e davvero povera di notizie finanziarie, dillo nel brief: meglio un solo tema solido che tre riciclati.

FONTI WEB:
${SITI_PRIORITARI}

TEMI DA CERCARE (in ordine di interesse per Valore Atteso):
- Bilanci club: risultati finanziari, ricavi, perdite, wage ratio, FFP/PSR
- M&A e deal: acquisizioni, fondi PE, cessioni quote, valutazioni, multipli
- Diritti TV: rinnovi, aste, nuovi deal broadcasting  
- Governance: cambi proprietà, CDA, ristrutturazioni debito
- Trasferimenti: solo se >€50M o con struttura deal interessante
- KPI settoriali: dati comparativi leghe/club

METODOLOGIA CF OBBLIGATORIA:
- Cita multipli reali (EV/Revenue, EV/EBITDA, Price/Sales) quando disponibili
- Confronta con benchmark (Premier wage ratio 64%, Serie A 64%, Bundesliga 58%)
- Valuta impatto FFP/PSR (limite UEFA: -€60M nel triennio)
- Per deal: struttura equity/debt, earn-out, governance
- Per bilanci: scomponi matchday/broadcasting/commercial

REGOLA FONTI — INDEROGABILE:
- Cita SEMPRE la fonte con link diretto all'articolo specifico
- Se un numero è confermato dalla Biblioteca VA, aggiungi "✓ confermato da Biblioteca VA — [nome doc]"
- Se non hai fonte verificabile per un dato, non includerlo
- ESCLUDI: gossip mercato, risultati sportivi puri, notizie senza dati verificabili

FONTI PRIMARIE OBBLIGATORIE PER DATI FINANZIARI:
- Bilanci club: cerca SEMPRE il documento ufficiale pubblicato sul sito del club o su Borsa Italiana
  (es. juventus.com, inter.it/investor-relations, asroma.com) o FIGC/UEFA
- Dati di sistema (debito Serie A, perdite aggregate): usa FIGC Report sul Calcio, Deloitte Football Money League
- Deal e M&A: usa comunicato ufficiale del club o comunicato stampa Borsa Italiana
- DDL e normativa: usa testi parlamentari ufficiali o Sky Sport / Milano Finanza come fonte secondaria
- NON usare aggregatori come fonte primaria per dati finanziari
- Calcio e Finanza è un competitor — usala come fonte di ricerca ma NON citarla esplicitamente nei dati chiave

TONE E ANGOLO EDITORIALE:
- Il tono di Valore Atteso è analitico ma leggibile — non un report, non un comunicato stampa
- I dati finanziari devono essere precisi e verificati, mai approssimati o inventati
- Ogni tema deve avere un angolo M&A/PE/finanza chiaro — non solo la notizia ma l'implicazione per un advisor
- Le sezioni della stessa edizione non devono contraddirsi o ripetere gli stessi dati
- Preferire spunti di riflessione su implicazioni finanziarie rispetto alla cronaca pura
${stagionale}${driveInfo}${wikiContext}

Rispondi SOLO in JSON valido:
{
  "settimana": "${settimana}",
  "biblioteca_usata": ["nomi doc usati per verifica, se applicabile"],
  "temi": [
    {
      "titolo": "titolo editoriale preciso e incisivo",
      "notizia": "2-3 righe: cosa è successo, quando, chi",
      "analisi_cf": "lettura finanziaria: multipli, ratios, implicazioni per investitori/advisor",
      "sezione_suggerita": "bilancio|deal|metrica",
      "priorita": 1,
      "dati_chiave": ["dato con fonte", "dato2 con fonte"],
      "fonti": ["Testata — Titolo articolo — DD/MM/YYYY — https://url-diretto"],
      "verifica_biblioteca": "dato confermato da [nome doc] / non presente in biblioteca / N/A"
    }
  ],
  "raccomandazione": {
    "tema": "IL tema della settimana — uno solo, il più forte per VA",
    "sezione": "bilancio|deal|metrica",
    "perche": "2-3 righe: perché questo è il tema più rilevante questa settimana per un lettore M&A/PE",
    "angolo_editoriale": "l'angolo preciso da cui trattarlo",
    "dati_ancora": ["i 2-3 dati chiave da sviluppare nell'edizione"]
  },
  "temi_per_sezione": {
    "bilancio": [
      {"titolo": "...", "sommario": "2-3 righe: angolo di analisi e perché è rilevante ora", "dati_chiave": ["dato con fonte", "dato2"], "fonte_principale": "Testata — titolo — data — url", "angolo": "es. redditività / indebitamento / player trading"},
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."},
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."}
    ],
    "deal": [
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."},
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."},
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."}
    ],
    "metrica": [
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."},
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."},
      {"titolo": "...", "sommario": "...", "dati_chiave": ["..."], "fonte_principale": "...", "angolo": "..."}
    ]
  },
  "brief_narrativo": "3-4 righe come se mi stessi parlando: cosa ha dominato la settimana, il fil rouge, cosa vale approfondire",
  "note_editoriali": "temi da evitare, angoli da considerare, contesto stagionale"
}`;

  // FASE 1: Ricerca web — output testo libero (no JSON) — modello forte + web search
  const testoRicerca = await callClaude([{
    role: 'user',
    content: `Oggi è ${oggi}.${stagionale ? '\n\nEVENTI PRIORITARI ORA:\n' + stagionale.replace(/\n\nCONTESTO STAGIONALE ATTUALE[^\n]*\n/,'') : ''}

Fai una ricerca web APPROFONDITA (usa più query diverse) e trova ALMENO 8-10 notizie DISTINTE e fresche degli ultimi 7 giorni sul business del calcio europeo. Devono bastare per riempire con qualità 3 sezioni (Bilancio, Deal, Metrica) con più opzioni ciascuna, quindi non fermarti alle prime 3-4 che trovi: scava.

PARTI DALL'ATTUALITÀ — CATTURA IL MOMENTO (regola prioritaria): identifica prima di tutto gli eventi che DOMINANO la conversazione calcistica di questi 7 giorni — una finale (es. la finale del Mondiale), un big match decisivo, un annuncio o un'operazione di cui parlano tutti — e trovane l'angolo FINANZIARIO. I lettori vogliono l'analisi economica di ciò che stanno GIÀ seguendo: un grande evento di attualità con un buon angolo money vale più di una notizia di nicchia. Chiediti: "di cosa parla il calcio questa settimana?" e portaci il numero dietro.

COSA RENDE UN TEMA "INTERESSANTE" PER VALORE ATTESO (privilegia questi):
- Angolo NON ovvio: il "follow the money" dietro una notizia che il tifoso medio legge come cronaca sportiva.
- Struttura finanziaria: come è fatto un deal (equity/debito/earn-out/clausole), non solo la cifra.
- Contabilità nascosta: plusvalenze, ammortamenti, player trading, svalutazioni, gestione FFP/PSR.
- Soldi dei fondi: PE/private credit/sovereign che entrano nel calcio, multipli pagati, tesi di investimento.
- Arbitraggio normativo e regolatorio: chi sfrutta o subisce UEFA/FIGC/leghe.
- Club minori, leghe emergenti, diritti TV, naming rights, stadi, sponsor: non solo i soliti top club.
- Storie di distress: club in crisi di liquidità, ristrutturazioni, cessioni forzate.

Spazia tra Serie A, Premier, Liga, Bundesliga, Ligue 1 e oltre.

FILTRO ANTI-RIDONDANZA (OBBLIGATORIO — è il problema n.1 da risolvere): in fondo al system c'è l'elenco delle EDIZIONI GIÀ PUBBLICATE. Per OGNI tema candidato confrontalo con quell'elenco: se lo stesso club, deal, operazione, persona o metrica è già stato trattato e NON c'è una novità concreta e DATATA in questi 7 giorni, SCARTALO. In caso di dubbio, scarta. Per ogni tema che tocca un'entità già vista, scrivi esplicitamente "NOVITÀ DI QUESTA SETTIMANA: [fatto nuovo + data]"; se non riesci a scriverla, il tema è ridondante e va eliminato. Meglio pochi temi davvero nuovi che tanti riciclati.

Per OGNI tema riporta: titolo editoriale incisivo, cosa è successo (con data), fonte con URL diretto, 2-3 dati finanziari chiave, la lettura CF (multipli/ratios/implicazione per un advisor M&A/PE), e la sezione suggerita (bilancio/deal/metrica). Scrivi in italiano, testo semplice discorsivo, NON JSON.`
  }], system, true, 'claude-opus-4-8');

  console.log('Fase 1 completata, testo:', testoRicerca.slice(0, 200));

  // FASE 2: Conversione in JSON — chiamata separata senza web search
  const testoRicercaShort = testoRicerca.slice(0, 16000); // contesto ampio per non perdere temi
  const jsonPrompt = `Converti questo brief Scout in JSON valido, SENZA perdere ricchezza: riporta più opzioni possibili (idealmente 4 per sezione) tra quelle presenti nel brief.

REGOLE JSON:
- Italiano naturale con accenti e apostrofi: sono ammessi (in JSON l'apostrofo NON va escapato).
- L'UNICA cosa vietata dentro una stringa è la virgoletta doppia " non escapata e gli a-capo: se servono, riscrivi la frase.
- Il "sommario" deve essere ricco e specifico (1-2 frasi, ~200-280 caratteri): angolo di analisi + perché è rilevante ORA. Niente riassunti generici.
- Ogni tema deve avere dati_chiave concreti (numeri con contesto) e fonte_principale con URL.
- Non inventare: usa solo temi e dati presenti nel brief. Se una sezione ha meno di 4 temi validi nel brief, mettine meno (meglio 2 solidi che 4 riempitivi).

BRIEF:
${testoRicercaShort}

JSON richiesto (fino a 4 oggetti per sezione):
{
  "settimana": "${settimana}",
  "temi_per_sezione": {
    "bilancio": [{"titolo":"titolo incisivo","sommario":"1-2 frasi ricche sull'angolo di analisi e perché conta ora","dati_chiave":["dato con contesto","dato2"],"fonte_principale":"testata - titolo - data - url","angolo":"es. redditività / player trading / indebitamento"},{"...":"..."}],
    "deal": [{"...":"..."}],
    "metrica": [{"...":"..."}]
  },
  "brief_narrativo": "3-4 frasi: cosa ha dominato la settimana e il fil rouge",
  "raccomandazione": {"tema":"il tema più forte","sezione":"bilancio","perche":"2-3 frasi","angolo_editoriale":"l'angolo preciso"},
  "note_editoriali": "temi da evitare / contesto"
}`;

  // ── Fase 2b: Genera JSON ─────────────────────────────────────────────────
  const jsonSystemSimple = 'Sei un convertitore JSON. Rispondi SOLO con JSON valido. Nessun testo aggiuntivo.';
  let jsonPrompt_result = '';
  try {
    jsonPrompt_result = await callClaude([{ role: 'user', content: jsonPrompt }], jsonSystemSimple, false);
    console.log('JSON generato, length:', jsonPrompt_result.length);
  } catch(e) {
    console.error('Generazione JSON fallita:', e.message);
    jsonPrompt_result = '{}';
  }

    // ── Fase 3: Parse ────────────────────────────────────────────────────────
  let brief;
  try {
    const raw = jsonPrompt_result.replace(/```json|```/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Nessun JSON');
    brief = JSON.parse(
      match[0]
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/"((?:[^"\\]|\\.)*)"/g, (m, s) => '"' + s.replace(/\n/g, ' ').replace(/\r/g, '') + '"')
    );
  } catch (e) {
    console.warn('Retry JSON...', e.message);
    const retry = await callClaude([
      { role: 'user', content: `Oggi è ${oggi}. Brief Scout per Valore Atteso in JSON valido.` },
      { role: 'assistant', content: testoRicerca },
      { role: 'user', content: 'JSON malformato. Rispondi SOLO con JSON valido, nessun testo aggiuntivo.' }
    ], system);
    const m2 = retry.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!m2) throw new Error('JSON non valido dopo retry');
    brief = JSON.parse(m2[0].replace(/[\x00-\x1F\x7F]/g, ' ').replace(/,(\s*[}\]])/g, '$1'));
  }

  // Valida temi_per_sezione
  if (!brief) brief = {};
  if (!brief.temi_per_sezione) brief.temi_per_sezione = { bilancio: [], deal: [], metrica: [] };
  ['bilancio','deal','metrica'].forEach(s => {
    brief.temi_per_sezione[s] = (brief.temi_per_sezione[s] || []).slice(0, 4);
  });
  console.log(`Temi: bilancio=${brief.temi_per_sezione.bilancio.length}, deal=${brief.temi_per_sezione.deal.length}, metrica=${brief.temi_per_sezione.metrica.length}`);

  // ── Fase 4: Salva pending con token approvazione ─────────────────────────
  const selectionToken = generateToken();
  const briefId = crypto.randomUUID();

  await supaUpsert('scout_pending', {
    ...brief,
    brief_id: briefId,
    drive_files: driveFiles,
    selection_token: selectionToken
  }, 'scout');

  // A new Scout run must never inherit the previous week's selection.
  await supaUpsert('scout_selezione', {
    brief_id: briefId,
    stato: 'pending',
    creato_at: new Date().toISOString()
  }, 'scout');

  // ── Fase 5: Email con approvazione ───────────────────────────────────────
  const selectUrl = `${SITE_URL}/scout-select?token=${selectionToken}`;

  const tuttiTemi = [...(brief.temi_per_sezione?.bilancio||[]).map(t=>({...t,sezione_suggerita:'bilancio'})), ...(brief.temi_per_sezione?.deal||[]).map(t=>({...t,sezione_suggerita:'deal'})), ...(brief.temi_per_sezione?.metrica||[]).map(t=>({...t,sezione_suggerita:'metrica'}))];
  const temasHTML = tuttiTemi.map((t, i) => {
    const colors = { bilancio: ['#1B4332','#E4EDE7'], deal: ['#1B3A6B','#E4ECF7'], metrica: ['#6B1B1B','#F7E4E4'] };
    const [fg, bg] = colors[t.sezione_suggerita] || ['#4A4845','#EDE9E0'];
    const fontiHtml = (t.fonti||[]).map(f => {
      const url = f.match(/https?:\/\/[^\s"]+/)?.[0];
      const label = f.replace(/\s*—\s*https?:\/\/[^\s"]+/,'').trim();
      return url ? `<a href="${url}" style="color:${fg};font-size:9px;text-decoration:underline">${label}</a>` : `<span style="font-size:9px;color:#9A9690">${label}</span>`;
    }).join(' · ');
    const verificaHtml = t.verifica_biblioteca && t.verifica_biblioteca !== 'N/A'
      ? `<div style="font-family:'Courier New',monospace;font-size:8px;color:#1B6B3A;margin-top:5px">📚 ${t.verifica_biblioteca}</div>` : '';
    return `<tr><td style="padding:16px 20px;border-bottom:2px solid #E2DDD4;vertical-align:top">
      <div style="margin-bottom:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span style="font-family:'Courier New',monospace;font-size:8px;font-weight:700;color:#fff;background:#1A1A1A;padding:2px 7px">#${i+1}</span>
        <span style="font-family:'Courier New',monospace;font-size:8px;color:#fff;background:${fg};padding:2px 8px;text-transform:uppercase">${t.sezione_suggerita}</span>
        <span style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">priorità ${t.priorita}/5</span>
      </div>
      <div style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#1A1A1A;margin-bottom:6px;line-height:1.3">${t.titolo}</div>
      <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;line-height:1.65;margin-bottom:10px">${t.sommario||t.notizia||t.summary||''}</div>
      ${t.angolo ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:${fg};background:${bg};padding:6px 10px;margin-bottom:8px">Angolo: ${t.angolo}</div>` : ''}
      ${t.dati_chiave?.length ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:#4A4845;margin-bottom:6px">${t.dati_chiave.join(' · ')}</div>` : ''}
      ${verificaHtml}
      <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;border-top:1px solid #E2DDD4;padding-top:6px;margin-top:6px">${fontiHtml}</div>
    </td></tr>`;
  }).join('');

  const driveHtml = driveFiles.length
    ? `<tr><td style="padding:10px 20px;background:#E4EDE7;border-bottom:1px solid #C8DDD0">
        <span style="font-family:'Courier New',monospace;font-size:8px;color:#1B4332">📚 Biblioteca VA usata per verifica: ${driveFiles.join(', ')}</span>
      </td></tr>` : '';

  const html = agentEmail({
    agentName: 'Scout Agent',
    agentKey: 'scout',
    status: 'pending_approval',
    date: oggi,
    sections: [
      { type: 'narrative', label: 'Brief della settimana', text: brief.brief_narrativo || '', dark: true },
      ...(brief.raccomandazione ? [
        { type: 'dark_cards', label: 'Raccomandazione', cards: [
          { label: (brief.raccomandazione.sezione||'') + ' - ' + (brief.raccomandazione.angolo_editoriale||''), value: brief.raccomandazione.tema || '', valueColor: '#C8A97A', labelColor: '#9A9690' }
        ]},
        { type: 'narrative', label: 'Perche questa settimana', text: brief.raccomandazione.perche || '' }
      ] : []),
      ...(tuttiTemi.length > 0 ? [{ type: 'topics', label: 'Temi (' + tuttiTemi.length + ')', topics: tuttiTemi }] : []),
      ...(brief.note_editoriali ? [{ type: 'alert', text: brief.note_editoriali, type: 'info' }] : []),
      { type: 'narrative', label: null, dark: true, text: '<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td><a href="' + selectUrl + '" style="display:inline-block;background:#C8A97A;color:#1A1A1A;font-family:Courier New,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:16px 40px;text-decoration:none">Seleziona i temi</a></td></tr></table>' }
    ]
  });

  if (!RESEND_KEY || !APPROVAL_EMAIL) {
    console.error('EMAIL NON INVIATA: RESEND_KEY o APPROVAL_EMAIL mancante. Brief disponibile al link:', selectUrl);
  } else {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: FROM, to: APPROVAL_EMAIL,
        subject: `Scout VA · ${brief.raccomandazione?.tema || tuttiTemi[0]?.titolo || 'Brief settimanale'} · approva →`,
        html
      })
    });
    const emailJson = await emailRes.json().catch(() => ({}));
    if (emailRes.ok) {
      console.log('Email Scout inviata a', APPROVAL_EMAIL, '— Resend id:', emailJson.id);
    } else {
      console.error('ERRORE invio email Scout — Resend', emailRes.status, ':', JSON.stringify(emailJson), '| brief al link:', selectUrl);
    }
  }

  await logRun('scout', 'pending_approval',
    `${tuttiTemi.length} temi. Drive: ${(driveFiles||[]).length} file. In attesa selezione temi.`,
    { drive: driveFiles||[], raccomandazione: brief.raccomandazione },
    Date.now() - start
  );

  console.log(`Scout completato in ${Date.now()-start}ms. Temi: ${tuttiTemi.length}, Drive: ${(driveFiles||[]).length} file.`);
}

main().catch(async e => {
  console.error('ERRORE Scout:', e.message);
  await logRun('scout', 'error', e.message).catch(() => {});
  process.exit(1);
});
