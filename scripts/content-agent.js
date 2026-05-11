// content-agent.js — Genera contenuti Instagram per Valore Atteso
// Gira: giovedì 10:00 ogni settimana | Prima esecuzione: genera 9 post di lancio

const { memSet, memGet, logRun, supaFetch } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
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
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      system,
      messages
    })
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.text}`);
  const data = r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}


function generateSVG(post) {
  const tipo = (post.tipo || '').toUpperCase();
  const kpi = post.kpi_visivo || '';
  const titolo = (post.titolo_interno || '').substring(0, 60);
  
  // Determina layout in base al tipo
  if (kpi) {
    // Layout con numero grande
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#F5F2EB"/>
  <!-- Bordo sottile -->
  <rect x="40" y="40" width="1000" height="1000" fill="none" stroke="#D0CBC0" stroke-width="1"/>
  <!-- Label tipo -->
  <text x="80" y="120" font-family="'Courier New', monospace" font-size="22" fill="#9A9690" letter-spacing="4">${tipo}</text>
  <!-- Linea rossa decorativa -->
  <rect x="80" y="140" width="60" height="2" fill="#C8251D"/>
  <!-- KPI grande -->
  <text x="80" y="480" font-family="Georgia, serif" font-size="160" font-weight="900" fill="#C8251D" letter-spacing="-4">${kpi}</text>
  <!-- Titolo -->
  <foreignObject x="80" y="520" width="920" height="300">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Georgia,serif;font-size:52px;font-weight:700;color:#1A1A1A;line-height:1.2;letter-spacing:-1px">${titolo}</div>
  </foreignObject>
  <!-- Footer -->
  <text x="80" y="980" font-family="'Courier New', monospace" font-size="22" fill="#9A9690" letter-spacing="2">VALORE ATTESO</text>
  <text x="1000" y="980" font-family="'Courier New', monospace" font-size="22" fill="#C8251D" text-anchor="end" letter-spacing="1">valoreatteso.com</text>
</svg>`;
  } else {
    // Layout testo
    const righe = titolo.match(/.{1,35}/g) || [titolo];
    const testoRighe = righe.map((r, i) => 
      `<text x="80" y="${420 + i * 70}" font-family="Georgia, serif" font-size="58" font-weight="700" fill="#1A1A1A">${r}</text>`
    ).join('\n  ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#F5F2EB"/>
  <rect x="40" y="40" width="1000" height="1000" fill="none" stroke="#D0CBC0" stroke-width="1"/>
  <text x="80" y="120" font-family="'Courier New', monospace" font-size="22" fill="#9A9690" letter-spacing="4">${tipo}</text>
  <rect x="80" y="140" width="60" height="2" fill="#C8251D"/>
  ${testoRighe}
  <rect x="80" y="${420 + righe.length * 70 + 30}" width="200" height="3" fill="#C8251D"/>
  <text x="80" y="980" font-family="'Courier New', monospace" font-size="22" fill="#9A9690" letter-spacing="2">VALORE ATTESO</text>
  <text x="1000" y="980" font-family="'Courier New', monospace" font-size="22" fill="#C8251D" text-anchor="end" letter-spacing="1">valoreatteso.com</text>
</svg>`;
  }
}

function svgToDataUrl(svg) {
  const b64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

function cleanJSON(str) {
  const match = str.replace(/```json|```/g, '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
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

  // Controlla se è il primo lancio
  const prevContent = await memGet('content_last_run').catch(() => null);
  const isLancio = !prevContent;

  // Legge ultima edizione pubblicata
  let edizione = null;
  try {
    const eds = await supaFetch('/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=*');
    edizione = Array.isArray(eds) && eds[0] ? eds[0] : null;
    if (edizione) console.log(`Edizione trovata: #${edizione.num} — ${edizione.title}`);
  } catch(e) {
    console.error('Errore lettura edizione:', e.message);
  }

  // Legge brief scout per dati aggiuntivi
  const scoutBrief = await memGet('scout_brief').catch(() => null);

  const system = `Sei il social media manager di Valore Atteso, newsletter italiana sul business del calcio europeo.
Il tuo obiettivo principale: portare nuovi iscritti alla newsletter tramite contenuti Instagram di qualità.

BRAND:
- Tagline: "Il calcio dei numeri, non dei goal"
- Tono: autorevole, analitico, diretto. Come The Economist applicato al calcio
- Pubblico: professionisti M&A, PE, consulenza, finanza — 25-45 anni, Italia
- Zero gossip, zero opinioni senza dati

OGNI SETTIMANA GENERA 3 TIPI DI POST:

POST 1 — DATO DELLA SETTIMANA (collegato all'ultima edizione newsletter)
- Un numero sorprendente dall'edizione appena uscita
- Obiettivo: mostrare la qualità dell'analisi e rimandare alla newsletter
- CTA: "Leggi l'analisi completa — link in bio"

POST 2 — CONTENUTO EVERGREEN (dal glossario/archivio del sito valoreatteso.com)
- Un concetto CF applicato al calcio: cos'è EBITDA di un club, come funziona un deal PE, salary ratio, stadium yield, ecc.
- Obiettivo: educare, posizionare il brand come autorità
- CTA: "Ogni martedì su Valore Atteso — link in bio"

POST 3 — CONFRONTO O DOMANDA RETORICA (contenuto indipendente)
- Un dato comparativo che genera curiosità e commenti
- Es: "Serie A vs Premier sui diritti TV", "Quanto vale qualificarsi in Champions?", "Perché i fondi PE comprano club in perdita?"
- Obiettivo: reach organico, commenti, nuovi follower
- CTA: "Link in bio per iscriverti gratis"

FORMATO VISUAL (da descrivere nel brief per ChatGPT):
- 1080x1080px quadrato
- Layout bicolonna: sinistra crema #F0EBE1 con testo, destra foto B&N architetturale + sezione nera
- Logo VA cerchio in alto a sinistra + "Valore Atteso"
- Label oro piccola sopra titolo
- Titolo bold serif nero — max 6 parole
- Linea oro decorativa
- Corpo testo max 3 righe
- CTA oro in basso
- Fonte dati in grigio chiaro in basso
- Logo VA semitrasparente in basso a destra

Rispondi SOLO in JSON valido:
{
  "settimana": "DD/MM/YYYY",
  "edizione": "numero edizione",
  "posts": [
    {
      "numero": 1,
      "tipo": "dato_settimana|evergreen|confronto",
      "titolo_interno": "descrizione breve per identificare il post",
      "quando_pubblicare": "giorno e orario consigliato",
      "brief_chatgpt": "prompt completo da dare a ChatGPT per generare il visual",
      "caption": "caption completa con hashtag",
      "cta": "call to action specifica",
      "dato_principale": "il numero/dato principale da mostrare grande nel visual",
      "fonte": "fonte verificabile del dato"
    }
  ]
}`;`;

  let posts = [];

  if (isLancio) {
    // FASE LANCIO: genera 9 post pre-lancio + 1 post di lancio ufficiale
    console.log('Prima esecuzione — generazione 9 post di lancio...');

    const edizioneContext = edizione ? `
Dati dall'edizione #${edizione.num} pubblicata ("${edizione.title}"):
${JSON.stringify(edizione.sections?.map(s => ({ label: s.label, title: s.title, kpis: s.kpis, verdict: s.verdict })), null, 2)}
` : 'Dati generali sul business del calcio europeo.';

    const testo = await callClaude([{
      role: 'user',
      content: `Genera 10 post Instagram per il lancio del profilo @valoreatteso.

${edizioneContext}

I 10 post devono essere:
1. DATO SINGOLO: Stadium yield — Real Madrid vs Serie A (dato verificato Deloitte 2025)
2. CONFRONTO: Multipli EV/Revenue calcio vs NBA
3. DOMANDA RETORICA: "Sai perché i fondi PE comprano club in perdita?"
4. DATO SINGOLO: Salary ratio Serie A al 68% (Deloitte 2025)
5. CAROUSEL (4 slide): "Il bilancio di un club spiegato in 4 numeri"
6. CONFRONTO: Matchday revenue Real Madrid €248M vs Inter €103M
7. DOMANDA RETORICA: "Quanto vale davvero un club di calcio?"
8. DATO SINGOLO: PE nei top-5 club europei >36%
9. CAROUSEL (4 slide): "Come leggere un bilancio di calcio"
10. LANCIO UFFICIALE: presentazione newsletter Valore Atteso

Per ogni post: caption completa, visual_concept dettagliato per Canva, hashtag, cta.

Rispondi con JSON array: [{ "numero": 1, "tipo": "...", "titolo_interno": "...", "caption": "...", "visual_concept": "...", "kpi_visivo": "...", "hashtag": [], "cta": "...", "note_canva": "...", "quando_pubblicare": "giorno X" }]`
    }], system);

    const cleaned = cleanJSON(testo);
    if (!cleaned) throw new Error('JSON non valido dal Content Agent');
    posts = JSON.parse(cleaned);
    if (!Array.isArray(posts)) posts = posts.posts || [];

  } else {
    // SETTIMANA NORMALE: 1 post basato sull'ultima edizione
    console.log('Generazione post settimanale...');

    if (!edizione) throw new Error('Nessuna edizione pubblicata trovata');

    const testo = await callClaude([{
    const testo = await callClaude([{
      role: 'user',
      content: `Oggi è ${oggi}. Genera 3 post Instagram per Valore Atteso questa settimana.

ULTIMA EDIZIONE PUBBLICATA (#${edizione.num} — "${edizione.title}"):
${JSON.stringify(edizione.sections?.map(s => ({ label: s.label, title: s.title, kpis: s.kpis, verdict: s.verdict })), null, 2)}

POST 1 — DATO DELLA SETTIMANA (pubblicare martedì): usa il dato più sorprendente dall'edizione. Rimanda alla newsletter.
POST 2 — EVERGREEN (pubblicare giovedì): scegli un concetto CF del glossario (EBITDA, salary ratio, stadium yield, EV/Revenue, FFP, deal structure) e spiegalo con un esempio calcistico reale. NON fare riferimento all'edizione.
POST 3 — CONFRONTO (pubblicare sabato): crea un confronto o domanda retorica indipendente che generi curiosità e commenti. NON fare riferimento all'edizione.

Per ogni post includi brief_chatgpt completo e dettagliato per generare il visual su ChatGPT.
Rispondi SOLO con JSON: {"posts": [...]}.`
    }], system);

    const cleaned = cleanJSON(testo);
    if (!cleaned) throw new Error('JSON non valido');
    posts = JSON.parse(cleaned);
    if (!Array.isArray(posts)) posts = posts.posts || [];
  }

  console.log(`Post generati: ${posts.length}`);

  // Salva su Supabase
  await memSet('content_posts', { data: oggi, posts, edizione: edizione?.num }, 'content-agent');
  await memSet('content_last_run', { data: oggi, num_posts: posts.length, tipo: isLancio ? 'lancio' : 'settimanale' }, 'content-agent');

  // Costruisci email
  const postsHTML = posts.map((p, i) => `
    <tr><td style="padding:0">
      <table width="100%" style="border-collapse:collapse">
        <tr style="background:#1A1A1A">
          <td style="padding:10px 24px">
            <span style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.12em;text-transform:uppercase">${p.tipo?.toUpperCase() || 'POST'}</span>
            ${p.quando_pubblicare ? `<span style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.4);margin-left:12px">${p.quando_pubblicare}</span>` : ''}
          </td>
        </tr>
        <!-- VISUAL SVG INLINE -->
        <tr style="background:#EDE9E0">
          <td style="padding:12px 24px;border-bottom:1px solid #D0CBC0;text-align:center">
            <img src="${svgToDataUrl(generateSVG(p))}" width="400" height="400" style="max-width:100%;border:1px solid #D0CBC0" alt="Visual post ${i+1}"/>
            <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:6px 0 0">Visual 1080x1080px — scarica e pubblica su Instagram</p>
          </td>
        </tr>
        <tr style="background:#F5F2EB">
          <td style="padding:14px 24px;border-bottom:1px solid #D0CBC0">
            <h3 style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#1A1A1A;margin:0 0 10px">${p.titolo_interno || `Post ${i+1}`}</h3>
            <p style="font-family:Georgia,serif;font-size:12px;color:#4A4845;font-weight:300;line-height:1.7;margin:0 0 12px;white-space:pre-wrap">${p.caption}</p>
          </td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:8px 0"></td></tr>`
  ).join('');

  const titolo = isLancio ? `Content Agent — ${posts.length} post di lancio Instagram` : `Content Agent — ${posts.length} post settimana ${oggi}`;

  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
      <tr><td style="padding:24px 28px;background:#1A1A1A">
        <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin:0;letter-spacing:-1px">Valore Atteso</h1>
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Content Agent &middot; ${oggi}</p>
      </td></tr>

      <tr><td style="padding:16px 28px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
        <p style="font-family:'Courier New',monospace;font-size:10px;color:#1A1A1A;margin:0;font-weight:600">${isLancio ? '🚀 PIANO DI LANCIO INSTAGRAM' : '📱 POST SETTIMANALI'} — ${posts.length} post pronti</p>
        ${isLancio ? '<p style="font-family:Georgia,serif;font-size:13px;color:#4A4845;margin:8px 0 0;font-weight:300">Pubblica 3 post al giorno per 3 giorni, poi il post di lancio ufficiale (post 10). Sponsorizza solo il post di lancio.</p>' : ''}
      </td></tr>

      <tr><td style="padding:16px 28px 0">
        <table width="100%" style="border-collapse:collapse">
          ${postsHTML}
        </table>
      </td></tr>

      <tr><td style="padding:16px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;margin:0 0 6px;letter-spacing:.08em;text-transform:uppercase">Strumenti consigliati</p>
        <p style="font-family:'Courier New',monospace;font-size:10px;color:#4A4845;margin:0">Canva Pro → usa template "Post Instagram" formato 1080x1080 · Palette: #F5F2EB #1A1A1A #C8251D · Font: Playfair Display + Courier New</p>
      </td></tr>

      <tr><td style="padding:14px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0;text-align:center">
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">Content Agent &middot; Valore Atteso</p>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM,
      to: APPROVAL_EMAIL,
      subject: titolo,
      html
    })
  });

  await logRun('content-agent', 'success',
    `${posts.length} post generati (${isLancio ? 'lancio' : 'settimanale'})`,
    { posts: posts.length, tipo: isLancio ? 'lancio' : 'settimanale' },
    Date.now() - start);

  console.log(`Content Agent completato. ${posts.length} post generati.`);
}

main().catch(async e => {
  console.error('ERRORE Content Agent:', e.message);
  await logRun('content-agent', 'error', e.message).catch(() => {});
  process.exit(1);
});
