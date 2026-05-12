// api/upload-source.js — Carica documenti nella biblioteca fonti

module.exports.config = { maxDuration: 60, api: { bodyParser: { sizeLimit: '20mb' } } };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const SUPA_URL = 'https://xxnmkiwnjpppfzrftvuv.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bm1raXduanBwcGZ6cmZ0dnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MTkwNTUsImV4cCI6MjA5MTk5NTA1NX0.2EePZNm_OCc9WscYSG7CL_mbFV6E8ifwV9sP2WxkUo4';

  const { nome, tipo, soggetto, anno, stagione, url, filename, testo_base64 } = req.body || {};

  if (!nome || !testo_base64) {
    return res.status(400).json({ error: 'nome e file sono obbligatori' });
  }

  try {
    const isPDF = filename && filename.toLowerCase().endsWith('.pdf');

    // Controlla dimensione base64 — se > 8MB tronca per non eccedere Claude
    const base64Size = testo_base64.length * 0.75; // bytes approssimativi
    const maxSize = 8 * 1024 * 1024; // 8MB
    let fileData = testo_base64;

    let messageContent;

    if (isPDF && base64Size <= maxSize) {
      // PDF piccolo — usa API PDF nativa di Claude
      messageContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileData }
        },
        {
          type: 'text',
          text: 'Sei un analista CF specializzato nel calcio europeo. Analizza questo documento di ' + (soggetto||'club/ente') + ' (' + (stagione||anno||'') + ') ed estrai i dati chiave finanziari. Rispondi SOLO con JSON valido senza testo aggiuntivo: {"ricavi_totali":"valore M€ o null","ebitda":"M€ o null","risultato_netto":"M€ o null","indebitamento_netto":"M€ o null","costo_personale":"M€ o null","salary_ratio":"% o null","matchday_revenue":"M€ o null","broadcasting_revenue":"M€ o null","commercial_revenue":"M€ o null","ammortamenti_cartellini":"M€ o null","plusvalenze":"M€ o null","patrimonio_netto":"M€ o null","periodo":"data bilancio o anno","valuta":"EUR o GBP o USD","summary":"2-3 frasi CF sui dati piu rilevanti"}'
        }
      ];
    } else if (isPDF && base64Size > maxSize) {
      // PDF troppo grande — decodifica e prendi solo i primi 20k caratteri di testo
      // Non possiamo inviare l'intero PDF, usiamo il testo come fallback
      return res.status(400).json({
        error: 'Il PDF è troppo grande (' + Math.round(base64Size/1024/1024) + 'MB). Massimo 8MB. Prova a comprimere il PDF o carica solo le pagine rilevanti.'
      });
    } else {
      // Testo plain
      const testo = Buffer.from(testo_base64, 'base64').toString('utf-8').slice(0, 15000);
      messageContent = [
        {
          type: 'text',
          text: 'Sei un analista CF specializzato nel calcio europeo. Analizza questo testo di ' + (soggetto||'club/ente') + ' ed estrai i dati chiave. Rispondi SOLO con JSON valido: {"ricavi_totali":"M€ o null","ebitda":"M€ o null","risultato_netto":"M€ o null","indebitamento_netto":"M€ o null","costo_personale":"M€ o null","salary_ratio":"% o null","matchday_revenue":"M€ o null","broadcasting_revenue":"M€ o null","commercial_revenue":"M€ o null","ammortamenti_cartellini":"M€ o null","plusvalenze":"M€ o null","patrimonio_netto":"M€ o null","periodo":"data bilancio","valuta":"EUR o GBP o USD","summary":"2-3 frasi CF sui dati piu rilevanti"}\n\nTESTO:\n' + testo
        }
      ];
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: messageContent }]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error('Anthropic error ' + r.status + ': ' + errText.slice(0, 200));
    }

    const data = await r.json();
    const risposta = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '{}';

    let dati_chiave = {};
    try {
      const match = risposta.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
      if (match) dati_chiave = JSON.parse(match[0]);
    } catch(e) {
      console.error('JSON parse error:', e.message, risposta.slice(0, 200));
    }

    const kpi_count = Object.entries(dati_chiave).filter(([k,v]) => v && v !== 'null' && !['summary','periodo','valuta'].includes(k)).length;
    const testo_estratto = dati_chiave.summary || '';

    // Salva su Supabase
    const saveR = await fetch(SUPA_URL + '/rest/v1/sources_library', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPA_KEY,
        Authorization: 'Bearer ' + SUPA_KEY,
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        nome,
        tipo: tipo || 'report',
        soggetto: soggetto || null,
        anno: anno || null,
        stagione: stagione || null,
        testo_estratto,
        dati_chiave,
        url: url || null
      })
    });

    const saved = await saveR.json();
    return res.status(200).json({ ok: true, id: saved[0]?.id, dati_chiave, kpi_count });

  } catch(e) {
    console.error('Errore upload-source:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
