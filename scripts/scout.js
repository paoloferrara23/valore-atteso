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

  console.log('Scout avviato...');

  const today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

  console.log('1. Analisi notizie con Claude...');

  const prompt = `Sei lo Scout di Valore Atteso, newsletter italiana che legge il calcio con gli occhi di un analista M&A.

Analizza le notizie più rilevanti sul business del calcio europeo degli ultimi 7 giorni (${weekAgo} - ${today}).

Il filtro editoriale è uno solo: ogni notizia deve avere un angolo di corporate finance. Non ci interessano i risultati sportivi, le formazioni o il calciomercato come gossip. Ci interessano:

DEAL E M&A
- Acquisizioni o cessioni di club (chi compra, a che multiplo, con quale struttura)
- Investimenti di PE, SWF, family office in club o leghe
- Operazioni su diritti TV, naming rights, sponsorships significative
- LBO, vendor financing, earn-out su club europei

BILANCI E VALUTAZIONI
- Risultati finanziari di club o leghe (EBITDA, perdite, ricavi)
- Bilanci depositati con dati rilevanti
- Valutazioni implicite da operazioni recenti
- Player trading come strumento di cash flow

REGOLATORI E STRUTTURA
- Novità FFP/PSR con impatto su struttura finanziaria dei club
- Decisioni UEFA/FIFA che cambiano i parametri economici
- Nuovi modelli di revenue (stadi di proprietà, multiclub, media rights)

METRICHE E BENCHMARK
- Dati su stadium yield, salary ratio, player asset turnover
- Confronti internazionali (Serie A vs Premier vs Bundesliga)
- KPI emergenti nel settore

Per ogni notizia trovata, analizza:
1. Qual è l'angolo corporate finance
2. Quali dati numerici sono verificabili
3. Quanto è rilevante per i lettori di Valore Atteso (finanza, PE, M&A, club manager)
4. Se può diventare una delle 3 sezioni: Il Bilancio, Il Deal, La Metrica

Rispondi SOLO con JSON valido:
{
  "settimana": "${weekAgo} - ${today}",
  "notizie": [
    {
      "titolo": "titolo della notizia",
      "categoria": "deal|bilancio|regolatorio|metrica",
      "rilevanza": 1-10,
      "angolo_cf": "l'angolo corporate finance specifico",
      "dati_chiave": ["dato 1 verificabile", "dato 2"],
      "sezione_suggerita": "Il Bilancio|Il Deal|La Metrica",
      "fonti_suggerite": ["fonte primaria da verificare"]
    }
  ],
  "temi_settimana": ["tema principale 1", "tema principale 2", "tema principale 3"],
  "segnale_forte": "la notizia più rilevante della settimana in una frase",
  "edizione_suggerita": {
    "bilancio": "suggerimento per sezione Il Bilancio",
    "deal": "suggerimento per sezione Il Deal", 
    "metrica": "suggerimento per sezione La Metrica"
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
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = claudeRes.json();
  if (!claudeRes.ok) throw new Error('Claude error: ' + JSON.stringify(claudeData));

  const rawText = claudeData.content[0].text;
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON non trovato');
  const brief = JSON.parse(jsonMatch[0]);

  console.log(`Trovate ${brief.notizie?.length || 0} notizie rilevanti`);
  console.log('Segnale forte:', brief.segnale_forte);

  // 2. Costruisci email brief
  console.log('2. Invio brief a', APPROVAL_EMAIL);

  const notizie_html = (brief.notizie || [])
    .sort((a, b) => b.rilevanza - a.rilevanza)
    .slice(0, 6)
    .map(n => {
      const rilevanzaColor = n.rilevanza >= 8 ? '#B5221A' : n.rilevanza >= 6 ? '#F5A623' : '#888480';
      const categoriaLabel = {
        deal: 'M&A / Deal',
        bilancio: 'Bilancio',
        regolatorio: 'Regolatorio',
        metrica: 'Metrica'
      }[n.categoria] || n.categoria;

      return `<tr><td style="padding:16px 24px;border-bottom:1px solid #C8C4BB">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <span style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480">${categoriaLabel}</span>
          <span style="font-family:'Courier New',monospace;font-size:9px;color:${rilevanzaColor};font-weight:600">Rilevanza ${n.rilevanza}/10</span>
        </div>
        <p style="font-family:Georgia,serif;font-size:14px;font-weight:700;margin:0 0 6px;color:#111010">${n.titolo}</p>
        <p style="font-family:Georgia,serif;font-size:12px;color:#3D3C39;font-weight:300;line-height:1.6;margin:0 0 8px"><strong style="font-weight:400;color:#111010">Angolo CF:</strong> ${n.angolo_cf}</p>
        ${n.dati_chiave && n.dati_chiave.length ? `<p style="font-family:'Courier New',monospace;font-size:10px;color:#888480;margin:0 0 4px">Dati: ${n.dati_chiave.join(' · ')}</p>` : ''}
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#B5221A;margin:0">→ ${n.sezione_suggerita}</p>
      </td></tr>`;
    }).join('');

  const emailHTML = `<table width="600" style="max-width:600px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif">
    <tr><td style="padding:20px 28px;background:#111010;text-align:center">
      <h1 style="color:#F7F4EE;font-size:22px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.4);letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Scout · Brief settimanale · ${today}</p>
    </td></tr>

    <tr><td style="padding:20px 24px;background:#EDE9E0;border-bottom:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.1em;text-transform:uppercase;margin:0 0 6px">Segnale forte della settimana</p>
      <p style="font-family:Georgia,serif;font-size:16px;font-weight:700;letter-spacing:-.3px;color:#111010;margin:0 0 12px">${brief.segnale_forte}</p>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0">Temi: ${(brief.temi_settimana || []).join(' · ')}</p>
    </td></tr>

    <tr><td style="padding:0">
      <table width="100%" style="border-collapse:collapse">
        <tr><td style="padding:10px 24px;background:#EDE9E0;border-bottom:1px solid #C8C4BB">
          <span style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480">Notizie rilevanti — ordinate per rilevanza CF</span>
        </td></tr>
        ${notizie_html}
      </table>
    </td></tr>

    <tr><td style="padding:20px 24px;background:#EDE9E0;border-top:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px">Suggerimento edizione prossima settimana</p>
      <p style="font-family:Georgia,serif;font-size:12px;color:#3D3C39;font-weight:300;line-height:1.7;margin:0 0 6px"><strong style="font-weight:400;color:#111010">Il Bilancio:</strong> ${brief.edizione_suggerita?.bilancio || '—'}</p>
      <p style="font-family:Georgia,serif;font-size:12px;color:#3D3C39;font-weight:300;line-height:1.7;margin:0 0 6px"><strong style="font-weight:400;color:#111010">Il Deal:</strong> ${brief.edizione_suggerita?.deal || '—'}</p>
      <p style="font-family:Georgia,serif;font-size:12px;color:#3D3C39;font-weight:300;line-height:1.7;margin:0"><strong style="font-weight:400;color:#111010">La Metrica:</strong> ${brief.edizione_suggerita?.metrica || '—'}</p>
    </td></tr>

    <tr><td style="padding:14px 24px;border-top:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:8px;color:#888480;margin:0">Scout automatico · Valore Atteso · ${today} · <a href="${SITE}" style="color:#888480">valore-atteso.vercel.app</a></p>
    </td></tr>
  </table>`;

  const emailRes = await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + RESEND_KEY
    },
    body: JSON.stringify({
      from: 'Valore Atteso Scout <onboarding@resend.dev>',
      to: APPROVAL_EMAIL,
      subject: `Scout · ${brief.segnale_forte?.substring(0, 60) || 'Brief settimana ' + today}`,
      html: emailHTML
    })
  });

  console.log('Brief inviato, status:', emailRes.status);
  console.log('Scout completato.');
}

main().catch(e => { console.error('ERRORE Scout:', e.message); process.exit(1); });
