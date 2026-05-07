// seo-agent.js — Analisi keyword, salva su memoria condivisa
// Gira: domenica 8:00 | Scrive: seo_keywords, seo_report

const { memSet, logRun } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const FROM = 'Valore Atteso <newsletter@fidesrara.com>';

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
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 2000, system, messages })
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.text}`);
  const data = r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function main() {
  const start = Date.now();
  console.log('SEO Agent avviato:', new Date().toISOString());

  const system = `Sei il SEO Agent di Valore Atteso, newsletter sul business del calcio.
Analizza le opportunità SEO per il sito e il glossario.

Rispondi SOLO in JSON:
{
  "keyword_prioritarie": [
    {
      "keyword": "...",
      "volume_stimato": "alto|medio|basso",
      "difficolta": "alta|media|bassa",
      "intento": "informativo|navigazionale|transazionale",
      "pagina_suggerita": "glossario|articolo|home",
      "titolo_suggerito": "..."
    }
  ],
  "opportunita_glossario": ["termine1", "termine2"],
  "titoli_articoli_suggeriti": ["titolo1", "titolo2", "titolo3"],
  "note": "..."
}`;

  const oggi = new Date().toLocaleDateString('it-IT');
  const testo = await callClaude([{
    role: 'user',
    content: `Oggi è ${oggi}. Analizza le opportunità SEO per Valore Atteso — newsletter italiana sul business del calcio. Focus su keyword long-tail nel settore corporate finance applicato al calcio. Considera il glossario già presente sul sito con termini come EBITDA calcio, player trading, salary ratio, stadium yield, LBO calcio.`
  }], system);

  let report;
  try {
    const match = testo.match(/\{[\s\S]*\}/);
    report = JSON.parse(match[0]);
  } catch {
    // Retry
    const retry = await callClaude([
      { role: 'user', content: `Oggi è ${oggi}. Analizza keyword SEO per Valore Atteso.` },
      { role: 'assistant', content: testo },
      { role: 'user', content: 'Rispondi SOLO con il JSON, nessun testo prima o dopo.' }
    ], system);
    const match2 = retry.match(/\{[\s\S]*\}/);
    if (!match2) throw new Error('JSON SEO non trovato');
    report = JSON.parse(match2[0]);
  }

  // Salva keyword per l'Editoriale Agent
  await memSet('seo_keywords', report.keyword_prioritarie, 'seo');
  await memSet('seo_report', report, 'seo');

  console.log('Report SEO salvato. Keyword trovate:', report.keyword_prioritarie?.length);

  // Email report
  const kwHTML = report.keyword_prioritarie?.slice(0, 8).map(k => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;color:#1A1A1A">${k.keyword}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;color:#9A9690;text-align:center">${k.volume_stimato}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;color:#9A9690;text-align:center">${k.difficolta}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;color:#1B4332">${k.pagina_suggerita}</td>
    </tr>`).join('') || '';

  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB">
      <tr><td style="padding:20px 24px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">SEO Agent · Report ${oggi}</div>
      </td></tr>
      <tr><td style="padding:16px 24px">
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">Keyword prioritarie</div>
        <table width="100%" style="border-collapse:collapse;font-size:11px">
          <tr style="background:#EDE9E0">
            <th style="padding:8px 12px;text-align:left;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;font-weight:400">Keyword</th>
            <th style="padding:8px 12px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;font-weight:400">Volume</th>
            <th style="padding:8px 12px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;font-weight:400">Difficoltà</th>
            <th style="padding:8px 12px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;font-weight:400">Pagina</th>
          </tr>
          ${kwHTML}
        </table>
      </td></tr>
      ${report.titoli_articoli_suggeriti?.length ? `
      <tr><td style="padding:0 24px 16px">
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Articoli suggeriti</div>
        ${report.titoli_articoli_suggeriti.map(t => `<div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;padding:4px 0;border-bottom:1px solid #E2DDD4">→ ${t}</div>`).join('')}
      </td></tr>` : ''}
      <tr><td style="padding:12px 24px;border-top:1px solid #D0CBC0">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">Keyword salvate su Supabase · disponibili per l'Editoriale Agent</div>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `SEO Agent VA · ${report.keyword_prioritarie?.length || 0} keyword`, html })
  });

  await logRun('seo', 'success', `${report.keyword_prioritarie?.length || 0} keyword trovate`, report, Date.now() - start);
  console.log('SEO Agent completato.');
}

main().catch(async e => {
  console.error('ERRORE SEO Agent:', e.message);
  await logRun('seo', 'error', e.message).catch(() => {});
  process.exit(1);
});
