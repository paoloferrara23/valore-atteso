// scripts/scout.js — Scout Agent v2
// Gira: sabato 07:00 UTC (08:00 IT)
// Flusso: web search sui siti certificati → brief narrativo → email approvazione → salva solo se approvato

const { memSet, memGet, logRun } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY    = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL      = process.env.SUPABASE_URL;
const SUPA_KEY      = process.env.SUPABASE_KEY;
const SITE_URL      = process.env.SITE_URL || 'https://valoreatteso.com';
const FROM          = 'Valore Atteso <info@valoreatteso.com>';

// ── Siti certificati ─────────────────────────────────────────────────────────
const SITI_CERTIFICATI = [
  'deloitte.com', 'footballbenchmark.com', 'uefa.com', 'ecfil.uefa.com',
  'figc.it', 'licenzenazionali.figc.it', 'fifa.com', 'pwc.com',
  'registroimprese.it', 'borsaitaliana.it', 'lazard.com',
  'apollo.com', 'aresmgmt.com', 'cliffordchance.com',
  'football-observatory.com', 'sportspro.com', 'frontofficesports.com',
  'calcioefinanza.it', 'theesk.org', 'offthepitch.com',
  'sportico.com', 'forbes.com', 'pe-insights.com', 'capology.com',
  'secretariat-intl.com', 'europeanbusinessmagazine.com',
  'ministryofsport.com', 'swissramble.substack.com',
  'ft.com', 'reuters.com', 'ilsole24ore.com'
].join(', ');

