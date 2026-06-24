/**
 * Bilancio Ingest Agent
 * ─────────────────────────────────────────────────────────────────────────
 * Legge i PDF dei bilanci da una cartella Google Drive condivisa, estrae il
 * conto economico riclassificato + anagrafica + deal (SOLO dalla nota
 * integrativa / fatti di rilievo) via Claude, e scrive su Supabase come
 * BOZZA (verified=false). Nulla va live finche Paolo non approva.
 *
 * Trigger: workflow_dispatch o schedule (vedi .github/workflows/bilancio-ingest.yml)
 * Env richieste: GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_FOLDER_ID, ANTHROPIC_KEY,
 *                SUPABASE_URL, SUPABASE_KEY, RESEND_KEY, APPROVAL_EMAIL
 */

const DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY;
const DRIVE_FOLDER  = process.env.GOOGLE_DRIVE_FOLDER_ID || '17BSJKFDEv6aTll5-kGxb1kxQkEyfVTsr';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const RESEND_KEY    = process.env.RESEND_KEY;
const APPROVAL_EMAIL = (process.env.APPROVAL_EMAIL || '').trim();

const MODEL = 'claude-opus-4-8';
const MEM_KEY = 'bilancio_ingest_processed';
const MAX_PDF_BYTES = 30 * 1024 * 1024; // limite document API ~32MB

/* ── Supabase REST (service key, bypassa RLS) ── */
function sbHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}
async function sbSelect(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: sbHeaders() });
  if (!r.ok) throw new Error('Supabase select ' + r.status + ': ' + (await r.text()));
  return r.json();
}
async function sbInsert(table, obj) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST', headers: sbHeaders({ Prefer: 'return=representation' }), body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error('Supabase insert ' + table + ' ' + r.status + ': ' + (await r.text()));
  return r.json();
}
async function sbPatch(table, filter, obj) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH', headers: sbHeaders({ Prefer: 'return=representation' }), body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error('Supabase patch ' + table + ' ' + r.status + ': ' + (await r.text()));
  return r.json();
}

/* ── memoria file gia processati ── */
async function getProcessed() {
  try {
    const rows = await sbSelect('agent_memory?select=value&key=eq.' + MEM_KEY + '&limit=1');
    if (rows.length && Array.isArray(rows[0].value)) return rows[0].value;
  } catch (e) { console.warn('getProcessed:', e.message); }
  return [];
}
async function setProcessed(ids) {
  const exists = await sbSelect('agent_memory?select=key&key=eq.' + MEM_KEY + '&limit=1');
  const payload = { value: ids, written_by: 'bilancio-ingest' };
  if (exists.length) await sbPatch('agent_memory', 'key=eq.' + MEM_KEY, payload);
  else await sbInsert('agent_memory', Object.assign({ key: MEM_KEY }, payload));
}

/* ── Google Drive ── */
async function listDrivePdfs() {
  const url = 'https://www.googleapis.com/drive/v3/files?q=%27' + DRIVE_FOLDER +
    '%27+in+parents+and+mimeType=%27application/pdf%27+and+trashed=false' +
    '&key=' + DRIVE_API_KEY + '&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime+desc&pageSize=50';
  const r = await fetch(url);
  if (!r.ok) throw new Error('Drive list ' + r.status + ': ' + (await r.text()));
  return (await r.json()).files || [];
}
async function downloadDrivePdfBase64(fileId) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&key=' + DRIVE_API_KEY;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Drive download ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return { base64: buf.toString('base64'), bytes: buf.length };
}

