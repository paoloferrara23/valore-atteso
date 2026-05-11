// content-agent.js — Genera contenuti Instagram per Valore Atteso
// Gira: giovedi 10:00 | Prima esecuzione: 10 post lancio | Poi: 3 post settimanali

const { memSet, memGet, logRun, supaFetch } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts) {
  opts = opts || {};
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text: text, json: function() { return JSON.parse(text); } };
}

async function callClaude(messages, system) {
  const r = await httpRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, system: system, messages: messages })
  });
  if (!r.ok) throw new Error('Anthropic: ' + r.status + ' ' + r.text);
  const data = r.json();
  return data.content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
}

function cleanJSON(str) {
  str = str.replace(/```json|```/g, '').trim();
  const match = str.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return null;
  let json = match[0];
  json = json.replace(/[\x00-\x1F\x7F]/g, ' ');
  json = json.replace(/,(\s*[}\]])/g, '$1');
  return json;
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT');
  console.log('Content Agent avviato:', new Date().toISOString());

  const prevContent = await memGet('content_last_run').catch(function() { return null; });
  const isLancio = !prevContent;

  let edizione = null;
  try {
    const eds = await supaFetch('/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=*');
    edizione = Array.isArray(eds) && eds[0] ? eds[0] : null;
    if (edizione) console.log('Edizione: #' + edizione.num + ' - ' + edizione.title);
  } catch(e) {
    console.error('Errore edizione:', e.message);
  }

  const system = 'Sei il social media manager di Valore Atteso, newsletter italiana sul business del calcio europeo.\n' +
    'Obiettivo: portare nuovi iscritti tramite contenuti Instagram di qualita.\n' +
    'Tono: autorevole, analitico, come The Economist applicato al calcio. Zero gossip.\n' +
    'Pubblico: professionisti M&A, PE, consulenza, finanza 25-45 anni Italia.\n\n' +
    '3 TIPI DI POST:\n' +
    '1. DATO SETTIMANA - numero sorprendente dalla newsletter. CTA: leggi analisi completa link in bio.\n' +
    '2. EVERGREEN - concetto CF applicato al calcio (EBITDA, salary ratio, stadium yield, EV/Revenue, FFP). CTA: ogni martedi su Valore Atteso link in bio.\n' +
    '3. CONFRONTO - dato comparativo che genera curiosita. CTA: link in bio per iscriverti.\n\n' +
    'Per ogni post: numero, tipo, titolo_interno, quando_pubblicare, brief_chatgpt, caption, dato_principale, fonte.\n' +
    'Hashtag fissi: #calcioefinanza #businessdelcalcio #valoreatteso #newsletter #seriea #footballbusiness #finanzasportiva #privateequity\n' +
    'Rispondi SOLO con JSON valido: {"posts": [...]}';

  let posts = [];

  if (isLancio) {
    console.log('Prima esecuzione - 10 post di lancio...');
    const edizioneInfo = edizione ? ('Edizione #' + edizione.num + ' - ' + edizione.title) : 'Nessuna edizione disponibile';

    const prompt = 'Genera 10 post Instagram per lancio profilo @valoreatteso. ' + edizioneInfo + '\n\n' +
      'POST:\n' +
      '1. BICOLONNA: lancio brand - il calcio non si guarda si legge\n' +
      '2. BICOLONNA: stadium yield Real Madrid 248M matchday 2023/24 (Deloitte 2025)\n' +
      '3. SFONDO NERO: salary ratio Serie A 64% (Deloitte 2025)\n' +
      '4. BICOLONNA: perche i fondi PE comprano club in perdita\n' +
      '5. SFONDO NERO: multipli EV/Revenue calcio 4-5x vs NBA 15-18x\n' +
      '6. CAROUSEL 5 slide: come leggere un bilancio di un club\n' +
      '7. BICOLONNA: matchday revenue top club europei\n' +
      '8. SFONDO NERO: PE in oltre 36% dei top club europei\n' +
      '9. CAROUSEL 5 slide: glossario CF applicato al calcio\n' +
      '10. BICOLONNA: post lancio ufficiale da sponsorizzare su Meta\n\n' +
      'Per ogni post includi brief_chatgpt con istruzioni complete per visual 1080x1080px.\n' +
      'Rispondi con JSON: {"posts": [...]}';

    const testo = await callClaude([{ role: 'user', content: prompt }], system);
    const cleaned = cleanJSON(testo);
    if (!cleaned) throw new Error('JSON non valido');
    const parsed = JSON.parse(cleaned);
    posts = Array.isArray(parsed) ? parsed : (parsed.posts || []);

  } else {
    if (!edizione) throw new Error('Nessuna edizione pubblicata');
    console.log('Generazione 3 post settimanali...');

    const sezioni = JSON.stringify(
      (edizione.sections || []).map(function(s) {
        return { label: s.label, title: s.title, kpis: s.kpis, verdict: s.verdict };
      }), null, 2
    );

    const prompt = 'Oggi: ' + oggi + '. 3 post Instagram per Valore Atteso.\n\n' +
      'EDIZIONE #' + edizione.num + ' - ' + edizione.title + ':\n' + sezioni + '\n\n' +
      'POST 1 DATO SETTIMANA (martedi): dato piu sorprendente. Rimanda newsletter.\n' +
      'POST 2 EVERGREEN (giovedi): concetto CF con esempio reale. NON riferirsi alla edizione.\n' +
      'POST 3 CONFRONTO (sabato): confronto o domanda retorica indipendente.\n\n' +
      'Brief_chatgpt completo per ogni post.\n' +
      'JSON: {"posts": [...]}';

    const testo = await callClaude([{ role: 'user', content: prompt }], system);
    const cleaned = cleanJSON(testo);
    if (!cleaned) throw new Error('JSON non valido');
    const parsed = JSON.parse(cleaned);
    posts = Array.isArray(parsed) ? parsed : (parsed.posts || []);
  }

  console.log('Post generati: ' + posts.length);
  await memSet('content_posts', { data: oggi, posts: posts, edizione: edizione ? edizione.num : null }, 'content-agent');
  await memSet('content_last_run', { data: oggi, num_posts: posts.length, tipo: isLancio ? 'lancio' : 'settimanale' }, 'content-agent');

  // Email HTML
  let postsHTML = '';
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const tipo = ((p.tipo || 'POST') + '').toUpperCase();
    const quando = p.quando_pubblicare ? ' &middot; ' + p.quando_pubblicare : '';
    const titolo = p.titolo_interno || ('Post ' + (i + 1));
    const kpi = p.kpi_visivo || p.dato_principale || '';
    const caption = (p.caption || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const brief = (p.brief_chatgpt || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fonte = (p.fonte || '').replace(/&/g, '&amp;');

    postsHTML += '<tr><td style="padding:0 0 16px"><table width="100%" style="border-collapse:collapse">' +
      '<tr style="background:#1A1A1A"><td style="padding:10px 24px">' +
      '<span style="font-family:Courier New,monospace;font-size:9px;color:#D4A017;letter-spacing:.12em;text-transform:uppercase">' + tipo + quando + '</span></td></tr>' +
      '<tr style="background:#F5F2EB"><td style="padding:14px 24px;border-bottom:1px solid #D0CBC0">' +
      '<h3 style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#1A1A1A;margin:0 0 8px">' + titolo + '</h3>' +
      (kpi ? '<div style="font-family:Courier New,monospace;font-size:24px;font-weight:900;color:#C8251D;margin:0 0 8px">' + kpi + '</div>' : '') +
      '<p style="font-family:Georgia,serif;font-size:12px;color:#4A4845;line-height:1.7;margin:0;white-space:pre-wrap">' + caption + '</p></td></tr>' +
      (brief ? '<tr style="background:#EDE9E0"><td style="padding:10px 24px;border-bottom:1px solid #D0CBC0">' +
        '<p style="font-family:Courier New,monospace;font-size:8px;color:#9A9690;margin:0 0 4px;text-transform:uppercase;letter-spacing:.1em">Brief ChatGPT</p>' +
        '<p style="font-family:Georgia,serif;font-size:11px;color:#4A4845;line-height:1.6;margin:0">' + brief + '</p></td></tr>' : '') +
      (fonte ? '<tr style="background:#F5F2EB"><td style="padding:6px 24px;border-bottom:2px solid #D0CBC0">' +
        '<p style="font-family:Courier New,monospace;font-size:8px;color:#1B4332;margin:0">Fonte: ' + fonte + '</p></td></tr>' : '') +
      '</table></td></tr>';
  }

  const titolo = isLancio ? ('Content Agent VA - ' + posts.length + ' post lancio') : ('Content Agent VA - 3 post settimana ' + oggi);

  const html = '<table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">' +
    '<tr><td style="padding:24px 28px;background:#1A1A1A">' +
    '<h1 style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin:0">Valore Atteso</h1>' +
    '<p style="font-family:Courier New,monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Content Agent &middot; ' + oggi + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:14px 28px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">' +
    '<p style="font-family:Courier New,monospace;font-size:10px;color:#1A1A1A;margin:0;font-weight:600">' +
    (isLancio ? 'PIANO LANCIO - ' + posts.length + ' post pronti' : '3 POST SETTIMANA - pronti') + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px 0"><table width="100%" style="border-collapse:collapse">' + postsHTML + '</table></td></tr>' +
    '<tr><td style="padding:14px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0;text-align:center">' +
    '<p style="font-family:Courier New,monospace;font-size:8px;color:#9A9690;margin:0">Content Agent &middot; Valore Atteso</p>' +
    '</td></tr></table>';

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: titolo, html: html })
  });

  await logRun('content-agent', 'success', posts.length + ' post generati', { posts: posts.length }, Date.now() - start);
  console.log('Content Agent completato. ' + posts.length + ' post.');
}

main().catch(function(e) {
  console.error('ERRORE Content Agent:', e.message);
  logRun('content-agent', 'error', e.message).catch(function() {});
  process.exit(1);
});
