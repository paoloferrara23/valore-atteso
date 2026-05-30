// scripts/scout.js — Scout Agent v2.1
// Web search libero su fonti certificate → verifica con Drive → brief + approvazione

const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

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

async function callClaude(messages, system, useSearch = false) {
  const body = {
    model: 'claude-opus-4-5',
    max_tokens: 5000,
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
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const settimana = new Date().toLocaleDateString('it-IT');
  console.log('Scout v2.1 avviato:', new Date().toISOString());

  // ── Fase 1: Leggi biblioteca Drive ──────────────────────────────────────
  const { files: driveFiles, context: driveContext } = await leggiDrive();

  const driveInfo = driveFiles.length > 0
    ? `\n\nBIBLIOTECA VA — DOCUMENTI CARICATI DA PAOLO (usa per verificare/integrare i numeri trovati online):\n${driveContext}\n\nFile disponibili: ${driveFiles.join(', ')}`
    : '\n\n[Nessun documento nella biblioteca Drive — usa solo fonti web]';

  // ── Fase 2: Web search ───────────────────────────────────────────────────
  console.log('Fase 2: ricerca web...');

  const system = `Sei lo Scout senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Target lettori: professionisti M&A, PE, consulenza, finanza.

COMPITO QUESTA SETTIMANA:
1. Cerca con web search le notizie più rilevanti degli ultimi 7 giorni sul business del calcio europeo
2. Per ogni dato finanziario trovato online, verifica se c'è conferma nei documenti della Biblioteca VA
3. Genera un brief con raccomandazione singola forte + brief narrativo per Paolo

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

REGOLA FONTI:
- Cita SEMPRE la fonte con link diretto all'articolo specifico
- Se un numero è confermato dalla Biblioteca VA, aggiungi "✓ confermato da Biblioteca VA — [nome doc]"
- Se non hai fonte verificabile per un dato, non includerlo
- ESCLUDI: gossip mercato, risultati sportivi puri, notizie senza dati verificabili
${driveInfo}

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

  const testoRicerca = await callClaude([{
    role: 'user',
    content: `Oggi è ${oggi}.

Cerca le notizie più rilevanti degli ultimi 7 giorni sul business del calcio europeo (Serie A, Premier League, Liga, Bundesliga, Ligue 1, deal cross-border).

Priorità alla qualità sulla quantità: meglio 4 temi solidi con dati verificati che 8 superficiali.

Per ogni tema trovato:
1. Cerca il link DIRETTO all'articolo (non la homepage)
2. Estrai i dati finanziari chiave
3. Se hai documenti in biblioteca, usa il contesto fornito per verificare/integrare i numeri
4. Assegna sezione suggerita e priorità

Poi genera il JSON completo.`
  }], system, true);

  // ── Fase 3: Parse ────────────────────────────────────────────────────────
  let brief;
  try {
    const raw = testoRicerca.replace(/```json|```/g, '').trim();
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
  const sezioni = ['bilancio', 'deal', 'metrica'];
  if (!brief.temi_per_sezione) brief.temi_per_sezione = { bilancio: [], deal: [], metrica: [] };
  sezioni.forEach(s => {
    brief.temi_per_sezione[s] = (brief.temi_per_sezione[s] || []).slice(0, 3);
  });
  const totTemi = sezioni.reduce((acc, s) => acc + (brief.temi_per_sezione[s]?.length || 0), 0);
  console.log(`Temi per sezione: bilancio=${brief.temi_per_sezione.bilancio?.length}, deal=${brief.temi_per_sezione.deal?.length}, metrica=${brief.temi_per_sezione.metrica?.length}`);

  // ── Fase 4: Salva pending con token approvazione ─────────────────────────
  const selectionToken = generateToken();

  await supaUpsert('scout_pending', {
    ...brief,
    drive_files: driveFiles,
    selection_token: selectionToken
  }, 'scout');

  // ── Fase 5: Email con approvazione ───────────────────────────────────────
  const selectUrl = `${SITE_URL}/api/scout-select?token=${selectionToken}`;

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

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `Scout VA · ${brief.raccomandazione?.tema || brief.temi[0]?.titolo || 'Brief settimanale'} · approva →`,
      html
    })
  });

  await logRun('scout', 'pending_approval',
    `9 opzioni (3 per sezione). Drive: ${driveFiles.length} file. In attesa selezione temi.`,
    { drive: driveFiles, raccomandazione: brief.raccomandazione },
    Date.now() - start
  );

  console.log(`Scout completato in ${Date.now()-start}ms. Temi: ${brief.temi.length}, Drive: ${driveFiles.length} file.`);
}

main().catch(async e => {
  console.error('ERRORE Scout:', e.message);
  await logRun('scout', 'error', e.message).catch(() => {});
  process.exit(1);
});