/* ── estrazione via Claude (PDF -> JSON) ── */
const EXTRACTION_PROMPT = `Sei un analista M&A. Dal bilancio allegato (PDF, anche scansionato) estrai i dati e restituisci SOLO un oggetto JSON valido, senza markdown, senza commenti.

Regole INDEROGABILI:
- Usa esclusivamente numeri presenti nel documento. Mai stimare. Se una voce non c'e, metti null.
- Tutti gli importi in MILIONI di euro (€M), arrotondati a 1 decimale (es. 567.0, -29.9).
- I costi nel conto economico vanno espressi come valori POSITIVI (il segno lo gestisce il tool).
- net_debt = posizione finanziaria netta: debiti finanziari meno liquidita. Positivo = indebitamento, negativo = cassa netta.
- I "deals" devono venire SOLO dal bilancio: sezione debiti/strumenti finanziari della nota integrativa (bond: importo, cedola, scadenza), fatti di rilievo, operazioni con parti correlate. NIENTE notizie di stampa o stime.

Schema JSON da restituire:
{
  "club": {"slug":"minuscolo-senza-spazi","name":"nome breve","full_name":"ragione sociale","league":"Serie A","country":"Italia","owner":"azionista di controllo","stadium":"stadio","capacity":numero|null,"founded":anno|null,"color_primary":"#hex|null","color_secondary":"#hex|null"},
  "financials": {
    "season":"2024-25","source":"es: Bilancio Consolidato X al 30/06/2025","source_date":"YYYY-MM-DD|null",
    "revenue_total":num,"revenue_broadcast":num|null,"revenue_commercial":num|null,"revenue_matchday":num|null,"player_trading_income":num|null,"revenue_other":num|null,
    "wages":num|null,"amortization":num|null,"ebitda":num|null,"ebit":num|null,"net_result":num,"net_debt":num|null,"equity":num|null,"squad_cost_ratio":num|null,
    "notes":"1-2 frasi di sintesi fattuale",
    "pnl": {"ricavi_vendita":num|null,"variazione_prodotti":num|null,"altri_ricavi":num|null,"valore_produzione":num,"valore_produzione_prev":num|null,"costo_materie":num|null,"costo_servizi":num|null,"costo_personale":num|null,"oneri_diversi":num|null,"accantonamenti":num|null,"affitti_noleggi":num|null,"ebitda":num|null,"amm_immateriali":num|null,"amm_materiali":num|null,"ammortamenti":num|null,"svalut_immobiliari":num|null,"svalut_crediti":num|null,"svalutazioni":num|null,"ebit":num|null,"proventi_finanziari":num|null,"oneri_finanziari":num|null,"utili_cambi":num|null,"saldo_finanziaria":num|null,"proventi_straordinari":num|null,"oneri_straordinari":num|null,"saldo_straordinaria":num|null,"ebt":num|null,"imposte":num|null,"reddito_netto":num}
  },
  "deals": [{"deal_type":"financing|transfer|ownership|commercial","title":"breve","description":"1-2 frasi","value_text":"es: €350M, cedola 4,52%","source":"sezione del bilancio"}]
}`;

async function extract(base64) {
  const body = {
    model: MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: EXTRACTION_PROMPT }
      ]
    }]
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + (await r.text()));
  const data = await r.json();
  let text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(text);
}

/* ── scrittura su Supabase (bozza, verified=false) ── */
async function upsertClub(club) {
  const found = await sbSelect('clubs?select=id,sort_order&slug=eq.' + encodeURIComponent(club.slug) + '&limit=1');
  if (found.length) return found[0].id;
  const all = await sbSelect('clubs?select=sort_order&order=sort_order.desc&limit=1');
  const nextOrder = (all.length ? (all[0].sort_order || 0) : 0) + 1;
  const row = {
    slug: club.slug, name: club.name, full_name: club.full_name, league: club.league || 'Serie A',
    country: club.country || 'Italia', owner: club.owner || null, stadium: club.stadium || null,
    capacity: club.capacity || null, founded: club.founded || null,
    color_primary: club.color_primary || '#0099E5', color_secondary: club.color_secondary || '#19E0C8',
    sort_order: nextOrder
  };
  const ins = await sbInsert('clubs', row);
  return ins[0].id;
}
async function upsertFinancials(clubId, f) {
  const fin = {
    club_id: clubId, season: f.season, revenue_total: f.revenue_total,
    revenue_broadcast: f.revenue_broadcast, revenue_commercial: f.revenue_commercial,
    revenue_matchday: f.revenue_matchday, revenue_other: f.revenue_other,
    player_trading_income: f.player_trading_income, wages: f.wages, amortization: f.amortization,
    ebitda: f.ebitda, ebit: f.ebit, net_result: f.net_result, net_debt: f.net_debt,
    equity: f.equity, squad_cost_ratio: f.squad_cost_ratio, pnl: f.pnl,
    source: f.source, source_date: f.source_date || null, notes: f.notes || null,
    verified: false
  };
  const existing = await sbSelect('club_financials?select=id&club_id=eq.' + clubId + '&season=eq.' + encodeURIComponent(f.season) + '&limit=1');
  if (existing.length) await sbPatch('club_financials', 'id=eq.' + existing[0].id, fin);
  else await sbInsert('club_financials', fin);
}
async function insertDeals(clubId, deals, season) {
  if (!Array.isArray(deals) || !deals.length) return;
  // rimuove eventuali deal bozza precedenti per quel club/stagione, poi reinserisce
  await fetch(SUPABASE_URL + '/rest/v1/club_deals?club_id=eq.' + clubId + '&season=eq.' + encodeURIComponent(season), {
    method: 'DELETE', headers: sbHeaders()
  });
  const rows = deals.map((d, i) => ({
    club_id: clubId, deal_type: d.deal_type || 'financing', title: d.title,
    description: d.description, value_text: d.value_text, season: season,
    source: d.source || 'Bilancio', sort_order: i
  }));
  await sbInsert('club_deals', rows);
}

