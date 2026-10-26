// scripts/scout.js — Scout Agent v3
// Web search libero su fonti certificate → verifica con Drive → brief + approvazione

const crypto = require('crypto');
const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');
const { logUsage } = require('../api/_lib/ai-usage');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const { sendEmail }  = require('../api/_lib/mailer');
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
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

async function callClaude(messages, system, useSearch = false, model = 'claude-sonnet-4-6', maxTokens = 6000) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages
  };
  if (useSearch) {
    // max_uses limita i giri di ricerca: ogni ricerca aggiunge i risultati come
    // input token e vengono rimandati a ogni turno del loop, quindi è la leva
    // principale sul costo. 5 query mirate bastano per 8-10 temi.
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
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

// Ripara un JSON troncato/malformato: chiude stringhe e parentesi rimaste
// aperte, toglie virgole pendenti, chiavi senza valore -> null. Best-effort:
// se non basta, il chiamante ricade sul retry.
function riparaJsonTroncato(s) {
  let inStr = false, esc = false;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let cut = s;
  if (inStr) cut += '"';                  // chiudi stringa aperta
  cut = cut.replace(/,\s*$/, '');         // togli virgola pendente
  cut = cut.replace(/:\s*$/, ': null');   // chiave senza valore -> null
  cut = cut.replace(/,\s*$/, '');
  while (stack.length) cut += stack.pop();
  return cut;
}

// Sanifica ed effettua il parse del JSON del brief; se troncato, tenta il
// recupero. Ritorna l'oggetto o null (mai lancia).
function parseBriefJson(text) {
  const raw = String(text || '').replace(/```json|```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const sanitize = (s) => s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/"((?:[^"\\]|\\.)*)"/g, (m, x) => '"' + x.replace(/\n/g, ' ').replace(/\r/g, '') + '"');
  const candidate = sanitize(match[0]);
  try { return JSON.parse(candidate); } catch (_) { /* prova il recupero */ }
  try { return JSON.parse(riparaJsonTroncato(candidate)); } catch (_) { return null; }
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
    const r = await fetch(`${SUPA_URL}/rest/v1/editions?published=eq.true&select=num,title,subtitle,sections&order=num.desc&limit=8`, {
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
  const d = now.getDate();      // 1-31
  const y = now.getFullYear();

  const eventi = [];

  // Ancora temporale esplicito: la stagione in corso è la 26/27 (la precedente
  // è la 25/26). Serve a evitare l'errore ricorrente di confondere le stagioni
  // e di trattare come "attuali" dati della stagione passata.
  eventi.push(`STAGIONE IN CORSO: 2026/27 (la stagione precedente, ormai chiusa, è la 2025/26). Quando citi bilanci o dati riferiti a una stagione, esplicita SEMPRE a quale stagione si riferiscono e non spacciare la 25/26 come attualità.`);

  // Mondiale 2026 — finestra torneo: 11 giugno – 19 luglio 2026
  const mondialeInizio = new Date('2026-06-11T00:00:00');
  const mondialeFine   = new Date('2026-07-19T23:59:59');
  if (now >= mondialeInizio && now <= mondialeFine) {
    eventi.push(`MONDIALE 2026 in corso — leggilo in chiave economica (montepremi FIFA e impatto sui bilanci dei club, ricavi di ciclo, Club Benefits Programme, diritti TV, ROI sponsor, valore di mercato dei protagonisti). L'angolo è "cosa significa in soldi", non la cronaca.`);
  } else if (y === 2026 && now > mondialeFine && m <= 9) {
    eventi.push(`MONDIALE 2026 CONCLUSO (finale giocata il 19 luglio 2026) — FILONE SATURO: ricavi FIFA, montepremi, Club Benefits Programme, ticketing, sponsor e "valore dei protagonisti" del Mondiale sono GIÀ STATI TRATTATI a fondo (edizioni #007, #008, #011, #012). NON riproporli. Riprendi il Mondiale SOLO per un fatto nuovo, specifico e datato di questi 7 giorni. L'attualità ORA è il mercato estivo e la costruzione delle rose per la nuova stagione.`);
  }

  // Mercato trasferimenti estivo
  if ((m === 8 && d >= 25) || (m === 9 && d <= 5)) {
    // Ultimi giorni + chiusura: il momento più "caldo" e attuale.
    eventi.push(`DEADLINE DAY / CHIUSURA MERCATO ESTIVO (finestra fino al 1 settembre): è il momento clou. Cerca i colpi last-minute e i loro numeri (importo, struttura equity/earn-out/prestito con obbligo, multipli EV/ricavi), la spesa netta e il saldo di mercato dei club, le plusvalenze registrate per far quadrare il PSR/FFP entro la chiusura. L'attualità NON è più "chi arriva" in astratto ma il consuntivo economico della sessione appena chiusa.`);
    eventi.push(`AVVIO STAGIONE 2026/27: prime giornate dei campionati. Angoli economici freschi: monte ingaggi delle rose costruite, ammortamento dei nuovi acquisti spalmato sui contratti, ricavi attesi (abbonamenti/stagionali venduti, botteghino, sponsor di maglia della nuova stagione), impatto della qualificazione/mancata qualificazione alle coppe sui conti.`);
  } else if (m === 6 || m === 7 || m === 8) {
    eventi.push(`MERCATO ESTIVO APERTO (1 luglio – 1 settembre): cerca deal in corso o attesi, multipli EV/ricavi pagati, struttura equity/earn-out, ruolo fondi PE nel finanziamento acquisti.`);
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
// ── Notifica: costruisce e invia l'email del brief Scout ─────────────────────
// Estratta da main() così può essere richiamata anche in modalità solo-notifica
// (re-invio dal brief già salvato su scout_pending, senza rifare la ricerca web).
async function inviaNotificaScout(brief, driveFiles, selectionToken, oggi, start) {
  const selectUrl = `${SITE_URL}/scout-select?token=${selectionToken}`;
  const tps = brief.temi_per_sezione || {};
  const rec = brief.raccomandazione;
  const etichette = { bilancio: 'Il Bilancio', deal: 'Il Deal', metrica: 'La Metrica' };

  // Gli stessi temi che la pagina di selezione rende selezionabili, nello stesso
  // ordine. Il consigliato è marcato; non esistono temi citati ma non scegliibili.
  const perSezione = SEZIONI.map(sez => ({
    sez,
    temi: (tps[sez] || []).map((t, idx) => ({
      ...t, sezione_suggerita: sez,
      consigliato: !!(rec && rec.sezione === sez && rec.idx === idx)
    }))
  }));
  const tuttiTemi = perSezione.flatMap(x => x.temi);
  const scarne = perSezione.filter(x => x.temi.length < MIN_OPZIONI);
  const recTema = rec && rec.tema;
  const nota = brief.note_editoriali || '';

  const html = agentEmail({
    agentName: 'Scout Agent',
    agentKey: 'scout',
    status: 'pending_approval',
    date: oggi,
    sections: [
      { type: 'narrative', label: 'Brief della settimana', text: brief.brief_narrativo || '', dark: true },
      ...(rec ? [
        { type: 'dark_cards', label: 'Raccomandazione', cards: [
          { label: '★ ' + (etichette[rec.sezione] || rec.sezione || '') + (rec.angolo_editoriale ? ' - ' + rec.angolo_editoriale : ''), value: rec.tema || '', valueColor: '#C8A97A', labelColor: '#9A9690' }
        ]},
        { type: 'narrative', label: 'Perche questa settimana', text: (rec.perche || '') + ' È già tra le opzioni qui sotto e nella pagina di selezione.' }
      ] : []),
      ...perSezione.filter(x => x.temi.length).map(x => ({
        type: 'topics',
        label: `${etichette[x.sez]} · ${x.temi.length} ${x.temi.length === 1 ? 'opzione' : 'opzioni'}`,
        topics: x.temi
      })),
      ...(scarne.length ? [{ type: 'alert', level: 'warning', text: 'Poche opzioni: ' + scarne.map(x => `${etichette[x.sez]} (${x.temi.length})`).join(', ') + '. Nella pagina di selezione puoi scrivere un tuo argomento per queste sezioni.' }] : []),
      ...(nota ? [{ type: 'alert', level: 'info', text: nota }] : []),
      { type: 'narrative', label: null, dark: true, text: '<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td><a href="' + selectUrl + '" style="display:inline-block;background:#C8A97A;color:#1A1A1A;font-family:Courier New,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:16px 40px;text-decoration:none">Scegli i 3 temi (' + tuttiTemi.length + ' opzioni)</a></td></tr></table>' }
    ]
  });

  if (!APPROVAL_EMAIL) {
    console.error('EMAIL NON INVIATA: APPROVAL_EMAIL mancante. Brief disponibile al link:', selectUrl);
  } else {
    const ok = await sendEmail({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `Scout VA · ${recTema || tuttiTemi[0]?.titolo || 'Brief settimanale'} · scegli i 3 temi →`,
      html
    });
    if (ok) {
      console.log('Email Scout inviata a', APPROVAL_EMAIL);
    } else {
      console.error('ERRORE invio email Scout | brief al link:', selectUrl);
    }
  }

  await logRun('scout', 'pending_approval',
    `${tuttiTemi.length} temi (${perSezione.map(x => x.temi.length).join('/')}). Drive: ${(driveFiles||[]).length} file. In attesa selezione temi.`,
    { drive: driveFiles||[], raccomandazione: brief.raccomandazione, opzioni: Object.fromEntries(perSezione.map(x => [x.sez, x.temi.length])), scartati: brief.scartati || [] },
    Date.now() - start
  );

  console.log(`Scout completato in ${Date.now()-start}ms. Temi: ${tuttiTemi.length}, Drive: ${(driveFiles||[]).length} file.`);
}

// ── Modalità solo-notifica: re-invia l'email dal brief già salvato ───────────
// Attivata con SCOUT_NOTIFY_ONLY=1. Non tocca Anthropic/web search: legge
// scout_pending da Supabase e re-invia la notifica (utile se l'invio originale
// è fallito, es. secret email mancante al momento del run).
async function notificaDaSalvato(oggi, start) {
  const r = await fetch(`${SUPA_URL}/rest/v1/agent_memory?key=eq.scout_pending&select=value`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  const rows = await r.json();
  const rec = rows && rows[0] && rows[0].value;
  if (!rec || !rec.selection_token) {
    throw new Error('Nessun brief salvato in scout_pending (o senza selection_token). Rilancia lo Scout normale.');
  }
  console.log('Modalità solo-notifica: re-invio brief salvato', rec.brief_id || '');
  await inviaNotificaScout(rec, rec.drive_files || [], rec.selection_token, oggi, start);
}

// ── Punteggio editoriale ────────────────────────────────────────────────────
// Criteri espliciti (NON dati di engagement: le metriche di apertura/click non
// distinguono gli argomenti, quindi non possiamo dire "questo piace di più").
// Ogni tema riceve 1-5 su quattro criteri dallo Scout; il totale (max 20) è
// ridotto se la verifica fatti non lo conferma. Serve a ordinare le proposte e
// resta salvato nel tema per un futuro confronto con click/aperture reali.
const CRITERI = ['attualita', 'rilevanza', 'concretezza', 'novita'];
const SEZIONI = ['bilancio', 'deal', 'metrica'];
const TIPI_TEMA = ['protagonista', 'soldi_concreti', 'grande_deal', 'numero_sorprendente', 'altro'];
const PENALITA_VERIFICA = { ok: 0, corretto: 0, unverified: 3, stale: 5 };

function clamp15(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : 3;
}

function calcolaPunteggio(t) {
  const p = t.punteggi || {};
  const voti = {};
  CRITERI.forEach(c => { voti[c] = clamp15(p[c]); });
  // Concretezza: senza almeno due dati chiave non può superare 2.
  if ((t.dati_chiave || []).length < 2) voti.concretezza = Math.min(voti.concretezza, 2);
  const base = CRITERI.reduce((sum, c) => sum + voti[c], 0);
  const stato = t.verifica && t.verifica.stato;
  const penalita = PENALITA_VERIFICA[stato] || 0;
  t.punteggi = voti;
  t.punteggio = Math.max(0, base - penalita);
  if (!TIPI_TEMA.includes(t.tipo)) t.tipo = 'altro';
  return t.punteggio;
}

function ordinaPerPunteggio(brief) {
  SEZIONI.forEach(sez => {
    const lista = (brief.temi_per_sezione[sez] || []);
    lista.forEach(calcolaPunteggio);
    // sort stabile: a parità resta l'ordine originale dello Scout
    brief.temi_per_sezione[sez] = lista
      .map((t, i) => ({ t, i }))
      .sort((x, y) => (y.t.punteggio - x.t.punteggio) || (x.i - y.i))
      .map(x => x.t);
  });
}

// Raccomandazione deterministica: il tema col punteggio più alto (a parità,
// preferisce il Deal, il cuore di VA). Usata se la sintesi con l'AI fallisce.
function raccomandazioneFallback(brief) {
  const ordine = ['deal', 'bilancio', 'metrica'];
  let best = null;
  ordine.forEach(sez => {
    (brief.temi_per_sezione[sez] || []).forEach((t, idx) => {
      if (!best || t.punteggio > best.t.punteggio) best = { sez, idx, t };
    });
  });
  if (!best) return null;
  return {
    tema: best.t.titolo, sezione: best.sez, idx: best.idx,
    perche: best.t.perche_interessa || best.t.sommario || '',
    angolo_editoriale: best.t.angolo || '',
    dati_ancora: (best.t.dati_chiave || []).slice(0, 3)
  };
}

function parseJsonLoose(out) {
  try {
    const m = String(out || '').replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1')) : null;
  } catch (_) { return null; }
}

// ── Fase 3.5: verifica fatti del brief ──────────────────────────────────────
// Controlla con web search i fatti concreti di ogni tema e li marca:
//  ok         fatto principale confermato
//  corretto   fatto principale VERO ma un dettaglio sbagliato: il tema resta,
//             con titolo/sommario riscritti sui dati corretti
//  stale      vero ma di una stagione precedente
//  wrong      il fatto PRINCIPALE è falso o non è mai successo: il tema viene
//             rimosso (era il caso di "Openda alla Juventus")
//  unverified nessuna conferma sufficiente
// Prima rimuoveva anche i temi con un solo dettaglio errato: così è sparito
// il Qatar-Inter che poi la raccomandazione continuava a citare.
async function verificaBrief(brief, oggi) {
  const claims = [];
  SEZIONI.forEach(sez => {
    (brief.temi_per_sezione[sez] || []).forEach((t, i) => {
      claims.push({
        id: `${sez}:${i}`,
        titolo: t.titolo || '',
        sommario: t.sommario || '',
        dati: (t.dati_chiave || []).join(' | '),
        fonte: t.fonte_principale || ''
      });
    });
  });
  if (!claims.length) return { rimossi: 0, corretti: 0, titoliRimossi: [] };

  const sys = `Sei un fact-checker del business del calcio. Verifichi con web search se le affermazioni fattuali di un brief sono VERE e ATTUALI. Oggi è ${oggi}; la stagione in corso è la 2026/27 (la precedente, chiusa, è la 2025/26). Rispondi SOLO con JSON valido.`;
  const prompt = `Per ciascun tema verifica con web search i FATTI CONCRETI, in particolare:
- Trasferimenti: il giocatore è DAVVERO passato al club indicato, in QUESTA finestra (estate 2026, stagione 26/27)? Attenzione a non confondere un trasferimento della stagione PRECEDENTE (25/26) spacciato come attuale.
- Cifre/numeri: sono corretti e riferiti alla stagione giusta?
- Trattative: se è solo una trattativa o un'indiscrezione, il testo deve dirlo; non va presentata come fatto compiuto.

Assegna a ogni id uno "stato":
- "ok": il fatto principale è confermato da fonte recente e riferito alla stagione/finestra giusta.
- "corretto": il fatto PRINCIPALE è vero ma un dettaglio (una cifra, una data, un nome secondario, il grado di ufficialità) è sbagliato o impreciso. Riscrivi in "titolo_corretto" e "sommario_corretto" il testo con i dati giusti (sommario di 1-2 frasi, stessa lunghezza dell'originale).
- "stale": il fatto è vero ma appartiene alla stagione PRECEDENTE (25/26) o comunque non è l'attualità di questi giorni.
- "wrong": il fatto PRINCIPALE è FALSO o non è mai avvenuto (es. il giocatore è a un altro club, l'operazione non esiste). Usa "wrong" SOLO se la ricerca lo contraddice chiaramente E il tema non regge nemmeno corretto. Un dettaglio sbagliato NON basta: in quel caso usa "corretto".
- "unverified": non trovi conferma sufficiente.
Per "stale" e "wrong" scrivi in "correzione" il fatto corretto (breve, senza virgolette doppie). In "nota" una riga con la fonte.

TEMI:
${JSON.stringify(claims, null, 1)}

JSON richiesto:
{"verdicts": {"sezione:indice": {"stato":"ok|corretto|stale|wrong|unverified","nota":"...","correzione":"...","titolo_corretto":"solo se corretto","sommario_corretto":"solo se corretto"}}}`;

  let out = '';
  try {
    out = await callClaude([{ role: 'user', content: prompt }], sys, true, 'claude-sonnet-4-6');
  } catch (e) {
    console.warn('Verifica brief fallita (non bloccante):', e.message);
    return { rimossi: 0, corretti: 0, titoliRimossi: [] };
  }

  const parsed = parseJsonLoose(out);
  if (!parsed) {
    console.warn('Verifica: JSON non parsabile, nessuna annotazione');
    return { rimossi: 0, corretti: 0, titoliRimossi: [] };
  }
  const verdicts = parsed.verdicts || {};

  // Applica: annota ogni tema, riscrive i "corretto", rimuove i "wrong".
  // filter fornisce l'indice originale, quindi la chiave "sez:i" resta allineata.
  let rimossi = 0, corretti = 0;
  const titoliRimossi = [];
  SEZIONI.forEach(sez => {
    brief.temi_per_sezione[sez] = (brief.temi_per_sezione[sez] || []).filter((t, i) => {
      const v = verdicts[`${sez}:${i}`];
      if (v && v.stato === 'wrong') {
        console.log(`Verifica: RIMOSSO ${sez}:${i} "${t.titolo}" — ${v.correzione || v.nota || 'errato'}`);
        titoliRimossi.push(t.titolo);
        rimossi++;
        return false;
      }
      if (v && v.stato) {
        t.verifica = { stato: v.stato, nota: v.nota || '', correzione: v.correzione || '' };
        if (v.stato === 'corretto' && (v.titolo_corretto || v.sommario_corretto)) {
          t.titolo_originale = t.titolo;
          t.sommario_originale = t.sommario;
          if (v.titolo_corretto) t.titolo = v.titolo_corretto;
          if (v.sommario_corretto) t.sommario = v.sommario_corretto;
          corretti++;
          console.log(`Verifica: CORRETTO ${sez}:${i} "${t.titolo}" — ${v.nota || ''}`);
        } else if (v.stato === 'corretto') {
          // corretto senza testo riscritto: lo segno solo da verificare
          t.verifica.stato = 'unverified';
        }
      }
      return true;
    });
  });
  return { rimossi, corretti, titoliRimossi };
}

// ── Sintesi post-verifica ───────────────────────────────────────────────────
// Dopo verifica e ordinamento, narrativa e raccomandazione vengono RISCRITTE
// solo sui temi sopravvissuti. La raccomandazione indica "sezione:indice" di
// un tema realmente selezionabile, quindi non può più parlare di un tema che
// la pagina di selezione non mostra.
async function sintetizzaBrief(brief, oggi, titoliRimossi) {
  const elenco = [];
  SEZIONI.forEach(sez => (brief.temi_per_sezione[sez] || []).forEach((t, i) => {
    elenco.push({
      id: `${sez}:${i}`, titolo: t.titolo, sommario: t.sommario,
      dati: (t.dati_chiave || []).slice(0, 3), punteggio: t.punteggio,
      verifica: t.verifica ? t.verifica.stato : 'n/d'
    });
  }));
  if (!elenco.length) return null;

  const sys = 'Sei lo Scout senior di Valore Atteso, newsletter italiana sul business del calcio europeo. Scrivi in italiano semplice, senza trattini lunghi. Non aggiungere fatti che non sono nei temi forniti. Rispondi SOLO con JSON valido.';
  const prompt = `Oggi è ${oggi}. Questi sono i temi che Paolo può scegliere questa settimana (già verificati). Scrivi il brief SOLO su questi.

TEMI:
${JSON.stringify(elenco, null, 1)}
${titoliRimossi && titoliRimossi.length ? `\nTemi scartati perché risultati falsi (NON citarli): ${titoliRimossi.join(' | ')}\n` : ''}
Regole:
- "raccomandazione.id" DEVE essere uno degli id elencati: è il tema più forte per un lettore M&A/PE/finanza, tenendo conto di punteggio e verifica. Non raccomandare temi "unverified" o "stale" se ce ne sono di verificati.
- "brief_narrativo": 3-4 frasi su cosa domina la settimana e il filo che lega i temi disponibili.
- "perche": 2 frasi sul motivo per cui questo tema interessa ai lettori ORA.
- "note_editoriali": cosa evitare o attenzione (es. tema ancora a livello di trattativa, sezione con poche opzioni).

JSON richiesto:
{"brief_narrativo":"...","raccomandazione":{"id":"sezione:indice","perche":"...","angolo_editoriale":"..."},"note_editoriali":"..."}`;

  let out;
  try {
    out = await callClaude([{ role: 'user', content: prompt }], sys, false, 'claude-sonnet-4-6', 2000);
  } catch (e) {
    console.warn('Sintesi brief fallita (uso fallback):', e.message);
    return null;
  }
  const j = parseJsonLoose(out);
  const id = j && j.raccomandazione && String(j.raccomandazione.id || '');
  const [sez, idxStr] = (id || '').split(':');
  const idx = Number.parseInt(idxStr, 10);
  const tema = SEZIONI.includes(sez) && Number.isInteger(idx) ? (brief.temi_per_sezione[sez] || [])[idx] : null;
  if (!j || !tema) { console.warn('Sintesi non valida (id non selezionabile), uso fallback'); return null; }
  return {
    brief_narrativo: String(j.brief_narrativo || ''),
    raccomandazione: {
      tema: tema.titolo, sezione: sez, idx,
      perche: String(j.raccomandazione.perche || ''),
      angolo_editoriale: String(j.raccomandazione.angolo_editoriale || tema.angolo || ''),
      dati_ancora: (tema.dati_chiave || []).slice(0, 3)
    },
    note_editoriali: String(j.note_editoriali || '')
  };
}

// ── Rifornimento sezioni scarne ─────────────────────────────────────────────
// Se dopo la verifica una sezione ha meno di 3 opzioni, UNA ricerca mirata
// cerca solo i temi mancanti (poi verificati come gli altri). Un solo giro:
// meglio avvisare Paolo che far salire il costo.
const MIN_OPZIONI = 3;

function sezioniScarne(brief) {
  return SEZIONI.filter(s => (brief.temi_per_sezione[s] || []).length < MIN_OPZIONI);
}

async function rifornisciSezioni(brief, oggi, contesto) {
  const scarne = sezioniScarne(brief);
  if (!scarne.length) return 0;
  const gia = SEZIONI.flatMap(s => (brief.temi_per_sezione[s] || []).map(t => t.titolo));
  const descr = {
    bilancio: 'BILANCIO: risultati finanziari, ricavi, perdite, aumenti di capitale, debito di un club NOMINATO, con la storia dietro ai numeri',
    deal: 'DEAL: acquisizioni, cessioni di quote, fondi che entrano, cambi di proprietà, valutazioni, sponsor e diritti TV come operazioni (chi, quanto, perché)',
    metrica: 'METRICA: UN numero sorprendente raccontato semplice (stipendi, biglietti, sponsor di maglia, ricavi per tifoso...), mai percentuali aggregate di lega o indici regolatori'
  };
  const richieste = scarne.map(s => `- ${descr[s]} (servono ${MIN_OPZIONI - (brief.temi_per_sezione[s] || []).length} temi in più)`).join('\n');
  const sys = `Sei lo Scout senior di Valore Atteso, newsletter italiana sul business del calcio europeo. Cerchi notizie FRESCHE (ultimi 7 giorni) con web search. Ogni tema: un soggetto nominato, un evento datato, almeno 2 numeri concreti da fonte Tier 1 o 2 (bilanci e comunicati ufficiali, UEFA, leghe; Reuters, FT, Bloomberg, The Athletic, BBC). Mai Calcio e Finanza, Transfermarkt per le cifre, blog, aggregatori. Non presentare come fatto ciò che è solo trattativa. Evita gergo (PSR, SCR, wage ratio, EV/EBITDA). Rispondi SOLO con JSON valido.`;
  const prompt = `Oggi è ${oggi}.${contesto || ''}

Mancano opzioni in queste sezioni:
${richieste}

Temi GIÀ presenti o scartati (NON riproporli): ${gia.join(' | ') || 'nessuno'}

Cerca con web search (max 5 query mirate) e rispondi con JSON:
{"nuovi": {"sezione": [{"titolo":"...","sommario":"1-2 frasi: angolo e perché conta ora","dati_chiave":["numero con contesto","..."],"fonte_principale":"testata - titolo - data - url","angolo":"...","perche_interessa":"1 frase: perché al lettore importa","tipo":"protagonista|soldi_concreti|grande_deal|numero_sorprendente|altro","punteggi":{"attualita":1-5,"rilevanza":1-5,"concretezza":1-5,"novita":1-5}}]}}
Usa come chiavi solo: ${scarne.join(', ')}. Se non trovi temi solidi, restituisci liste vuote: meglio nessuno che riempitivi.`;
  let out;
  try {
    out = await callClaude([{ role: 'user', content: prompt }], sys, true, 'claude-sonnet-4-6', 8000);
  } catch (e) {
    console.warn('Rifornimento sezioni fallito (non bloccante):', e.message);
    return 0;
  }
  const parsed = parseBriefJson(out);
  const nuovi = parsed && parsed.nuovi;
  if (!nuovi) { console.warn('Rifornimento: JSON non valido'); return 0; }

  // Verifica solo i nuovi con lo stesso fact-check, poi li accoda.
  const tmp = { temi_per_sezione: { bilancio: [], deal: [], metrica: [] } };
  scarne.forEach(s => { tmp.temi_per_sezione[s] = Array.isArray(nuovi[s]) ? nuovi[s].slice(0, MIN_OPZIONI) : []; });
  const v = await verificaBrief(tmp, oggi);
  let aggiunti = 0;
  scarne.forEach(s => {
    tmp.temi_per_sezione[s].forEach(t => { t.rifornito = true; brief.temi_per_sezione[s].push(t); aggiunti++; });
  });
  console.log(`Rifornimento: ${aggiunti} temi aggiunti (${v.rimossi} scartati dalla verifica).`);
  return aggiunti;
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const settimana = new Date().toLocaleDateString('it-IT');
  const setteGiorniFa = new Date(Date.now() - 7*86400000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  console.log('Scout v2.1 avviato:', new Date().toISOString());

  // Solo re-invio della notifica dal brief già salvato (nessun costo Anthropic).
  if (process.env.SCOUT_NOTIFY_ONLY === '1') {
    await notificaDaSalvato(oggi, start);
    return;
  }

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

  // FASE 1: Ricerca web — output testo libero (no JSON) — Sonnet + web search (max 5 query)
  const testoRicerca = await callClaude([{
    role: 'user',
    content: `Oggi è ${oggi}.${stagionale ? '\n\nEVENTI PRIORITARI ORA:\n' + stagionale.replace(/\n\nCONTESTO STAGIONALE ATTUALE[^\n]*\n/,'') : ''}

Fai una ricerca web APPROFONDITA (usa più query diverse) e trova ALMENO 8-10 notizie DISTINTE e fresche degli ultimi 7 giorni sul business del calcio europeo. Devono bastare per riempire con qualità 3 sezioni (Bilancio, Deal, Metrica) con più opzioni ciascuna, quindi non fermarti alle prime 3-4 che trovi: scava.

PARTI DALL'ATTUALITÀ — CATTURA IL MOMENTO (regola prioritaria): identifica prima di tutto gli eventi che DOMINANO la conversazione calcistica di questi 7 giorni — un'operazione di mercato rilevante, un annuncio societario, una decisione regolatoria o un big match di cui parlano tutti — e trovane l'angolo FINANZIARIO. I lettori vogliono l'analisi economica di ciò che stanno GIÀ seguendo: un grande evento di attualità con un buon angolo money vale più di una notizia di nicchia. Chiediti: "di cosa parla il calcio questa settimana?" e portaci il numero dietro.

COSA CERCARE — LE 4 DIREZIONI PRIORITARIE (scegli i temi PRIMA DI TUTTO tra queste; sono cio' che Paolo vuole leggere):
1. STORIE CON UN PROTAGONISTA: parti da UN nome — un club, una persona (presidente, proprietario, dirigente, giocatore), un fondo — e una sua mossa con un colpo di scena. "Perche' X ha fatto questa scelta e cosa ci guadagna". Il lettore deve poter tifare o indignarsi, non solo capire.
2. SOLDI CONCRETI E QUOTIDIANI: cifre che il lettore "sente" sulla propria pelle — sponsor di maglia, stipendi, prezzo di biglietti e abbonamenti, diritti TV, quanto incassa/guadagna un club, quanto costa un giocatore rispetto a quanto rende. Numeri tangibili, non ratios astratti.
3. GRANDI DEAL E PROPRIETA': chi compra chi, fondi che entrano, cambi di proprieta', valutazioni di club — ma raccontati COME UNA STORIA (chi, perche', quanto, cosa cambia), non come un report.
4. NUMERI SORPRENDENTI (stile SpiegameloFacile): un dato controintuitivo o curioso che fa dire "non ci crederesti, ma...". La sorpresa e l'esempio concreto vengono PRIMA del tecnicismo. Per la sezione Metrica preferisci SEMPRE un numero sorprendente raccontato semplice, MAI una percentuale aggregata di lega o un indice regolatorio.

VIETATO COME TEMA PRINCIPALE (troppo complicati/gergali — Paolo li trova noiosi e incomprensibili): Squad Cost Ratio / SCR, PSR / FFP, "red zone", wage ratio, "cliff effect", percentuali aggregate di lega (es. "il 52% dei deal", "il 73% della spesa"), arbitraggio normativo UEFA, contabilita' tecnica. Se un tema si REGGE su uno di questi concetti per essere capito, e' troppo complicato: scartalo o riscrivilo attorno a un protagonista e a soldi concreti. CAP ASSOLUTO: al massimo UN tema in tutto il brief puo' avere un angolo regolatorio/contabile, e solo se lo sai rendere semplice con un esempio.

Spazia tra Serie A, Premier, Liga, Bundesliga, Ligue 1 e oltre.

SCELTA DEI TEMI — attualita' della settimana, non temi artificialmente leggeri: scegli le notizie piu' importanti e interessanti di questi 7 giorni. Deal, acquisizioni, proprieta', valutazioni e M&A sono BENVENUTI: sono il cuore di Valore Atteso. La regola NON e' preferire temi "commerciali" o "leggeri", ma scegliere temi che si possano poi RACCONTARE in modo semplice e piacevole (vedi TEST DEL CAFFE). La semplicita' sta nella SCRITTURA, non nell'evitare i temi seri. Evita solo gli angoli cosi' tecnici da non poter essere spiegati con piacere col caffe (meccanismi contabili astrusi, cavilli legali).

TEST DEL CAFFE (filtro obbligatorio sulla scelta dei temi): il lettore ci legge in 8 minuti, col caffe. Se un tema non lo puoi spiegare in modo semplice e piacevole, con un esempio concreto, a un professionista che non e' specialista di quella nicchia, SCARTALO e scegline un altro. La leggibilita' del tema conta piu' della sua complessita' tecnica.

FILONI SATURI — NON riproporre salvo novità eccezionale e datata di questi 7 giorni: (a) ricavi/montepremi/commerciale di Mondiale 2026 e FIFA; (b) macro-bilanci aggregati di lega (ricavi o debito totali della Serie A); (c) UEFA / PSR / Squad Cost Rule / Financial Fair Play. Sono già usciti più volte: i lettori non vogliono riletture. CAP RIGIDO: al massimo UN tema su tutto il brief può toccare UEFA/PSR/Squad Cost Rule, e solo con un fatto nuovo e datato di questi 7 giorni. Se ne trovi di più, tienine uno solo e scarta gli altri.

ARCHETIPO DI TEMA FORTE (le nostre edizioni migliori — es. #002 Sheffield, #008 Oaktree-Inter, #009 PSG-Ramos e Nico Paz, #010 Clara Vista-Frosinone): parti da UN soggetto NOMINATO (un club, un fondo, una persona, una singola operazione) e racconta la sua STORIA di soldi in modo semplice — chi e', cosa ha fatto, quanto vale/costa/rende, cosa ci guadagna e perche' e' sorprendente. L'angolo finanziario deve emergere dalla storia, spiegato come lo spiegheresti a un amico non del settore, NON con il lessico da report (evita "multipli", "EV/EBITDA", "engineering", "carve-out" nel titolo e nell'attacco). Preferisci SEMPRE questo a un tema macro, regolatorio o a un evento globale generico.

FILTRO ANTI-RIDONDANZA (OBBLIGATORIO — è il problema n.1 da risolvere): in fondo al system c'è l'elenco delle EDIZIONI GIÀ PUBBLICATE. Per OGNI tema candidato confrontalo con quell'elenco: se lo stesso club, deal, operazione, persona o metrica è già stato trattato e NON c'è una novità concreta e DATATA in questi 7 giorni, SCARTALO. In caso di dubbio, scarta. Per ogni tema che tocca un'entità già vista, scrivi esplicitamente "NOVITÀ DI QUESTA SETTIMANA: [fatto nuovo + data]"; se non riesci a scriverla, il tema è ridondante e va eliminato. Meglio pochi temi davvero nuovi che tanti riciclati.

SOGLIA DATI E GERARCHIA DELLE FONTI (obbligatoria): ogni tema deve poggiare su almeno 2 numeri concreti, specifici e DATATI. Se non hai numeri solidi e recenti, o solo cifre tonde e generiche, NON proporre il tema. Meglio 3 temi con dati veri che 7 vaghi.
Usa SEMPRE la fonte più alta disponibile:
- TIER 1, primarie e istituzionali (sempre preferite): bilanci e relazioni ufficiali dei club, documenti depositati e filings di borsa dei club quotati (Companies House, registro imprese), organi di governo (UEFA, FIFA, FIGC, Lega Serie A, Premier League, LaLiga, DFL, LFP, ECA), report PUBBLICATI delle società di consulenza (Deloitte Football Money League e Annual Review of Football Finance, KPMG Football Benchmark, PwC), comunicati ufficiali di club e leghe.
- TIER 2, secondarie autorevoli (solo se manca la primaria): Reuters, Financial Times, Bloomberg, The Athletic, BBC, SportsPro, Sportcal, SwissRamble.
- TIER 3, MAI citare: blog di tifosi, aggregatori (footyheadlines, Finance Football e simili), Transfermarkt per le cifre dei trasferimenti, tabloid, e Calcio e Finanza.
Se un dato esiste solo su fonti Tier 3, non usarlo. Non dare per FATTO ciò che è solo una trattativa o un'indiscrezione non confermata: se non è ufficiale, dillo chiaramente.

Per OGNI tema riporta: titolo editoriale incisivo, cosa è successo (con data), fonte con URL diretto, 2-3 dati finanziari chiave, la lettura CF (multipli/ratios/implicazione per un advisor M&A/PE), e la sezione suggerita (bilancio/deal/metrica). Scrivi in italiano, testo semplice discorsivo, NON JSON.`
  }], system, true, 'claude-sonnet-4-6');

  console.log('Fase 1 completata, testo:', testoRicerca.slice(0, 200));

  // FASE 2: Conversione in JSON — chiamata separata senza web search
  const testoRicercaShort = testoRicerca.slice(0, 16000); // contesto ampio per non perdere temi
  const jsonPrompt = `Converti questo brief Scout in JSON valido, SENZA perdere ricchezza: riporta più opzioni possibili (idealmente 5 per sezione, almeno 3 se il brief le contiene) tra quelle presenti nel brief.

REGOLE JSON:
- Italiano naturale con accenti e apostrofi: sono ammessi (in JSON l'apostrofo NON va escapato).
- L'UNICA cosa vietata dentro una stringa è la virgoletta doppia " non escapata e gli a-capo: se servono, riscrivi la frase.
- Il "sommario" deve essere ricco e specifico (1-2 frasi, ~200-280 caratteri): angolo di analisi + perché è rilevante ORA. Niente riassunti generici.
- Ogni tema deve avere dati_chiave concreti (numeri con contesto) e fonte_principale con URL.
- Non inventare: usa solo temi e dati presenti nel brief. Se una sezione ha meno di 5 temi validi nel brief, mettine meno (meglio 3 solidi che 5 riempitivi).
- Per OGNI tema aggiungi: "perche_interessa" (1 frase: perché dovrebbe importare a un lettore italiano, in parole semplici), "tipo" e "punteggi".
- "tipo": protagonista (storia di una persona/club/fondo nominato) | soldi_concreti (stipendi, sponsor, biglietti, incassi) | grande_deal (chi compra chi) | numero_sorprendente | altro.
- "punteggi" da 1 a 5 su quattro criteri, da valutare con onestà (non dare 5 a tutto): attualita (5 = evento degli ultimi 2-3 giorni di cui si parla ora, 1 = più vecchio di una settimana); rilevanza (5 = un lettore italiano M&A/finanza/calcio lo sente suo: club e campionati italiani, big europei, nomi noti); concretezza (5 = almeno 2 numeri solidi e datati da fonte primaria, 1 = solo cifre vaghe); novita (5 = mai trattato nelle edizioni passate, 1 = già visto).

BRIEF:
${testoRicercaShort}

JSON richiesto (fino a 5 oggetti per sezione):
{
  "settimana": "${settimana}",
  "temi_per_sezione": {
    "bilancio": [{"titolo":"titolo incisivo","sommario":"1-2 frasi ricche sull'angolo di analisi e perché conta ora","dati_chiave":["dato con contesto","dato2"],"fonte_principale":"testata - titolo - data - url","angolo":"es. redditività / player trading / indebitamento","perche_interessa":"1 frase per il lettore","tipo":"protagonista","punteggi":{"attualita":4,"rilevanza":4,"concretezza":3,"novita":5}},{"...":"..."}],
    "deal": [{"...":"..."}],
    "metrica": [{"...":"..."}]
  },
  "brief_narrativo": "3-4 frasi: cosa ha dominato la settimana e il fil rouge",
  "raccomandazione": {"tema":"il tema più forte","sezione":"bilancio","perche":"2-3 frasi","angolo_editoriale":"l'angolo preciso"},
  "note_editoriali": "temi da evitare / contesto"
}
La raccomandazione sarà ricalcolata dopo la verifica: scrivila comunque.`;

  // ── Fase 2b: Genera JSON ─────────────────────────────────────────────────
  const jsonSystemSimple = 'Sei un convertitore JSON. Rispondi SOLO con JSON valido. Nessun testo aggiuntivo.';
  let jsonPrompt_result = '';
  try {
    jsonPrompt_result = await callClaude([{ role: 'user', content: jsonPrompt }], jsonSystemSimple, false, 'claude-sonnet-4-6', 12000);
    console.log('JSON generato, length:', jsonPrompt_result.length);
  } catch(e) {
    console.error('Generazione JSON fallita:', e.message);
    jsonPrompt_result = '{}';
  }

  // ── Fase 3: Parse (con recupero JSON troncato) ───────────────────────────
  let brief = parseBriefJson(jsonPrompt_result);
  if (!brief) {
    console.warn('JSON non valido, retry con budget token ampio...');
    const retry = await callClaude([
      { role: 'user', content: `Oggi è ${oggi}. Brief Scout per Valore Atteso in JSON valido.` },
      { role: 'assistant', content: testoRicerca },
      { role: 'user', content: 'JSON malformato. Rispondi SOLO con JSON valido, nessun testo aggiuntivo.' }
    ], jsonSystemSimple, false, 'claude-sonnet-4-6', 12000);
    brief = parseBriefJson(retry);
    if (!brief) throw new Error('JSON non valido dopo retry');
  }

  // Valida temi_per_sezione
  if (!brief) brief = {};
  if (!brief.temi_per_sezione) brief.temi_per_sezione = { bilancio: [], deal: [], metrica: [] };
  ['bilancio','deal','metrica'].forEach(s => {
    brief.temi_per_sezione[s] = (brief.temi_per_sezione[s] || []).slice(0, 5);
  });
  console.log(`Temi: bilancio=${brief.temi_per_sezione.bilancio.length}, deal=${brief.temi_per_sezione.deal.length}, metrica=${brief.temi_per_sezione.metrica.length}`);

  // ── Fase 3.5: verifica fatti — corregge i dettagli, rimuove solo i temi falsi
  console.log('Fase 3.5: verifica fatti (web search)...');
  const verifica = await verificaBrief(brief, oggi);
  console.log(`Verifica fatti completata: ${verifica.corretti} corretto/i, ${verifica.rimossi} rimosso/i perché falso/i.`);
  const titoliRimossi = [...verifica.titoliRimossi];

  // ── Fase 3.6: se una sezione ha meno di 3 opzioni, un solo giro di rifornimento
  if (sezioniScarne(brief).length) {
    console.log('Fase 3.6: sezioni con meno di', MIN_OPZIONI, 'opzioni:', sezioniScarne(brief).join(', '), '— ricerca mirata...');
    await rifornisciSezioni(brief, oggi, stagionale + wikiContext);
  }

  // ── Fase 3.7: punteggio, ordinamento e sintesi riscritta sui temi rimasti
  ordinaPerPunteggio(brief);
  const sintesi = await sintetizzaBrief(brief, oggi, titoliRimossi);
  if (sintesi) {
    brief.brief_narrativo = sintesi.brief_narrativo;
    brief.raccomandazione = sintesi.raccomandazione;
    brief.note_editoriali = sintesi.note_editoriali;
  } else {
    brief.raccomandazione = raccomandazioneFallback(brief);
    brief.brief_narrativo = brief.brief_narrativo || '';
  }
  const scarne = sezioniScarne(brief);
  if (scarne.length) {
    const avviso = `Sezioni con meno di ${MIN_OPZIONI} opzioni: ${scarne.map(s => `${s} (${brief.temi_per_sezione[s].length})`).join(', ')}. Puoi scrivere un tuo argomento nella pagina di selezione.`;
    brief.note_editoriali = (brief.note_editoriali ? brief.note_editoriali + ' ' : '') + avviso;
  }
  brief.scartati = titoliRimossi;
  console.log(`Temi finali: bilancio=${brief.temi_per_sezione.bilancio.length}, deal=${brief.temi_per_sezione.deal.length}, metrica=${brief.temi_per_sezione.metrica.length}. Raccomandato: ${brief.raccomandazione ? brief.raccomandazione.tema : 'nessuno'}`);

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
  await inviaNotificaScout(brief, driveFiles, selectionToken, oggi, start);
}

module.exports = {
  calcolaPunteggio, ordinaPerPunteggio, raccomandazioneFallback, sezioniScarne,
  verificaBrief, sintetizzaBrief, rifornisciSezioni, inviaNotificaScout, parseBriefJson
};

if (require.main === module) {
  main().catch(async e => {
    console.error('ERRORE Scout:', e.message);
    await logRun('scout', 'error', e.message).catch(() => {});
    process.exit(1);
  });
}
