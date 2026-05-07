// scout.js — Cerca notizie CF calcio, salva su memoria condivisa
// Gira: sabato 7:00 | Scrive: scout_brief, scout_themes

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
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      system,
      messages
    })
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.text}`);
  const data = r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function main() {
  const start = Date.now();
  console.log('Scout avviato:', new Date().toISOString());

  const system = `Sei lo Scout di Valore Atteso, newsletter italiana sul business del calcio.
Il tuo compito: trovare le 5 notizie più rilevanti della settimana sul business del calcio dal punto di vista del corporate finance.

Criteri di selezione:
- Rilevanza economica: bilanci, acquisizioni, diritti TV, valutazioni, debito
- Dati verificabili: preferisci notizie con numeri concreti
- Angolo CF: ogni notizia deve avere un'analisi finanziaria possibile

Escludi:
- Gossip di mercato sui calciatori senza impatto finanziario
- Risultati sportivi senza implicazioni economiche
- Opinioni senza dati

Rispondi SOLO in JSON, nessun testo prima o dopo:
{
  "settimana": "DD/MM/YYYY",
  "temi": [
    {
      "titolo": "...",
      "notizia": "...",
      "angolo_cf": "...",
      "sezione_suggerita": "bilancio|deal|metrica",
      "priorita": 1-5,
      "dati_chiave": ["dato1", "dato2"]
    }
  ],
  "tema_consigliato": "...",
  "note_editoriali": "..."
}`;

  const oggi = new Date().toLocaleDateString('it-IT');
  const testo = await callClaude([{
    role: 'user',
    content: `Oggi è ${oggi}. Analizza le notizie più rilevanti degli ultimi 7 giorni sul business del calcio europeo e genera il brief settimanale per Valore Atteso.`
  }], system);

  let brief;
  try {
    const match = testo.match(/\{[\s\S]*\}/);
    brief = JSON.parse(match[0]);
  } catch {
    throw new Error('JSON non valido dallo Scout');
  }

  // Salva nella memoria condivisa per l'Editoriale Agent
  await memSet('scout_brief', brief, 'scout');
  await memSet('scout_themes', brief.temi, 'scout');
  await memSet('scout_last_run', { date: oggi, tema_consigliato: brief.tema_consigliato }, 'scout');

  console.log('Brief salvato su Supabase. Temi trovati:', brief.temi.length);

  // Email a Paolo
  const temasHTML = brief.temi.map((t, i) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #E2DDD4;vertical-align:top">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">
          #${i+1} · ${t.sezione_suggerita.toUpperCase()} · Priorità ${t.priorita}/5
        </div>
        <div style="font-family:Georgia,serif;font-size:14px;font-weight:700;margin-bottom:6px">${t.titolo}</div>
        <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.6;margin-bottom:8px">${t.notizia}</div>
        <div style="font-family:'Courier New',monospace;font-size:10px;color:#1B4332;background:#E4EDE7;padding:8px 10px">
          CF: ${t.angolo_cf}
        </div>
        ${t.dati_chiave?.length ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;margin-top:6px">Dati: ${t.dati_chiave.join(' · ')}</div>` : ''}
      </td>
    </tr>`).join('');

  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif">
      <tr><td style="padding:20px 24px;border-bottom:2px solid #1A1A1A;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-1px;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">Scout · Brief Settimanale · ${oggi}</div>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Tema consigliato per l'edizione</div>
        <div style="font-family:Georgia,serif;font-size:15px;font-weight:700">${brief.tema_consigliato}</div>
        ${brief.note_editoriali ? `<div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;margin-top:6px;font-style:italic">${brief.note_editoriali}</div>` : ''}
      </td></tr>
      <tr><td style="padding:0">
        <table width="100%" style="border-collapse:collapse">${temasHTML}</table>
      </td></tr>
      <tr><td style="padding:12px 24px;border-top:1px solid #D0CBC0;text-align:center">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">Scout · Valore Atteso · Temi salvati su Supabase per l'Editoriale Agent</div>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Scout VA · ${brief.tema_consigliato}`, html })
  });

  await logRun('scout', 'success', `${brief.temi.length} temi trovati. Consigliato: ${brief.tema_consigliato}`, brief, Date.now() - start);
  console.log('Scout completato.');
}

main().catch(async e => {
  console.error('ERRORE Scout:', e.message);
  await logRun('scout', 'error', e.message).catch(() => {});
  process.exit(1);
});