/* ── email di review ── */
async function emailReview(summary) {
  if (!RESEND_KEY || !APPROVAL_EMAIL) return;
  const rows = summary.map(s => s.ok
    ? `<li><b>${s.name}</b> (${s.season}): ricavi €${s.revenue_total}M, risultato €${s.net_result}M — <i>bozza da approvare</i></li>`
    : `<li><b>${s.file}</b>: errore — ${s.error}</li>`).join('');
  const html = `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#1A1A1A">
    <div style="background:#1A1A1A;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:.1em;color:#C8A97A">CLUB INTELLIGENCE</div>
      <div style="font-size:19px;font-weight:700;margin-top:4px">Nuovi bilanci estratti</div>
    </div>
    <div style="background:#F5F2EB;padding:20px 22px;border-radius:0 0 8px 8px;line-height:1.6;font-size:14px">
      <p>L'agente ha letto i PDF dalla cartella Drive e ha creato delle <b>bozze</b> su Supabase. Restano invisibili sul sito finche non le approvi (verified=true).</p>
      <ul>${rows}</ul>
      <p style="font-size:12px;color:#555">Verifica i numeri contro il bilancio, poi approva. Le bozze NON sono pubblicate automaticamente.</p>
    </div></div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
    body: JSON.stringify({ from: 'Club Intelligence <info@valoreatteso.com>', to: [APPROVAL_EMAIL],
      subject: 'Bilanci estratti — ' + summary.filter(s => s.ok).length + ' bozze da approvare', html })
  }).catch(e => console.warn('email:', e.message));
}

async function logRun(status, detail) {
  try { await sbInsert('agent_runs', { agent: 'bilancio-ingest', status, detail }); }
  catch (e) { /* tabella opzionale */ }
}

/* ── main ── */
async function main() {
  if (!DRIVE_API_KEY || !DRIVE_FOLDER) { console.log('Drive non configurato (GOOGLE_DRIVE_API_KEY / _FOLDER_ID). Skip.'); return; }
  if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_KEY) { console.log('Env mancanti (Anthropic/Supabase). Skip.'); return; }

  const files = await listDrivePdfs();
  console.log('Drive: ' + files.length + ' PDF trovati');
  const processed = await getProcessed();
  const todo = files.filter(f => !processed.includes(f.id));
  console.log('Da processare: ' + todo.length);
  if (!todo.length) { await logRun('ok', 'nessun nuovo bilancio'); return; }

  const summary = [];
  const newProcessed = processed.slice();

  for (const file of todo.slice(0, 5)) { // max 5 per run
    try {
      console.log('→ ' + file.name);
      const { base64, bytes } = await downloadDrivePdfBase64(file.id);
      if (bytes > MAX_PDF_BYTES) { summary.push({ ok: false, file: file.name, error: 'PDF > 30MB, comprimere' }); newProcessed.push(file.id); continue; }
      const data = await extract(base64);
      if (!data || !data.club || !data.club.slug || !data.financials || data.financials.revenue_total == null) {
        summary.push({ ok: false, file: file.name, error: 'estrazione incompleta' }); newProcessed.push(file.id); continue;
      }
      const clubId = await upsertClub(data.club);
      await upsertFinancials(clubId, data.financials);
      await insertDeals(clubId, data.deals, data.financials.season);
      newProcessed.push(file.id);
      summary.push({ ok: true, name: data.club.name, season: data.financials.season,
        revenue_total: data.financials.revenue_total, net_result: data.financials.net_result });
      console.log('  ✓ bozza creata: ' + data.club.name);
    } catch (e) {
      console.error('  ✗ ' + file.name + ': ' + e.message);
      summary.push({ ok: false, file: file.name, error: e.message });
      newProcessed.push(file.id); // evita loop infinito su file problematici
    }
  }

  await setProcessed(newProcessed);
  await emailReview(summary);
  await logRun('ok', JSON.stringify(summary).slice(0, 1000));
  console.log('Fatto. ' + summary.filter(s => s.ok).length + ' bozze create.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
