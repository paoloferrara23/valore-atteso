// scripts/seo-agent.js — SEO Agent v3 con parse robusto
const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function callClaude(messages, system, useSearch = false) {
  const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system, messages };
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
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const d = await r.json();
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function parseRobust(text) {
  const raw = text.replace(/```json|```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Nessun JSON trovato');
  let jsonStr = match[0]
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/,(\s*[}\]])/g, '$1');
  // Normalizza newlines nelle stringhe
  jsonStr = jsonStr.replace(/"((?:[^"\\]|\\.)*)"/g, (m, s) =>
    '"' + s.replace(/\n/g, ' ').replace(/\r/g, '').replace(/↑/g, 'su').replace(/↓/g, 'giu').replace(/→/g, 'stabile') + '"'
  );
  return JSON.parse(jsonStr);
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  console.log('SEO Agent v3 avviato:', new Date().toISOString());

  // ── Fase 1: Ricerca web — testo libero ──────────────────────────────────
  const systemRicerca = `Sei il SEO specialist di Valore Atteso, newsletter italiana sul business del calcio europeo. Target: professionisti M&A, PE, consulenza, finanza.`;

  const testoRicerca = await callClaude([{
    role: 'user',
    content: `Analizza le keyword trends per Valore Atteso (${oggi}). Cerca keyword su: calcio finanza business sport M&A Italia, volume di ricerca, difficolta SEO, trend. Scrivi in italiano, testo semplice NON JSON.`
  }], systemRicerca, true);

  console.log('Fase 1 completata, lunghezza:', testoRicerca.length);

  // ── Fase 2: Conversione in JSON — senza web search ──────────────────────
  const jsonPrompt = `Converti questa analisi SEO in JSON valido. REGOLE: stringhe max 100 caratteri, nessun apostrofo, usa solo caratteri ASCII, trend deve essere una parola (crescita/stabile/calo).

ANALISI:
${testoRicerca.slice(0, 5000)}

JSON:
{
  "keywords": [
    {"keyword":"parola chiave","volume":"alto","trend":"crescita","opportunita":"breve descrizione","difficolta":"media"}
  ],
  "keyword_principale": "la keyword principale",
  "titolo_suggerito": "titolo SEO ottimizzato max 60 caratteri",
  "meta_description": "meta description max 155 caratteri",
  "note": "note editoriali brevi"
}`;

  let seo = { keywords: [], keyword_principale: 'business calcio', titolo_suggerito: '', meta_description: '', note: '' };

  try {
    const jsonRaw = await callClaude([{ role: 'user', content: jsonPrompt }],
      'Sei un convertitore JSON. Rispondi SOLO con JSON valido. Nessun testo aggiuntivo.',
      false
    );
    seo = parseRobust(jsonRaw);
    // Normalizza trend per usare emoji nelle righe
    seo.keywords = (seo.keywords || []).map(k => ({
      ...k,
      trend_emoji: k.trend === 'crescita' ? '↑' : k.trend === 'calo' ? '↓' : '→'
    }));
    console.log(`Parse OK: ${seo.keywords.length} keyword, principale: ${seo.keyword_principale}`);
  } catch(e) {
    console.warn('Parse fallito, uso dati parziali:', e.message);
    // Estrai almeno il testo libero per il narrative
    seo.note = testoRicerca.slice(0, 300).replace(/[^\w\s.,;:àèìòù]/g, ' ');
  }

  await memSet('seo_keywords', seo, 'seo');

  const kwRows = (seo.keywords || []).slice(0, 8).map(k => [
    { value: k.keyword, mono: false, bold: true },
    { value: k.volume || '—', mono: true, color: k.volume === 'alto' ? '#1B4332' : k.volume === 'medio' ? '#8E6B33' : '#9A9690' },
    { value: k.trend_emoji || k.trend || '→', mono: true, color: (k.trend === 'crescita' || k.trend_emoji === '↑') ? '#1B4332' : (k.trend === 'calo' || k.trend_emoji === '↓') ? '#C8251D' : '#9A9690', bold: true },
    { value: k.difficolta || '—', mono: true, color: k.difficolta === 'bassa' ? '#1B4332' : k.difficolta === 'alta' ? '#C8251D' : '#8E6B33' },
    { value: (k.opportunita || '—').slice(0, 60), mono: false, color: '#4A4845' },
  ]);

  const html = agentEmail({
    agentName: 'SEO Agent',
    agentKey: 'seo',
    status: 'success',
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      { type: 'dark_cards', label: 'Raccomandazione settimana', cards: [
        { label: 'Keyword principale', value: seo.keyword_principale || 'N/D', valueColor: '#C8A97A', labelColor: '#9A9690' },
      ]},
      ...(seo.titolo_suggerito ? [{ type: 'narrative', label: 'Titolo SEO suggerito', text: seo.titolo_suggerito }] : []),
      ...(seo.meta_description ? [{ type: 'narrative', label: 'Meta description', text: seo.meta_description }] : []),
      ...(kwRows.length ? [{ type: 'table', label: `Keyword trends (${seo.keywords?.length || 0})`, headers: [
        { label: 'Keyword' }, { label: 'Volume', align: 'center' }, { label: 'Trend', align: 'center' }, { label: 'Difficoltà', align: 'center' }, { label: 'Opportunità' }
      ], rows: kwRows }] : []),
      ...(seo.note ? [{ type: 'alert', text: seo.note, type: 'info' }] : []),
    ]
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `SEO VA · Keyword: ${seo.keyword_principale} · ${oggi}`,
      html
    })
  });

  await logRun('seo', 'success', `Keyword: ${seo.keyword_principale}. ${seo.keywords?.length || 0} keyword analizzate.`, seo, Date.now()-start);
  console.log(`SEO Agent completato. Keyword: ${seo.keyword_principale}`);
}

main().catch(async e => {
  console.error('ERRORE SEO:', e.message);
  await logRun('seo', 'error', e.message).catch(() => {});
  process.exit(1);
});
