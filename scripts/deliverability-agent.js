// deliverability-agent.js — Monitora deliverability email via Resend
// Gira: giovedì 8:00 | Scrive: deliverability_report

const { memSet, logRun } = require('./memory');

const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT');
  console.log('Deliverability Agent avviato:', new Date().toISOString());

  // Recupera email recenti da Resend
  let emails = [];
  try {
    const r = await httpRequest('https://api.resend.com/emails?limit=50', {
      headers: { 'Authorization': `Bearer ${RESEND_KEY}` }
    });
    if (r.ok) {
      const data = r.json();
      emails = data.data || [];
    }
  } catch (e) {
    console.log('Resend API non disponibile per statistiche:', e.message);
  }

  // Calcola metriche
  const totale = emails.length;
  const consegnate = emails.filter(e => e.last_event === 'delivered' || e.last_event === 'opened' || e.last_event === 'clicked').length;
  const aperte = emails.filter(e => e.last_event === 'opened' || e.last_event === 'clicked').length;
  const cliccate = emails.filter(e => e.last_event === 'clicked').length;
  const bounced = emails.filter(e => e.last_event === 'bounced').length;
  const spam = emails.filter(e => e.last_event === 'complained').length;

  const tassoConsegna = totale > 0 ? ((consegnate / totale) * 100).toFixed(1) : 'N/A';
  const tassoApertura = consegnate > 0 ? ((aperte / consegnate) * 100).toFixed(1) : 'N/A';
  const tassoClick = aperte > 0 ? ((cliccate / aperte) * 100).toFixed(1) : 'N/A';
  const tassoBounce = totale > 0 ? ((bounced / totale) * 100).toFixed(1) : 'N/A';

  const report = {
    data: oggi,
    email_analizzate: totale,
    consegnate, aperte, cliccate, bounced, spam,
    tasso_consegna: tassoConsegna,
    tasso_apertura: tassoApertura,
    tasso_click: tassoClick,
    tasso_bounce: tassoBounce
  };

  await memSet('deliverability_report', report, 'deliverability');

  // Alert
  const alerts = [];
  if (parseFloat(tassoApertura) < 20 && totale > 5) alerts.push(`Tasso apertura basso: ${tassoApertura}% (ottimale >30%)`);
  if (parseFloat(tassoBounce) > 5 && totale > 5) alerts.push(`Bounce rate alto: ${tassoBounce}% (max accettabile 2%)`);
  if (spam > 0) alerts.push(`${spam} segnalazione/i spam — controllare immediatamente`);

  // Benchmark newsletter B2B
  const benchmarkHTML = `
    <tr style="background:#EDE9E0">
      <td style="padding:6px 12px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690"></td>
      <td style="padding:6px 12px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;text-align:right">Tu</td>
      <td style="padding:6px 12px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;text-align:right">Benchmark B2B</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;color:#4A4845">Tasso apertura</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:${parseFloat(tassoApertura) >= 30 ? '#1B4332' : '#C8251D'}">${tassoApertura}%</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:#9A9690">30-45%</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;color:#4A4845">Tasso click</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:#1A1A1A">${tassoClick}%</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:#9A9690">3-7%</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;font-family:'Courier New',monospace;font-size:10px;color:#4A4845">Bounce rate</td>
      <td style="padding:6px 12px;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:${parseFloat(tassoBounce) <= 2 ? '#1B4332' : '#C8251D'}">${tassoBounce}%</td>
      <td style="padding:6px 12px;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:#9A9690">&lt;2%</td>
    </tr>`;

  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB">
      <tr><td style="padding:20px 24px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">Deliverability Agent · ${oggi}</div>
      </td></tr>
      ${alerts.length > 0 ? `<tr><td style="padding:12px 24px;background:#FEF2F2;border-bottom:1px solid #D0CBC0">${alerts.map(a => `<div style="font-family:'Courier New',monospace;font-size:10px;color:#C8251D">⚠ ${a}</div>`).join('')}</td></tr>` : '<tr><td style="padding:10px 24px;background:#E4EDE7;border-bottom:1px solid #D0CBC0"><div style="font-family:\'Courier New\',monospace;font-size:10px;color:#1B4332">OK — Nessun problema di deliverability rilevato</div></td></tr>'}
      <tr><td style="padding:16px 24px">
        <div style="font-family:\'Courier New\',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">Performance email (ultime ${totale})</div>
        <table width="100%" style="border-collapse:collapse">${benchmarkHTML}</table>
      </td></tr>
      ${totale === 0 ? '<tr><td style="padding:12px 24px;text-align:center"><div style="font-family:\'Courier New\',monospace;font-size:10px;color:#9A9690;font-style:italic">Nessuna email inviata ancora. Le metriche appariranno dopo il primo invio.</div></td></tr>' : ''}
      <tr><td style="padding:12px 24px;border-top:1px solid #D0CBC0">
        <div style="font-family:\'Courier New\',monospace;font-size:8px;color:#9A9690">Dati salvati su Supabase · visibili all\'AD</div>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `Deliverability VA · ${alerts.length > 0 ? 'ALERT' : 'OK'} · Apertura ${tassoApertura}%`,
      html
    })
  });

  await logRun('deliverability', alerts.length > 0 ? 'warning' : 'success',
    `Apertura: ${tassoApertura}%, Click: ${tassoClick}%, Bounce: ${tassoBounce}%`,
    report, Date.now() - start);

  console.log('Deliverability Agent completato.');
}

main().catch(async e => {
  console.error('ERRORE Deliverability:', e.message);
  await logRun('deliverability', 'error', e.message).catch(() => {});
  process.exit(1);
});