async function callClaude(messages, system, useSearch = false) {
  const body = {
    model: 'claude-opus-4-5',
    max_tokens: 4000,
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
  if (!r.ok) { const t = await r.text(); throw new Error(`Anthropic ${r.status}: ${t.slice(0,200)}`); }
  const data = await r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function supaFetch(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0,200)}`);
  return text ? JSON.parse(text) : null;
}

// ── Genera token approvazione ─────────────────────────────────────────────────
function generateApprovalToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const settimana = new Date().toLocaleDateString('it-IT');
  console.log('Scout v2 avviato:', new Date().toISOString());

  // ── FASE 1: Web search sui siti certificati ──────────────────────────────
  console.log('Fase 1: ricerca notizie...');

  const systemRicerca = `Sei lo Scout senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Target lettori: professionisti M&A, PE, consulenza, finanza.

COMPITO: trovare le notizie più rilevanti degli ultimi 7 giorni sul business del calcio europeo.

SITI CERTIFICATI DA USARE (priorità massima):
${SITI_CERTIFICATI}

CRITERI DI SELEZIONE — cerca notizie su:
- Bilanci club: risultati finanziari, ricavi, perdite, wage ratio, FFP/PSR
- M&A e deal: acquisizioni club, fondi PE, cessioni quote, valutazioni
- Diritti TV: rinnovi, aste, nuovi deal broadcasting
- Governance: cambi proprietà, CDA, ristrutturazioni debito
- Mercato trasferimenti: solo se con implicazioni finanziarie significative (>€50M o strutture deal interessanti)
- KPI settoriali: dati comparativi tra club/leghe

ESCLUDI: risultati sportivi puri, gossip, notizie senza dati verificabili.

METODOLOGIA CF per ogni tema:
- Multipli reali quando disponibili (EV/Revenue, EV/EBITDA, Price/Sales)
- Confronto con benchmark settoriale (Premier wage ratio 64%, Serie A 64%, Bundesliga 58%)
- Impatto FFP/PSR (limite UEFA: -€60M nel triennio)
- Struttura deal (equity/debt/earn-out) per M&A
- Scomposizione ricavi (matchday/broadcasting/commercial) per bilanci

IMPORTANTE: per ogni tema cita la fonte ESATTA (testata + titolo articolo + data + URL diretto all'articolo, non homepage).`;

  const testoRicerca = await callClaude([{
    role: 'user',
    content: `Oggi è ${oggi}. 
    
Cerca sulle fonti certificate le 6-8 notizie più rilevanti degli ultimi 7 giorni sul business del calcio europeo (Serie A, Premier League, Liga, Bundesliga, Ligue 1, deal cross-border).

Per ogni notizia trovata:
1. Verifica che venga da uno dei siti certificati
2. Includi il link DIRETTO all'articolo specifico
3. Estrai i dati finanziari chiave
4. Valuta la rilevanza per un lettore M&A/PE/finance

Dopo la ricerca, genera il brief JSON con questa struttura ESATTA:
{
  "settimana": "${settimana}",
  "temi": [
    {
      "titolo": "titolo editoriale preciso e incisivo",
      "notizia": "descrizione 2-3 righe: cosa è successo, quando, chi",
      "analisi_cf": "lettura finanziaria: multipli, ratios, implicazioni per investitori",
      "sezione_suggerita": "bilancio|deal|metrica",
      "priorita": 1,
      "dati_chiave": ["dato verificato con fonte", "dato2"],
      "fonti": ["Testata — Titolo articolo — DD/MM/YYYY — https://url-diretto"]
    }
  ],
  "raccomandazione": {
    "tema": "IL tema della settimana (uno solo, il più forte)",
    "sezione": "bilancio|deal|metrica",
    "perche": "2-3 righe: perché questo è il tema più rilevante per Valore Atteso questa settimana",
    "angolo_editoriale": "l'angolo specifico da cui trattarlo (es. sostenibilità del modello, implicazioni FFP, struttura del deal)"
  },
  "brief_narrativo": "3-4 righe scritte come se fossero il tuo brief all'editore: cosa ha dominato la settimana, qual è il fil rouge, cosa vale la pena approfondire e perché",
  "note_editoriali": "eventuali note su temi da evitare, angoli da considerare, contesto stagionale"
}`
  }], systemRicerca, true);

  // ── FASE 2: Parse e validazione ──────────────────────────────────────────
  let brief;
  try {
    const raw = testoRicerca.replace(/```json|```/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Nessun JSON trovato');
    let jsonStr = match[0]
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1');
    brief = JSON.parse(jsonStr);
  } catch (e) {
    console.warn('Parse JSON fallito, retry...', e.message);
    const retry = await callClaude([
      { role: 'user', content: `Oggi è ${oggi}. Genera il brief Scout per Valore Atteso in JSON valido.` },
      { role: 'assistant', content: testoRicerca },
      { role: 'user', content: 'Il JSON era malformato. Rispondi SOLO con JSON valido. Nessun testo extra.' }
    ], systemRicerca);
    const match2 = retry.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match2) throw new Error('JSON non valido dallo Scout dopo retry');
    brief = JSON.parse(match2[0].replace(/[\x00-\x1F\x7F]/g, ' ').replace(/,(\s*[}\]])/g, '$1'));
  }

  // Filtra temi senza fonti
  const temiValidi = (brief.temi || []).filter(t => t.fonti?.length > 0 && t.fonti[0] !== '');
  console.log(`Temi trovati: ${brief.temi?.length || 0}, con fonti: ${temiValidi.length}`);
  brief.temi = temiValidi;

  // ── FASE 3: Salva in pending (non ancora approvato) ──────────────────────
  const approvalToken = generateApprovalToken();
  const rejectToken = generateApprovalToken();

  await supaFetch('/rest/v1/agent_memory?on_conflict=key', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      key: 'scout_pending',
      value: { ...brief, approval_token: approvalToken, reject_token: rejectToken },
      written_by: 'scout',
      updated_at: new Date().toISOString()
    })
  });

  console.log('Brief salvato in pending, token:', approvalToken.slice(0,8));

  // ── FASE 4: Email con approvazione ───────────────────────────────────────
  const approveUrl = `${SITE_URL}/api/scout-approve?token=${approvalToken}&action=approve`;
  const rejectUrl  = `${SITE_URL}/api/scout-approve?token=${rejectToken}&action=reject`;

  const temasHTML = brief.temi.map((t, i) => {
    const sezioneColor = { bilancio: '#1B4332', deal: '#1B3A6B', metrica: '#6B1B1B' }[t.sezione_suggerita] || '#4A4845';
    const sezioneBg   = { bilancio: '#E4EDE7', deal: '#E4ECF7', metrica: '#F7E4E4' }[t.sezione_suggerita] || '#EDE9E0';
    const fontiHtml = (t.fonti || []).map(f => {
      const urlMatch = f.match(/https?:\/\/[^\s"]+/);
      const label = f.replace(/\s*—\s*https?:\/\/[^\s"]+/, '').trim();
      return urlMatch
        ? `<a href="${urlMatch[0]}" style="color:${sezioneColor};text-decoration:underline;font-size:9px">${label}</a>`
        : `<span style="font-size:9px;color:#9A9690">${label}</span>`;
    }).join('<br>');

    return `
    <tr>
      <td style="padding:16px 20px;border-bottom:2px solid #E2DDD4;vertical-align:top">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <span style="font-family:'Courier New',monospace;font-size:8px;font-weight:700;color:#fff;background:#1A1A1A;padding:2px 7px">#${i+1}</span>
          <span style="font-family:'Courier New',monospace;font-size:8px;color:#fff;background:${sezioneColor};padding:2px 8px;text-transform:uppercase;letter-spacing:.08em">${t.sezione_suggerita}</span>
          <span style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">priorità ${t.priorita}/5</span>
        </div>
        <div style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#1A1A1A;margin-bottom:6px;line-height:1.3">${t.titolo}</div>
        <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.65;margin-bottom:10px">${t.notizia}</div>
        <div style="background:${sezioneBg};padding:10px 12px;border-left:3px solid ${sezioneColor};margin-bottom:8px">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:${sezioneColor};letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px">Lettura CF</div>
          <div style="font-family:Georgia,serif;font-size:12px;color:#1A1A1A;line-height:1.55">${t.analisi_cf}</div>
        </div>
        ${t.dati_chiave?.length ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:#4A4845;margin-bottom:6px">${t.dati_chiave.join(' · ')}</div>` : ''}
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;border-top:1px solid #E2DDD4;padding-top:6px">${fontiHtml}</div>
      </td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#D8D0C4">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#D8D0C4">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#F5F2EB">

  <!-- HEADER -->
  <tr><td style="padding:22px 28px;background:#1A1A1A">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px">Valore Atteso</div>
    <div style="font-family:'Courier New',monospace;font-size:8px;color:#C8A97A;letter-spacing:.16em;text-transform:uppercase;margin-top:4px">Scout Report · ${oggi}</div>
  </td></tr>

  <!-- BRIEF NARRATIVO -->
  <tr><td style="padding:22px 28px;background:#1A1A1A;border-top:1px solid rgba(255,255,255,0.08)">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#8E6B33;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">— Brief della settimana</div>
    <div style="font-family:Georgia,serif;font-size:15px;color:#FFFDF8;line-height:1.7;font-style:italic">${brief.brief_narrativo || ''}</div>
  </td></tr>

  <!-- RACCOMANDAZIONE PRINCIPALE -->
  ${brief.raccomandazione ? `
  <tr><td style="padding:20px 28px;background:#F0EBE1;border-top:3px solid #1A1A1A;border-bottom:2px solid #C8A97A">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#8E6B33;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">— Raccomandazione della settimana</div>
    <div style="font-family:Georgia,serif;font-size:18px;font-weight:900;color:#1A1A1A;margin-bottom:8px;line-height:1.2">${brief.raccomandazione.tema}</div>
    <div style="font-family:'Courier New',monospace;font-size:9px;color:#8E6B33;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em">Sezione → ${brief.raccomandazione.sezione} · Angolo: ${brief.raccomandazione.angolo_editoriale}</div>
    <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;line-height:1.65;border-left:3px solid #C8A97A;padding-left:12px">${brief.raccomandazione.perche}</div>
  </td></tr>` : ''}

  <!-- TEMI -->
  <tr><td style="padding:0">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.16em;text-transform:uppercase;padding:14px 20px 0">— Tutti i temi (${brief.temi.length})</div>
    <table width="100%" cellpadding="0" cellspacing="0">${temasHTML}</table>
  </td></tr>

  ${brief.note_editoriali ? `
  <!-- NOTE -->
  <tr><td style="padding:14px 28px;background:#EDE9E0;border-top:1px solid #D0CBC0">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px">Note editoriali</div>
    <div style="font-family:Georgia,serif;font-size:12px;color:#4A4845;line-height:1.6;font-style:italic">${brief.note_editoriali}</div>
  </td></tr>` : ''}

  <!-- APPROVAZIONE -->
  <tr><td style="padding:28px;background:#1A1A1A;text-align:center">
    <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.5);margin-bottom:18px;letter-spacing:.06em">Approva per salvare i temi e renderli disponibili all'Editoriale Agent</div>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto">
      <tr>
        <td style="padding-right:12px">
          <a href="${approveUrl}" style="display:inline-block;background:#1B6B3A;color:#fff;font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:14px 32px;text-decoration:none">✓ Approva e salva</a>
        </td>
        <td>
          <a href="${rejectUrl}" style="display:inline-block;background:transparent;color:#9A9690;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:14px 32px;text-decoration:none;border:1px solid #444">✗ Rifiuta</a>
        </td>
      </tr>
    </table>
    <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.25);margin-top:16px">I temi NON sono ancora salvati — lo saranno solo dopo la tua approvazione</div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:12px 28px;background:#EDE9E0;border-top:1px solid #D0CBC0">
    <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">Scout Agent v2 · Valore Atteso · ${oggi}</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM,
      to: APPROVAL_EMAIL,
      subject: `Scout VA · ${brief.raccomandazione?.tema || brief.temi[0]?.titolo || 'Brief settimanale'} · approva →`,
      html
    })
  });

  await logRun('scout', 'pending_approval',
    `${brief.temi.length} temi trovati. In attesa di approvazione. Raccomandazione: ${brief.raccomandazione?.tema || '—'}`,
    { temi: brief.temi.length, raccomandazione: brief.raccomandazione },
    Date.now() - start
  );

  console.log(`Scout completato in ${Date.now()-start}ms. Email inviata, in attesa di approvazione.`);
}

main().catch(async e => {
  console.error('ERRORE Scout:', e.message);
  await logRun('scout', 'error', e.message).catch(() => {});
  process.exit(1);
});
