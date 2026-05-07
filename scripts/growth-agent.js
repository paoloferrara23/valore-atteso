// growth-agent.js — Monitora crescita iscritti
// Gira: mercoledì 8:00 | Scrive: growth_report

const { memSet, logRun } = require('./memory');

const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;
const FROM = 'Valore Atteso <newsletter@fidesrara.com>';

async function supaFetch(path) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  return r.json();
}

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT');
  console.log('Growth Agent avviato:', new Date().toISOString());

  // Dati iscritti
  const tuttiRaw = await supaFetch('/rest/v1/subscribers?select=email,confirmed,created_at,source');
  const tutti = Array.isArray(tuttiRaw) ? tuttiRaw : [];
  const confermati = tutti.filter(s => s.confirmed).length;
  const nonConfermati = tutti.filter(s => !s.confirmed).length;

  // Crescita ultima settimana
  const settimanaFa = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const nuoviSettimana = tutti.filter(s => s.created_at > settimanaFa);
  const nuoviConfermati = nuoviSettimana.filter(s => s.confirmed);

  // Crescita ultimo mese
  const meseFa = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const nuoviMese = tutti.filter(s => s.created_at > meseFa);

  // Tasso di conversione (iscritti che confermano)
  const tassoConversione = tutti.length > 0 ? ((confermati.length / tutti.length) * 100).toFixed(1) : 0;
  const tassoConversioneSettimana = nuoviSettimana.length > 0
    ? ((nuoviConfermati.length / nuoviSettimana.length) * 100).toFixed(1) : 0;

  // Fonti (se disponibili)
  const fonti = {};
  tutti.forEach(s => {
    const src = s.source || 'organic';
    fonti[src] = (fonti[src] || 0) + 1;
  });

  const report = {
    data: oggi,
    totale_iscritti: tutti.length,
    confermati: confermati.length,
    non_confermati: nonConfermati.length,
    nuovi_settimana: nuoviSettimana.length,
    nuovi_confermati_settimana: nuoviConfermati.length,
    nuovi_mese: nuoviMese.length,
    tasso_conversione: parseFloat(tassoConversione),
    tasso_conversione_settimana: parseFloat(tassoConversioneSettimana),
    fonti
  };

  await memSet('growth_report', report, 'growth');

  // Alert se conversione bassa
  const alerts = [];
  if (parseFloat(tassoConversione) < 50 && tutti.length > 10) {
    alerts.push(`Tasso conversione basso: ${tassoConversione}% (ottimale >70%)`);
  }
  if (nuoviSettimana.length === 0 && tutti.length > 0) {
    alerts.push('Nessun nuovo iscritto questa settimana');
  }

  const fontiHTML = Object.entries(fonti).map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;color:#4A4845">${k}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;text-align:right;color:#1A1A1A">${v}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;text-align:right;color:#9A9690">${tutti.length > 0 ? ((v/tutti.length)*100).toFixed(0) : 0}%</td>
    </tr>`).join('');

  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB">
      <tr><td style="padding:20px 24px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">Growth Agent · Report ${oggi}</div>
      </td></tr>
      ${alerts.length > 0 ? `<tr><td style="padding:12px 24px;background:#FEF2F2;border-bottom:1px solid #D0CBC0">${alerts.map(a => `<div style="font-family:'Courier New',monospace;font-size:10px;color:#C8251D">⚠ ${a}</div>`).join('')}</td></tr>` : ''}
      <tr><td style="padding:16px 24px">
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">Metriche iscritti</div>
        <table width="100%" style="border-collapse:collapse;font-family:'Courier New',monospace;font-size:11px">
          <tr style="background:#EDE9E0"><td style="padding:10px 12px;font-weight:700;font-size:13px">${confermati}</td><td style="padding:10px 12px;color:#9A9690">Iscritti confermati</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:#4A4845">${tutti.length}</td><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:#9A9690">Totale iscrizioni</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:#4A4845">+${nuoviSettimana.length}</td><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:#9A9690">Nuovi questa settimana</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:#4A4845">+${nuoviMese.length}</td><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:#9A9690">Nuovi ultimo mese</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:${parseFloat(tassoConversione) > 70 ? '#1B4332' : '#C8251D'}">${tassoConversione}%</td><td style="padding:8px 12px;border-bottom:1px solid #E2DDD4;color:#9A9690">Tasso conversione (confermati/totale)</td></tr>
          <tr><td style="padding:8px 12px;color:#4A4845">${tassoConversioneSettimana}%</td><td style="padding:8px 12px;color:#9A9690">Conversione ultimi 7 giorni</td></tr>
        </table>
      </td></tr>
      ${Object.keys(fonti).length > 0 ? `
      <tr><td style="padding:0 24px 16px">
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Fonti acquisizione</div>
        <table width="100%" style="border-collapse:collapse">
          <tr style="background:#EDE9E0">
            <th style="padding:6px 12px;text-align:left;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;font-weight:400">Fonte</th>
            <th style="padding:6px 12px;text-align:right;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;font-weight:400">Iscritti</th>
            <th style="padding:6px 12px;text-align:right;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;font-weight:400">%</th>
          </tr>
          ${fontiHTML}
        </table>
      </td></tr>` : ''}
      <tr><td style="padding:12px 24px;border-top:1px solid #D0CBC0">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">Dati salvati su Supabase · visibili all'AD</div>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `Growth VA · ${confermati.length} iscritti confermati · +${nuoviSettimana.length} settimana`,
      html
    })
  });

  await logRun('growth', alerts.length > 0 ? 'warning' : 'success',
    `${confermati.length} confermati, +${nuoviSettimana.length} settimana, conversione ${tassoConversione}%`,
    report, Date.now() - start);

  console.log('Growth Agent completato.');
}

main().catch(async e => {
  console.error('ERRORE Growth Agent:', e.message);
  await logRun('growth', 'error', e.message).catch(() => {});
  process.exit(1);
});
