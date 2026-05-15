// content-agent.js — Genera contenuti Instagram per Valore Atteso
// Gira: giovedi 10:00 | Genera: 3 post settimanali con memoria editoriale

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
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: system,
      messages: messages
    })
  });
  if (!r.ok) throw new Error('Anthropic: ' + r.status + ' ' + r.text);
  const data = r.json();
  return data.content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
}

function cleanJSON(str) {
  str = str.replace(/```json|```/g, '').trim();
  const match = str.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let json = match[0];
  json = json.replace(/[\x00-\x1F\x7F]/g, ' ');
  json = json.replace(/,(\s*[}\]])/g, '$1');
  return json;
}

// Legge la memoria editoriale da Supabase
async function getPostMemory() {
  try {
    const posts = await supaFetch('/rest/v1/instagram_posts?order=post_num.desc&select=argomento,concetti,kpi_usati,club_citati,dato_principale');
    if (!Array.isArray(posts) || posts.length === 0) return 'Nessun post precedente.';

    return posts.map(function(p) {
      const concetti = (p.concetti || []).join(', ');
      const kpi = (p.kpi_usati || []).join(', ');
      const club = (p.club_citati || []).join(', ');
      return '- ' + p.argomento +
        (concetti ? ' | Concetti: ' + concetti : '') +
        (kpi ? ' | KPI: ' + kpi : '') +
        (club ? ' | Club: ' + club : '');
    }).join('\n');
  } catch(e) {
    console.error('Errore lettura memoria:', e.message);
    return 'Memoria non disponibile.';
  }
}

// Salva un nuovo post nella memoria editoriale
async function savePost(postNum, post) {
  try {
    await supaFetch('/rest/v1/instagram_posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        post_num: postNum,
        formato: post.formato || 'singolo',
        tipo: post.tipo || 'evergreen',
        argomento: post.argomento || post.titolo_interno || 'Post ' + postNum,
        concetti: post.concetti || [],
        kpi_usati: post.kpi_usati || (post.dato_principale ? [post.dato_principale] : []),
        club_citati: post.club_citati || [],
        dato_principale: post.dato_principale || post.kpi_visivo || null,
        pubblicato_il: new Date().toISOString().split('T')[0]
      })
    });
    console.log('Post salvato in memoria: ' + (post.argomento || post.titolo_interno));
  } catch(e) {
    console.error('Errore salvataggio post:', e.message);
  }
}

