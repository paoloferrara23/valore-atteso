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

  console.log('SEO Agent avviato...');

  const today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = `Sei il SEO Agent di Valore Atteso, newsletter italiana che legge il calcio con gli occhi di un analista M&A.

Il sito è: ${SITE}
Target: professionisti di finanza, PE, consulenza, M&A che seguono il business del calcio.
Stack: sito statico su Vercel con archivio edizioni, form iscrizione, sezioni Bilancio/Deal/Metrica.

Il tuo compito settimanale: analizzare le opportunità SEO per Valore Atteso e produrre un report con azioni concrete.

Usa web search per:

1. KEYWORD RESEARCH
Cerca le query più cercate su Google in italiano relative a:
- "bilancio calcio" + varianti (bilancio Serie A, bilancio Inter, bilancio Juventus ecc.)
- "M&A calcio" / "acquisizione club calcio"
- "diritti TV Serie A" / "diritti televisivi calcio"
- "finanza calcio" / "business calcio"
- "valutazione club calcio" / "quanto vale [club]"
- "private equity calcio" / "fondo investimento calcio"
- "stadium yield" / "ricavi stadio calcio"
- "financial fair play" / "PSR calcio"

Per ogni keyword identifica:
- Volume di ricerca stimato (alto/medio/basso)
- Difficoltà SEO (alta/media/bassa) — cerca se ci sono siti autorevoli che già la presidiano
- Opportunità per Valore Atteso (quanto è facile scalare)

2. ANALISI CONCORRENZA
Cerca chi appare su Google per queste keyword in italiano:
- Quali siti dominano
- Se ci sono newsletter o blog simili a Valore Atteso già posizionati
- Dove ci sono gap di contenuto che Valore Atteso può sfruttare

3. OTTIMIZZAZIONI TECNICHE SUGGERITE
Basandoti su best practice SEO per siti di newsletter:
- Meta title e description ottimali per la homepage
- Schema markup suggerito
- Opportunità di internal linking

4. CONTENUTI SUGGERITI
Identifica 3-5 articoli/pagine che Valore Atteso potrebbe creare per catturare traffico organico:
- Tipo: "Glossario finanza calcio" (cos'è EBITDA di un club, player trading, salary ratio ecc.)
- Tipo: articolo evergreen "Come leggere il bilancio di un club di calcio"
- Tipo: pagine specifiche per query ad alto volume ("Bilancio Inter 2024", "Quanto vale il Milan")

Rispondi SOLO con JSON valido:
{
  "data": "${today}",
  "keyword_opportunities": [
    {
      "keyword": "query esatta",
      "volume": "alto|medio|basso",
      "difficolta": "alta|media|bassa",
      "opportunita": "alta|media|bassa",
      "note": "perché è interessante per Valore Atteso",
      "contenuto_suggerito": "tipo di contenuto per presidiare questa keyword"
    }
  ],
  "concorrenza": {
    "siti_dominanti": ["sito 1", "sito 2"],
    "newsletter_simili": ["newsletter 1"],
    "gap_identificati": ["gap 1", "gap 2"]
  },
  "ottimizzazioni_tecniche": [
    {
      "elemento": "meta title|meta description|schema|altro",
      "attuale": "valore attuale stimato",
      "suggerito": "valore ottimizzato",
      "priorita": "alta|media|bassa"
    }
  ],
  "contenuti_suggeriti": [
    {
      "titolo": "titolo dell'articolo/pagina",
      "tipo": "glossario|articolo|pagina specifica|faq",
      "keyword_target": "keyword principale",
      "volume_stimato": "alto|medio|basso",
      "difficolta": "alta|media|bassa",
      "descrizione": "di cosa tratta e perché funzionerebbe",
      "priorita": 1
    }
  ],
  "azione_prioritaria": "la singola azione più impattante da fare questa settimana",
  "score_opportunita": 1-10
}`;

  console.log('1. Analisi SEO con web search...');

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

  const textBlocks = (claudeData.content || []).filter(b => b.type === 'text');
  if (!textBlocks.length) throw new Error('Nessun testo nella risposta');

  // Cerca JSON in tutti i blocchi di testo
  let report = null;
  for (const block of textBlocks) {
    const matches = block.text.match(/\{[\s\S]*\}/g);
    if (matches) {
      for (const m of matches) {
        try { report = JSON.parse(m); break; } catch(e) {}
      }
    }
    if (report) break;
  }
  
  // Se non trovato, chiedi a Claude di riformattare
  if (!report) {
    console.log('JSON non trovato nella prima risposta, richiedo riformattazione...');
    const retry = await httpRequest('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [
          { role: 'user', content: prompt },
          ...claudeData.content.filter(b => b.type === 'text').map(b => ({ role: 'assistant', content: b.text })),
          { role: 'user', content: 'Rispondi SOLO con il JSON valido richiesto, niente altro testo prima o dopo.' }
        ]
      })
    });
    const retryData = retry.json();
    const retryText = (retryData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const retryMatch = retryText.match(/\{[\s\S]*\}/);
    if (!retryMatch) throw new Error('JSON non trovato nemmeno nel retry');
    report = JSON.parse(retryMatch[0]);
  }

  console.log(`Keyword opportunities: ${report.keyword_opportunities?.length || 0}`);
  console.log(`Contenuti suggeriti: ${report.contenuti_suggeriti?.length || 0}`);
  console.log('Azione prioritaria:', report.azione_prioritaria);

  // Costruisci email report
  console.log('2. Costruzione report SEO...');

  const oppColor = score => score >= 7 ? '#1A3A2A' : score >= 5 ? '#F5A623' : '#888480';
  const diffBadge = d => ({ alta: '#B5221A', media: '#F5A623', bassa: '#1A3A2A' }[d] || '#888480');

  const keywords_html = (report.keyword_opportunities || [])
    .sort((a, b) => ({ alta: 3, media: 2, bassa: 1 }[b.opportunita] - { alta: 3, media: 2, bassa: 1 }[a.opportunita]))
    .slice(0, 8)
    .map(k => `<tr style="border-bottom:1px solid #C8C4BB">
      <td style="padding:8px 12px;font-family:'Courier New',monospace;font-size:10px;color:#111010;font-weight:600">${k.keyword}</td>
      <td style="padding:8px 12px;text-align:center"><span style="font-family:'Courier New',monospace;font-size:8px;color:#888480;text-transform:uppercase">${k.volume}</span></td>
      <td style="padding:8px 12px;text-align:center"><span style="font-family:'Courier New',monospace;font-size:8px;background:${diffBadge(k.difficolta)};color:#fff;padding:2px 6px">${k.difficolta}</span></td>
      <td style="padding:8px 12px;text-align:center"><span style="font-family:'Courier New',monospace;font-size:8px;background:${diffBadge(k.opportunita)};color:#fff;padding:2px 6px">${k.opportunita}</span></td>
    </tr>`).join('');

  const contenuti_html = (report.contenuti_suggeriti || [])
    .sort((a, b) => a.priorita - b.priorita)
    .slice(0, 5)
    .map((c, i) => `<tr><td style="padding:14px 20px;border-bottom:1px solid #C8C4BB">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <span style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#888480;background:#EDE9E0;padding:2px 8px">${c.tipo}</span>
        <span style="font-family:'Courier New',monospace;font-size:8px;color:${diffBadge(c.difficolta)};font-weight:600">Difficoltà ${c.difficolta}</span>
      </div>
      <p style="font-family:Georgia,serif;font-size:13px;font-weight:700;margin:0 0 4px;color:#111010">${i+1}. ${c.titolo}</p>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#B5221A;margin:0 0 6px">Keyword: ${c.keyword_target} · Volume ${c.volume_stimato}</p>
      <p style="font-family:Georgia,serif;font-size:11px;color:#3D3C39;font-weight:300;line-height:1.6;margin:0">${c.descrizione}</p>
    </td></tr>`).join('');

  const ottimizzazioni_html = (report.ottimizzazioni_tecniche || [])
    .filter(o => o.priorita === 'alta')
    .map(o => `<tr><td style="padding:10px 16px;border-bottom:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px">${o.elemento}</p>
      <p style="font-family:Georgia,serif;font-size:12px;color:#111010;font-weight:300;line-height:1.5;margin:0 0 4px"><strong style="font-weight:500">Suggerito:</strong> ${o.suggerito}</p>
      ${o.attuale ? `<p style="font-family:Georgia,serif;font-size:11px;color:#888480;font-weight:300;margin:0">Attuale: ${o.attuale}</p>` : ''}
    </td></tr>`).join('');

  const emailHTML = `<table width="620" style="max-width:620px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif">
    <tr><td style="padding:20px 28px;background:#111010;text-align:center">
      <h1 style="color:#F7F4EE;font-size:22px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.4);letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">SEO Agent · Report settimanale · ${today}</p>
    </td></tr>

    <!-- AZIONE PRIORITARIA -->
    <tr><td style="padding:20px 24px;background:#111010;border-top:1px solid rgba(255,255,255,.1)">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.4);letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px">Azione prioritaria questa settimana</p>
      <p style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#F7F4EE;margin:0 0 8px;line-height:1.3">${report.azione_prioritaria}</p>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.4);margin:0">Score opportunità SEO: ${report.score_opportunita}/10</p>
    </td></tr>

    <!-- KEYWORD -->
    <tr><td style="padding:0">
      <table width="100%" style="border-collapse:collapse">
        <tr><td colspan="4" style="padding:10px 16px;background:#EDE9E0;border-bottom:1px solid #C8C4BB">
          <span style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480">Keyword opportunities — ordinate per opportunità</span>
        </td></tr>
        <tr style="background:#EDE9E0;border-bottom:1px solid #C8C4BB">
          <th style="padding:6px 12px;font-family:'Courier New',monospace;font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#888480;text-align:left">Keyword</th>
          <th style="padding:6px 12px;font-family:'Courier New',monospace;font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#888480;text-align:center">Volume</th>
          <th style="padding:6px 12px;font-family:'Courier New',monospace;font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#888480;text-align:center">Difficoltà</th>
          <th style="padding:6px 12px;font-family:'Courier New',monospace;font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#888480;text-align:center">Opportunità</th>
        </tr>
        ${keywords_html}
      </table>
    </td></tr>

    <!-- GAP CONCORRENZA -->
    ${report.concorrenza?.gap_identificati?.length ? `
    <tr><td style="padding:16px 24px;background:#EDE9E0;border-top:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px">Gap di contenuto identificati</p>
      ${report.concorrenza.gap_identificati.map(g => `<p style="font-family:Georgia,serif;font-size:12px;color:#111010;font-weight:300;margin:0 0 4px">· ${g}</p>`).join('')}
    </td></tr>` : ''}

    <!-- CONTENUTI SUGGERITI -->
    <tr><td style="padding:0;border-top:2px solid #111010">
      <table width="100%" style="border-collapse:collapse">
        <tr><td style="padding:10px 20px;border-bottom:1px solid #C8C4BB">
          <span style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480">Contenuti da creare — priorità SEO</span>
        </td></tr>
        ${contenuti_html}
      </table>
    </td></tr>

    <!-- OTTIMIZZAZIONI TECNICHE -->
    ${ottimizzazioni_html ? `
    <tr><td style="padding:0;border-top:2px solid #111010">
      <table width="100%" style="border-collapse:collapse">
        <tr><td style="padding:10px 16px;background:#EDE9E0;border-bottom:1px solid #C8C4BB">
          <span style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480">Ottimizzazioni tecniche — priorità alta</span>
        </td></tr>
        ${ottimizzazioni_html}
      </table>
    </td></tr>` : ''}

    <tr><td style="padding:14px 24px;border-top:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:8px;color:#888480;margin:0">SEO Agent · Valore Atteso · ${today} · <a href="${SITE}" style="color:#888480">valore-atteso.vercel.app</a></p>
    </td></tr>
  </table>`;

  console.log('3. Invio report SEO a', APPROVAL_EMAIL);

  const emailRes = await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + RESEND_KEY
    },
    body: JSON.stringify({
      from: 'Valore Atteso SEO <onboarding@resend.dev>',
      to: APPROVAL_EMAIL,
      subject: `SEO Agent · ${report.azione_prioritaria?.substring(0, 55) || 'Report ' + today}`,
      html: emailHTML
    })
  });

  console.log('Report inviato, status:', emailRes.status);
  console.log('SEO Agent completato.');
}

main().catch(e => { console.error('ERRORE SEO Agent:', e.message); process.exit(1); });
