// scripts/seo-agent.js — SEO Agent con nuovo design email
const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function callClaude(messages, system, useSearch = false) {
  const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system, messages };
  if (useSearch) { body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]; body.tool_choice = { type: 'auto' }; }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const d = await r.json();
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  console.log('SEO Agent avviato:', new Date().toISOString());

  const system = `Sei il SEO specialist di Valore Atteso, newsletter italiana sul business del calcio europeo.
Target: professionisti M&A, PE, consulenza, finanza. Sito: valoreatteso.com.
Analizza keyword trends attuali e fornisci raccomandazioni concrete per ottimizzare la visibilità organica.
Rispondi SOLO in JSON valido.`;

  const raw = await callClaude([{ role: 'user', content: `Analizza le keyword trends settimana ${oggi} per Valore Atteso.
Cerca: keyword calcio finanza business sport M&A trending, volume di ricerca italiano, difficoltà SEO.
JSON: {
  "keywords": [{"keyword":"...","volume":"alto|medio|basso","trend":"↑|→|↓","opportunita":"...","difficolta":"alta|media|bassa"}],
  "keyword_principale": "la keyword da targetare questa settimana",
  "titolo_suggerito": "titolo SEO ottimizzato per la prossima edizione",
  "meta_description": "meta description 155 caratteri",
  "note": "note editoriali SEO"
}` }], system, true);

  let seo = { keywords: [], keyword_principale: 'calcio finanza', titolo_suggerito: '', meta_description: '', note: '' };
  try {
    const m = raw.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    if (m) seo = JSON.parse(m[0].replace(/[\x00-\x1F\x7F]/g,' ').replace(/,(\s*[}\]])/g,'$1'));
  } catch(e) { console.warn('Parse fallito:', e.message); }

  await memSet('seo_keywords', seo, 'seo');

  const kwRows = (seo.keywords || []).slice(0, 8).map(k => [
    { value: k.keyword, mono: false, bold: true },
    { value: k.volume, mono: true, color: k.volume === 'alto' ? '#1B4332' : k.volume === 'medio' ? '#8E6B33' : '#9A9690' },
    { value: k.trend, mono: true, color: k.trend === '↑' ? '#1B4332' : k.trend === '↓' ? '#C8251D' : '#9A9690', bold: true },
    { value: k.difficolta, mono: true, color: k.difficolta === 'bassa' ? '#1B4332' : k.difficolta === 'alta' ? '#C8251D' : '#8E6B33' },
    { value: k.opportunita || '—', mono: false, color: '#4A4845' },
  ]);

  const html = agentEmail({
    agentName: 'SEO Agent',
    agentKey: 'seo',
    status: 'success',
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      { type: 'dark_cards', label: 'Raccomandazione settimana', cards: [
        { label: 'Keyword principale', value: seo.keyword_principale, valueColor: '#C8A97A', labelColor: '#9A9690' },
      ]},
      { type: 'narrative', label: 'Titolo SEO suggerito', text: seo.titolo_suggerito || '—' },
      { type: 'narrative', label: 'Meta description', text: seo.meta_description || '—' },
      ...(kwRows.length ? [{ type: 'table', label: `Keyword trends (${seo.keywords?.length || 0})`, headers: [
        { label: 'Keyword' }, { label: 'Volume', align: 'center' }, { label: 'Trend', align: 'center' }, { label: 'Difficoltà', align: 'center' }, { label: 'Opportunità' }
      ], rows: kwRows }] : []),
      ...(seo.note ? [{ type: 'alert', text: seo.note, type: 'info' }] : []),
    ]
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `SEO VA · Keyword: ${seo.keyword_principale} · ${oggi}`, html })
  });

  await logRun('seo', 'success', `Keyword principale: ${seo.keyword_principale}. ${seo.keywords?.length || 0} keyword analizzate.`, seo, Date.now()-start);
  console.log(`SEO Agent completato. Keyword: ${seo.keyword_principale}`);
}

main().catch(async e => { console.error('ERRORE:', e.message); await logRun('seo','error',e.message).catch(()=>{}); process.exit(1); });
