// scripts/growth-agent.js — Growth Agent v3 con nuovo design email
const { memGet, memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');
const { logUsage } = require('../lib/ai-usage');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function supaFetch(path) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

async function callClaude(prompt) {
  const model = 'claude-haiku-4-5-20251001';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 600,
      messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const d = await r.json();
  logUsage('growth', model, d.usage);
  return d.content[0].text;
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const tutti      = await supaFetch('/rest/v1/subscribers?select=email,confirmed,created_at&order=created_at.asc');
  const confermati = tutti.filter(s => s.confirmed);
  const ora        = Date.now();
  const sett1fa    = new Date(ora - 7  * 86400000).toISOString();
  const sett2fa    = new Date(ora - 14 * 86400000).toISOString();
  const mese1fa    = new Date(ora - 30 * 86400000).toISOString();
  const mese2fa    = new Date(ora - 60 * 86400000).toISOString();

  const nuoviSett  = confermati.filter(s => s.created_at >= sett1fa).length;
  const nuoviSett2 = confermati.filter(s => s.created_at >= sett2fa && s.created_at < sett1fa).length;
  const nuoviMese  = confermati.filter(s => s.created_at >= mese1fa).length;
  const nuoviMese2 = confermati.filter(s => s.created_at >= mese2fa && s.created_at < mese1fa).length;
  const tassoConv  = tutti.length > 0 ? ((confermati.length / tutti.length) * 100).toFixed(1) : 0;
  const vel7gg     = (nuoviSett / 7).toFixed(1);
  const mancano100 = Math.max(0, 100 - confermati.length);
  const mancano200 = Math.max(0, 200 - confermati.length);
  const giorni100  = parseFloat(vel7gg) > 0 ? Math.ceil(mancano100 / parseFloat(vel7gg)) : null;
  const giorni200  = parseFloat(vel7gg) > 0 ? Math.ceil(mancano200 / parseFloat(vel7gg)) : null;
  const data100    = giorni100 ? new Date(ora + giorni100 * 86400000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : 'N/D';
  const data200    = giorni200 ? new Date(ora + giorni200 * 86400000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : 'N/D';
  const deltaSett  = nuoviSett2 > 0 ? (((nuoviSett - nuoviSett2) / nuoviSett2) * 100).toFixed(0) : null;
  const edizioni   = await supaFetch('/rest/v1/editions?select=num,title,sent_count&published=eq.true&order=num.desc&limit=3');
  const prevReport = await memGet('growth_report');
  const deltaAss   = confermati.length - (prevReport?.value?.confermati || 0);

  // AI analisi
  const prompt = `Sei il growth analyst di Valore Atteso (newsletter calcio business, target M&A/PE/finanza).
DATI: ${confermati.length} iscritti confermati (+${deltaAss} vs settimana scorsa), +${nuoviSett} nuovi questa settimana (prec. ${nuoviSett2}), conversione ${tassoConv}%, velocità ${vel7gg}/giorno.
Dammi JSON: {"valutazione":"max 20 parole dirette","azioni":["azione concreta 1","azione concreta 2","azione concreta 3"],"rischio":"max 20 parole"}`;

  let analisi = { valutazione: 'Dati raccolti.', azioni: ['Pubblica su LinkedIn', 'Controlla conversione', 'Analizza fonti'], rischio: 'Monitorare ritmo crescita.' };
  try {
    const raw = await callClaude(prompt);
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) analisi = JSON.parse(m[0]);
  } catch(e) { console.warn('AI fallita:', e.message); }

  const report = { data: new Date().toISOString(), confermati: confermati.length, nuovi_7gg: nuoviSett, tasso_conversione: parseFloat(tassoConv), velocita_giornaliera: parseFloat(vel7gg), proiezione_100: data100, proiezione_200: data200, analisi };
  await memSet('growth_report', report, 'growth');

  // Colori semaforo
  const sc = (v, g, y) => v >= g ? '#1B4332' : v >= y ? '#8E6B33' : '#C8251D';
  const scSub = (v, g, y) => v >= g ? '#4ADE80' : v >= y ? '#FCD34D' : '#FCA5A5';

  const html = agentEmail({
    agentName: 'Growth Agent',
    agentKey: 'growth',
    status: 'success',
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      { type: 'narrative', label: 'Lettura della settimana', text: `"${analisi.valutazione}"`, dark: true },
      { type: 'kpi_grid', kpis: [
        { label: 'Confermati',   value: confermati.length, color: '#1A1A1A', sub: `+${deltaAss} vs sett.`, subColor: deltaAss >= 0 ? '#1B4332' : '#C8251D' },
        { label: 'Nuovi 7gg',    value: `+${nuoviSett}`,   color: sc(nuoviSett, 5, 2), sub: deltaSett !== null ? `${deltaSett > 0 ? '↑' : '↓'} ${Math.abs(deltaSett)}% vs prec.` : '—', subColor: sc(parseFloat(deltaSett||0), 0, -20) },
        { label: 'Conversione',  value: `${tassoConv}%`,   color: sc(parseFloat(tassoConv), 70, 50), sub: 'target >70%', subColor: '#9A9690' },
        { label: 'Iscr./giorno', value: vel7gg,             color: '#1A1A1A', sub: 'media 7gg', subColor: '#9A9690' },
      ]},
      { type: 'dark_cards', label: 'Proiezioni a ritmo attuale', cards: [
        { label: '100 iscritti', value: confermati.length >= 100 ? '✓ Raggiunto' : data100, valueColor: confermati.length >= 100 ? '#4ADE80' : '#FFFDF8', sub: confermati.length < 100 ? `mancano ${mancano100}` : null, labelColor: '#9A9690' },
        { label: '200 iscr. → primo sponsor', value: confermati.length >= 200 ? '✓ Raggiunto' : data200, valueColor: '#C8A97A', sub: confermati.length < 200 ? `mancano ${mancano200}` : null, labelColor: '#C8A97A', accent: '200,169,122' },
      ]},
      { type: 'actions', items: analisi.azioni },
      { type: 'alert', text: analisi.rischio, type: 'warning' },
      ...(edizioni.length ? [{ type: 'table', label: 'Ultime edizioni', headers: [
        { label: 'Edizione', align: 'left' }, { label: 'Titolo', align: 'left' }, { label: 'Inviata a', align: 'right' }
      ], rows: edizioni.map(e => [
        { value: `#${e.num}`, mono: true, color: '#8E6B33', bold: true },
        { value: e.title, mono: false },
        { value: e.sent_count || '—', mono: true, align: 'right', bold: true }
      ]) }] : []),
    ]
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Growth VA · ${confermati.length} iscritti · +${nuoviSett} questa settimana`, html })
  });

  await logRun('growth', 'success', `${confermati.length} confermati (+${deltaAss}), +${nuoviSett} nuovi, conv. ${tassoConv}%`, report, Date.now()-start);
  console.log(`Growth Agent completato. Iscritti: ${confermati.length}`);
}

main().catch(async e => { console.error('ERRORE:', e.message); await logRun('growth','error',e.message).catch(()=>{}); process.exit(1); });
