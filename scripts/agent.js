const https = require('https');
const crypto = require('crypto');

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => JSON.parse(data),
          text: () => data
        });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const RESEND_KEY = process.env.RESEND_KEY;
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_KEY;
  const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
  const SITE = 'https://valore-atteso.vercel.app';

  // 1. Numero edizione
  console.log('1. Recupero numero edizione...');
  const edRes = httpRequest(SUPA_URL + '/rest/v1/editions?select=num&order=num.desc&limit=1', {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
  });
  const eds = (await edRes).json();
  const lastNum = eds && eds.length ? parseInt(eds[0].num) : 0;
  const newNum = String(lastNum + 1).padStart(3, '0');
  console.log('Nuova edizione: #' + newNum);

  // 2. Genera con Claude
  console.log('2. Genero edizione con Claude...');
  const today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio con tono da analista M&A. Genera l'edizione #${newNum} del ${today}. Rispondi SOLO con JSON valido senza markdown:
{"num":"${newNum}","title":"titolo max 8 parole","subtitle":"sottotitolo","date":"${today}","opener":"intro 2-3 righe","sections":[{"label":"Il Bilancio","title":"titolo","body":"analisi 150 parole dati reali","kpis":[{"key":"KPI","value":"valore"}],"verdict":"giudizio netto","sources":["fonte"]},{"label":"Il Deal","title":"titolo","body":"analisi deal 150 parole","kpis":[{"key":"KPI","value":"valore"}],"verdict":"giudizio netto","sources":["fonte"]},{"label":"La Metrica","title":"titolo","body":"metrica 150 parole benchmark","kpis":[{"key":"entita","value":"valore"}],"verdict":"giudizio netto","sources":["fonte"]}]}`;

  const claudeRes = await httpRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = claudeRes.json();
  if (!claudeRes.ok) throw new Error('Claude error: ' + JSON.stringify(claudeData));

  const rawText = claudeData.content[0].text;
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON non trovato');
  const edition = JSON.parse(jsonMatch[0]);
  console.log('Edizione generata: ' + edition.title);

  // 3. Salva bozza su Supabase
  console.log('3. Salvo bozza su Supabase...');
  const draftToken = crypto.randomUUID();
  const saveRes = await httpRequest(SUPA_URL + '/rest/v1/editions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      ...edition,
      published: false,
      draft_token: draftToken,
      tags: edition.sections.map(s => s.label)
    })
  });
  console.log('Bozza salvata, status: ' + saveRes.status);

  // 4. Email approvazione
  console.log('4. Invio email approvazione...');
  const approveUrl = SITE + '/approva.html?token=' + draftToken;

  const sectionsHTML = edition.sections.map((s, i) =>
    `<tr><td style="padding:16px 24px;border-bottom:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#B5221A;letter-spacing:.12em;text-transform:uppercase;margin:0 0 4px">0${i+1} · ${s.label}</p>
      <h3 style="font-family:Georgia,serif;font-size:15px;font-weight:700;margin:0 0 6px">${s.title}</h3>
      <p style="font-family:Georgia,serif;font-size:12px;color:#3D3C39;font-weight:300;line-height:1.6;margin:0 0 8px">${s.body.substring(0, 180)}...</p>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#B5221A;margin:0">${s.verdict}</p>
    </td></tr>`
  ).join('');

  const emailHTML = `<table width="600" style="max-width:600px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif">
    <tr><td style="padding:20px 28px;background:#111010;text-align:center;border-bottom:2px solid #111010">
      <h1 style="color:#F7F4EE;font-size:22px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.5);letter-spacing:.12em;text-transform:uppercase;margin:4px 0 0">Editoriale Agent · Bozza #${newNum}</p>
    </td></tr>
    <tr><td style="padding:18px 24px;background:#EDE9E0;border-bottom:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0 0 4px">EDIZIONE #${newNum} · ${today}</p>
      <h2 style="font-family:Georgia,serif;font-size:18px;font-weight:700;margin:0 0 6px">${edition.title}</h2>
      <p style="font-family:Georgia,serif;font-size:13px;color:#3D3C39;font-weight:300;font-style:italic;line-height:1.6;margin:0">${edition.opener}</p>
    </td></tr>
    ${sectionsHTML}
    <tr><td style="padding:24px;text-align:center;border-top:2px solid #111010">
      <p style="font-family:'Courier New',monospace;font-size:10px;color:#888480;margin:0 0 14px">Approva per pubblicare sul sito e inviare agli iscritti.</p>
      <a href="${approveUrl}" style="background:#111010;color:#F7F4EE;padding:12px 28px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Approva e pubblica</a>
    </td></tr>
  </table>`;

  const emailRes = await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + RESEND_KEY
    },
    body: JSON.stringify({
      from: 'Valore Atteso <onboarding@resend.dev>',
      to: APPROVAL_EMAIL,
      subject: '[Bozza #' + newNum + '] ' + edition.title,
      html: emailHTML
    })
  });

  console.log('Email inviata, status: ' + emailRes.status);
  await logRun(SUPA_URL, SUPA_KEY, 'editoriale', 'ok', 'Edizione #' + newNum + ' generata e inviata per approvazione', {edition_num: newNum, title: edition.title});
  console.log('Fatto!');
}

main().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
