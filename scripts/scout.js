const https = require('https');

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
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: () => JSON.parse(data),
        text: () => data
      }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const RESEND_KEY = process.env.RESEND_KEY;
  const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
  const SITE = 'https://valore-atteso.vercel.app';

  console.log('Scout avviato con web search...');

  const today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

  console.log('1. Ricerca notizie con web search...');

  const prompt = `Sei lo Scout di Valore Atteso, newsletter italiana che legge il calcio con gli occhi di un analista M&A.

Cerca e analizza le notizie più rilevanti sul business del calcio europeo degli ultimi 7 giorni (${weekAgo} - ${today}).

FONTI ACCETTATE — cerca SOLO su queste fonti autorevoli:
- calcioefinanza.it (principale fonte italiana su finanza calcio)
- swissramble.substack.com / swissramble.blogspot.com (analisi finanziaria club europei)
- deloitte.com (Football Money League e report settoriali)
- kpmgsports.com / footballbenchmark.com (benchmark e valutazioni)
- uefa.com (comunicati ufficiali, report finanziari UEFA)
- fifa.com (comunicati ufficiali FIFA)
- ft.com (Financial Times — sezione sport/business)
- bloomberg.com (sezione sport/business)
- reuters.com (sezione sport/business)
- ilsole24ore.com (sezione sport/economia)
- legaseriea.it (comunicati ufficiali Serie A)
- premierleague.com (comunicati ufficiali Premier League)
- bundesliga.com (comunicati ufficiali Bundesliga)
- transfermarkt.it (valutazioni cartellini verificabili)
- rivista-contrasti.it

FONTI NON ACCETTATE: calciomercato.com, tuttomercatoweb, gazzetta.it (solo notizie sportive), forum, siti generalisti senza fonte primaria.

FILTRO EDITORIALE — cerca solo notizie con angolo corporate finance:
- Acquisizioni e M&A di club (multipli, struttura deal, acquirente)
- Bilanci e risultati finanziari (EBITDA, perdite, ricavi, player trading)
- Investimenti PE, SWF, family office in club o leghe
- Diritti TV e accordi media con impatto economico rilevante
- Nuovi stadi e progetti immobiliari legati al calcio
- Regolamenti UEFA/PSR con impatto su struttura finanziaria
- Valutazioni implicite di club da operazioni recenti
- KPI e metriche finanziarie (stadium yield, salary ratio, ecc.)

Per ogni notizia trovata specifica:
1. Fonte esatta con URL
2. Dati numerici verificabili citati nell'articolo
3. Angolo corporate finance specifico
4. Sezione suggerita per Valore Atteso

Rispondi SOLO con JSON valido:
{
  "settimana": "${weekAgo} - ${today}",
  "notizie": [
    {
      "titolo": "titolo della notizia",
      "categoria": "deal|bilancio|regolatorio|metrica",
      "rilevanza": 1-10,
      "angolo_cf": "l'angolo corporate finance specifico",
      "dati_chiave": ["dato numerico verificabile 1", "dato 2"],
      "fonte": {
        "nome": "nome della fonte (es: Calcio e Finanza)",
        "url": "URL specifico dell'articolo",
        "tipo": "primaria|secondaria",
        "verificabilita": "alta|media|bassa"
      },
      "sezione_suggerita": "Il Bilancio|Il Deal|La Metrica"
    }
  ],
  "temi_settimana": ["tema 1", "tema 2", "tema 3"],
  "segnale_forte": "la notizia più rilevante in una frase",
  "edizione_suggerita": {
    "bilancio": "suggerimento sezione Il Bilancio con fonte",
    "deal": "suggerimento sezione Il Deal con fonte",
    "metrica": "suggerimento sezione La Metrica con fonte"
  }
}`;

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
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = claudeRes.json();
  if (!claudeRes.ok) throw new Error('Claude error: ' + JSON.stringify(claudeData));

  // Estrai il testo dalla risposta (può contenere tool use blocks)
  const textBlocks = (claudeData.content || []).filter(b => b.type === 'text');
  if (!textBlocks.length) throw new Error('Nessun testo nella risposta Claude');
  
  const rawText = textBlocks[textBlocks.length - 1].text;
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON non trovato nella risposta');
  const brief = JSON.parse(jsonMatch[0]);

  console.log(`Trovate ${brief.notizie?.length || 0} notizie rilevanti`);
  console.log('Segnale forte:', brief.segnale_forte);

  // 2. Costruisci email brief
  console.log('2. Costruzione brief...');

  const notizie_html = (brief.notizie || [])
    .sort((a, b) => b.rilevanza - a.rilevanza)
    .slice(0, 6)
    .map(n => {
      const rilevanzaColor = n.rilevanza >= 8 ? '#B5221A' : n.rilevanza >= 6 ? '#F5A623' : '#888480';
      const categoriaLabel = { deal: 'M&A / Deal', bilancio: 'Bilancio', regolatorio: 'Regolatorio', metrica: 'Metrica' }[n.categoria] || n.categoria;
      const verificabilitaColor = { alta: '#1A3A2A', media: '#F5A623', bassa: '#888480' }[n.fonte?.verificabilita] || '#888480';

      return `<tr><td style="padding:18px 24px;border-bottom:1px solid #C8C4BB">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <span style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480;background:#EDE9E0;padding:2px 8px">${categoriaLabel}</span>
          <span style="font-family:'Courier New',monospace;font-size:9px;color:${rilevanzaColor};font-weight:600">Rilevanza ${n.rilevanza}/10</span>
        </div>
        <p style="font-family:Georgia,serif;font-size:14px;font-weight:700;margin:0 0 8px;color:#111010;line-height:1.3">${n.titolo}</p>
        <p style="font-family:Georgia,serif;font-size:12px;color:#3D3C39;font-weight:300;line-height:1.6;margin:0 0 10px"><strong style="font-weight:400;color:#111010">Angolo CF:</strong> ${n.angolo_cf}</p>
        ${n.dati_chiave && n.dati_chiave.length ? `
        <div style="background:#EDE9E0;padding:8px 12px;margin-bottom:10px">
          <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0 0 4px;letter-spacing:.06em;text-transform:uppercase">Dati verificabili</p>
          ${n.dati_chiave.map(d => `<p style="font-family:'Courier New',monospace;font-size:10px;color:#111010;margin:2px 0">· ${d}</p>`).join('')}
        </div>` : ''}
        ${n.fonte ? `
        <div style="border-left:2px solid ${verificabilitaColor};padding:6px 10px;background:#F7F4EE;margin-bottom:8px">
          <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0 0 2px;text-transform:uppercase;letter-spacing:.06em">Fonte · Verificabilità ${n.fonte.verificabilita}</p>
          <p style="font-family:'Courier New',monospace;font-size:10px;color:#111010;margin:0"><strong>${n.fonte.nome}</strong></p>
          ${n.fonte.url ? `<a href="${n.fonte.url}" style="font-family:'Courier New',monospace;font-size:9px;color:#888480;word-break:break-all">${n.fonte.url}</a>` : ''}
        </div>` : ''}
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#B5221A;margin:0">→ ${n.sezione_suggerita}</p>
      </td></tr>`;
    }).join('');

  const emailHTML = `<table width="620" style="max-width:620px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif">
    <tr><td style="padding:20px 28px;background:#111010;text-align:center">
      <h1 style="color:#F7F4EE;font-size:22px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.4);letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Scout · Brief settimanale · ${today}</p>
    </td></tr>

    <tr><td style="padding:20px 24px;background:#EDE9E0;border-bottom:2px solid #111010">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.1em;text-transform:uppercase;margin:0 0 6px">Segnale forte della settimana</p>
      <p style="font-family:Georgia,serif;font-size:17px;font-weight:700;letter-spacing:-.3px;color:#111010;margin:0 0 12px;line-height:1.3">${brief.segnale_forte}</p>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0">Temi: ${(brief.temi_settimana || []).join(' · ')}</p>
    </td></tr>

    <tr><td style="padding:0">
      <table width="100%" style="border-collapse:collapse">
        <tr><td style="padding:10px 24px;border-bottom:1px solid #C8C4BB">
          <span style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480">Notizie · ordinate per rilevanza CF · solo fonti certificate</span>
        </td></tr>
        ${notizie_html}
      </table>
    </td></tr>

    <tr><td style="padding:20px 24px;background:#EDE9E0;border-top:2px solid #111010">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.1em;text-transform:uppercase;margin:0 0 12px">Suggerimento edizione prossima settimana</p>
      <p style="font-family:Georgia,serif;font-size:13px;color:#3D3C39;font-weight:300;line-height:1.7;margin:0 0 8px"><strong style="font-weight:500;color:#111010">Il Bilancio:</strong> ${brief.edizione_suggerita?.bilancio || '—'}</p>
      <p style="font-family:Georgia,serif;font-size:13px;color:#3D3C39;font-weight:300;line-height:1.7;margin:0 0 8px"><strong style="font-weight:500;color:#111010">Il Deal:</strong> ${brief.edizione_suggerita?.deal || '—'}</p>
      <p style="font-family:Georgia,serif;font-size:13px;color:#3D3C39;font-weight:300;line-height:1.7;margin:0"><strong style="font-weight:500;color:#111010">La Metrica:</strong> ${brief.edizione_suggerita?.metrica || '—'}</p>
    </td></tr>

    <tr><td style="padding:14px 24px;border-top:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:8px;color:#888480;margin:0">Scout automatico con web search · Valore Atteso · ${today} · <a href="${SITE}" style="color:#888480">valore-atteso.vercel.app</a></p>
    </td></tr>
  </table>`;

  console.log('3. Invio brief a', APPROVAL_EMAIL);

  const emailRes = await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + RESEND_KEY
    },
    body: JSON.stringify({
      from: 'Valore Atteso Scout <onboarding@resend.dev>',
      to: APPROVAL_EMAIL,
      subject: `Scout · ${brief.segnale_forte?.substring(0, 55) || 'Brief ' + today}`,
      html: emailHTML
    })
  });

  console.log('Brief inviato, status:', emailRes.status);
  console.log('Scout completato.');
}

main().catch(e => { console.error('ERRORE Scout:', e.message); process.exit(1); });