// Genera UN singolo post — max_tokens 1200 evita troncamenti JSON
async function generateSinglePost(system, prompt) {
  const testo = await callClaude([{ role: 'user', content: prompt }], system);
  const cleaned = cleanJSON(testo);
  if (!cleaned) throw new Error('JSON non valido: ' + testo.slice(0, 300));
  return JSON.parse(cleaned);
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT');
  console.log('Content Agent avviato:', new Date().toISOString());

  // Legge edizione pubblicata
  let edizione = null;
  try {
    const eds = await supaFetch('/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=*');
    edizione = Array.isArray(eds) && eds[0] ? eds[0] : null;
    if (edizione) console.log('Edizione: #' + edizione.num + ' - ' + edizione.title);
    else throw new Error('Nessuna edizione pubblicata');
  } catch(e) {
    throw new Error('Edizione non trovata: ' + e.message);
  }

  // Legge memoria editoriale
  console.log('Carico memoria editoriale...');
  const memoria = await getPostMemory();
  console.log('Post in archivio: ' + memoria.split('\n').length);

  // Conta i post esistenti per numerazione progressiva
  let nextPostNum = 7;
  try {
    const count = await supaFetch('/rest/v1/instagram_posts?select=post_num&order=post_num.desc&limit=1');
    if (Array.isArray(count) && count[0]) nextPostNum = count[0].post_num + 1;
  } catch(e) {}

  const sezioni = JSON.stringify(
    (edizione.sections || []).map(function(s) {
      return { label: s.label, title: s.title, kpis: s.kpis, verdict: s.verdict };
    }), null, 2
  );

  const system = 'Sei il social media manager di Valore Atteso, newsletter italiana sul business del calcio europeo.\n' +
    'Tono: autorevole, analitico. Zero gossip. Dati e framework di corporate finance.\n' +
    'Pubblico: professionisti M&A, PE, consulenza, finanza 25-45 anni Italia.\n\n' +
    'ARCHIVIO POST GIA PUBBLICATI (NON ripetere questi argomenti, concetti o dati):\n' +
    memoria + '\n\n' +
    'REGOLA FONDAMENTALE: ogni post deve coprire un angolo o un dato NON presente in archivio.\n' +
    'Se un concetto e gia stato trattato, trova un\'applicazione diversa o un club/campionato diverso.\n\n' +
    'Per ogni post includi OBBLIGATORIAMENTE questi campi JSON:\n' +
    '- tipo: "dato_settimana" | "evergreen" | "confronto"\n' +
    '- formato: "singolo" | "carosello"\n' +
    '- argomento: stringa breve descrittiva (usata per la memoria)\n' +
    '- concetti: array di concetti CF trattati\n' +
    '- kpi_usati: array di dati/numeri specifici citati\n' +
    '- club_citati: array di club menzionati\n' +
    '- dato_principale: il numero o fatto piu sorprendente\n' +
    '- titolo_interno: titolo editoriale breve\n' +
    '- quando_pubblicare: giorno suggerito\n' +
    '- caption: testo Instagram completo con hashtag\n' +
    '- brief_chatgpt: istruzioni visual per ChatGPT (stile Valore Atteso, 1080x1080px)\n\n' +
    'Rispondi SOLO con JSON valido: {"post": {...}}';

  const posts = [];

  // POST 1 — Dato settimana (legato alla newsletter)
  console.log('Genero post 1/3 — dato settimana...');
  try {
    const prompt1 = 'Oggi: ' + oggi + '. Edizione #' + edizione.num + ' - ' + edizione.title + '\n\n' +
      'Sezioni:\n' + sezioni + '\n\n' +
      'Genera 1 post tipo DATO SETTIMANA: il dato piu sorprendente di questa edizione.\n' +
      'Deve rimandare alla newsletter. Controlla archivio e usa un dato NON ancora usato.\n' +
      'JSON: {"post": {...}}';
    const result = await generateSinglePost(system, prompt1);
    const post = result.post || result;
    posts.push(post);
    await savePost(nextPostNum, post);
    nextPostNum++;
  } catch(e) {
    console.error('Errore post 1:', e.message);
  }

  // POST 2 — Evergreen (concetto CF, non legato alla newsletter)
  console.log('Genero post 2/3 — evergreen...');
  try {
    const prompt2 = 'Oggi: ' + oggi + '.\n\n' +
      'Genera 1 post tipo EVERGREEN: un concetto di corporate finance applicato al calcio.\n' +
      'NON fare riferimento alla newsletter. Usa un concetto NON in archivio.\n' +
      'Esempi ancora disponibili: EBITDA adjusted, salary cap implicito, EV/EBITDA calcio vs altri sport, ' +
      'plusvalenze fittizie, fair value cartellini, covenant bancari dei club, break-even UEFA.\n' +
      'JSON: {"post": {...}}';
    const result = await generateSinglePost(system, prompt2);
    const post = result.post || result;
    posts.push(post);
    await savePost(nextPostNum, post);
    nextPostNum++;
  } catch(e) {
    console.error('Errore post 2:', e.message);
  }

  // POST 3 — Confronto o domanda retorica
  console.log('Genero post 3/3 — confronto...');
  try {
    const prompt3 = 'Oggi: ' + oggi + '.\n\n' +
      'Genera 1 post tipo CONFRONTO: un dato comparativo o domanda retorica che genera curiosita.\n' +
      'Indipendente dalla newsletter. Confronta club diversi, campionati, o calcio vs altri sport.\n' +
      'Evita club e dati gia usati in archivio.\n' +
      'JSON: {"post": {...}}';
    const result = await generateSinglePost(system, prompt3);
    const post = result.post || result;
    posts.push(post);
    await savePost(nextPostNum, post);
    nextPostNum++;
  } catch(e) {
    console.error('Errore post 3:', e.message);
  }

  console.log('Post generati: ' + posts.length);

  // Costruisce email HTML
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

  const titolo = 'Content Agent VA — 3 post settimana ' + oggi;
  const html = '<table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">' +
    '<tr><td style="padding:24px 28px;background:#1A1A1A">' +
    '<h1 style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin:0">Valore Atteso</h1>' +
    '<p style="font-family:Courier New,monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Content Agent &middot; ' + oggi + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:14px 28px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">' +
    '<p style="font-family:Courier New,monospace;font-size:10px;color:#1A1A1A;margin:0;font-weight:600">3 POST SETTIMANA — pronti per ChatGPT</p>' +
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
  console.log('Content Agent completato. ' + posts.length + ' post salvati in memoria e inviati via email.');
}

main().catch(function(e) {
  console.error('ERRORE Content Agent:', e.message);
  logRun('content-agent', 'error', e.message).catch(function() {});
  process.exit(1);
});
