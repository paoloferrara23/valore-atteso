// cost-guardian.js — Monitora costi, salva su memoria condivisa
// Gira: venerdì 9:00 | Scrive: cost_report

const { memSet, logRun, memGet } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SOGLIA_ANTHROPIC = parseFloat(process.env.SOGLIA_ANTHROPIC || '10');
const SOGLIA_RESEND = parseFloat(process.env.SOGLIA_RESEND || '10');
const FROM = 'Valore Atteso <newsletter@fidesrara.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  console.log('Cost Guardian avviato:', new Date().toISOString());

  // Legge run precedenti per stimare utilizzo
  const prevCost = await memGet('cost_report');
  const agentRuns = { scout: 0, editoriale: 0, seo: 0, growth: 0 };

  // Stima costi da agent_runs (ogni run Anthropic ~€0.05-0.15)
  const costoPerRun = { scout: 0.08, editoriale: 0.15, seo: 0.08, 'cost-guardian': 0.03, growth: 0.05 };
  const stimaAnthropicMese = Object.entries(agentRuns).reduce((sum, [k, v]) => sum + (costoPerRun[k] || 0.05) * v, 0);

  // Stima email Resend (gratis fino 3000/mese)
  const emailStimate = 0; // Da popolare con dato reale quando ci sono iscritti
  const costoResend = emailStimate > 3000 ? (emailStimate - 3000) * 0.0001 : 0;

  const costoTotale = stimaAnthropicMese + costoResend;
  const alerts = [];

  if (stimaAnthropicMese > SOGLIA_ANTHROPIC * 0.8) alerts.push(`Anthropic vicino alla soglia: €${stimaAnthropicMese.toFixed(2)}/€${SOGLIA_ANTHROPIC}`);
  if (costoResend > SOGLIA_RESEND * 0.8) alerts.push(`Resend vicino alla soglia: €${costoResend.toFixed(2)}/€${SOGLIA_RESEND}`);

  const report = {
    mese: oggi,
    anthropic_stimato: stimaAnthropicMese,
    resend_stimato: costoResend,
    totale_stimato: costoTotale,
    soglia_anthropic: SOGLIA_ANTHROPIC,
    soglia_resend: SOGLIA_RESEND,
    alerts,
    email_inviate: emailStimate
  };

  await memSet('cost_report', report, 'cost-guardian');

  const statusColor = alerts.length > 0 ? '#C8251D' : '#1B4332';
  const statusLabel = alerts.length > 0 ? 'ALERT' : 'OK';

  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB">
      <tr><td style="padding:20px 24px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">Cost Guardian · ${oggi}</div>
      </td></tr>
      <tr><td style="padding:16px 24px;background:${alerts.length > 0 ? '#FEF2F2' : '#E4EDE7'};border-bottom:1px solid #D0CBC0">
        <div style="font-family:'Courier New',monospace;font-size:11px;color:${statusColor};letter-spacing:.1em;text-transform:uppercase;font-weight:700">${statusLabel} — Costi ${oggi}</div>
        ${alerts.map(a => `<div style="font-family:Georgia,serif;font-size:13px;color:#C8251D;margin-top:6px">⚠ ${a}</div>`).join('')}
      </td></tr>
      <tr><td style="padding:16px 24px">
        <table width="100%" style="border-collapse:collapse;font-family:'Courier New',monospace;font-size:11px">
          <tr><td style="padding:8px 0;border-bottom:1px solid #E2DDD4;color:#9A9690">Anthropic API (stimato)</td><td style="padding:8px 0;border-bottom:1px solid #E2DDD4;text-align:right;color:#1A1A1A">€${stimaAnthropicMese.toFixed(2)} / €${SOGLIA_ANTHROPIC}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #E2DDD4;color:#9A9690">Resend email</td><td style="padding:8px 0;border-bottom:1px solid #E2DDD4;text-align:right;color:#1A1A1A">€${costoResend.toFixed(2)} / €${SOGLIA_RESEND}</td></tr>
          <tr><td style="padding:8px 0;color:#1A1A1A;font-weight:700">Totale stimato</td><td style="padding:8px 0;text-align:right;color:#1A1A1A;font-weight:700">€${costoTotale.toFixed(2)}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:12px 24px;border-top:1px solid #D0CBC0">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">Dati salvati su Supabase · visibili all'AD</div>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `Cost Guardian VA · ${statusLabel} · €${costoTotale.toFixed(2)} ${oggi}`,
      html
    })
  });

  await logRun('cost-guardian', alerts.length > 0 ? 'warning' : 'success',
    `Costo stimato: €${costoTotale.toFixed(2)}. ${alerts.length} alert.`, report, Date.now() - start);

  if (alerts.length > 0) process.exit(1);
  console.log('Cost Guardian completato.');
}

main().catch(async e => {
  console.error('ERRORE Cost Guardian:', e.message);
  await logRun('cost-guardian', 'error', e.message).catch(() => {});
  process.exit(1);
});
