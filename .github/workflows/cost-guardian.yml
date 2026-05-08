// cost-guardian.js — Monitora costi reali da Supabase
// Gira: venerdì 9:00 | Scrive: cost_report

const { memSet, logRun, supaFetch } = require('./memory');

const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SOGLIA_ANTHROPIC = parseFloat(process.env.SOGLIA_ANTHROPIC || '10');
const SOGLIA_RESEND = parseFloat(process.env.SOGLIA_RESEND || '10');
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  console.log('Cost Guardian avviato:', new Date().toISOString());

  // Legge run del mese corrente da Supabase
  const inizioMese = new Date();
  inizioMese.setDate(1);
  inizioMese.setHours(0, 0, 0, 0);

  let agentRunsData = [];
  try {
    const rows = await supaFetch(
      `/rest/v1/agent_runs?created_at=gte.${inizioMese.toISOString()}&select=agent,status,created_at`
    );
    agentRunsData = Array.isArray(rows) ? rows : [];
    console.log(`Run questo mese: ${agentRunsData.length}`);
  } catch(e) {
    console.error('Errore lettura agent_runs:', e.message);
  }

  // Conta run per agente
  const runPerAgente = {};
  agentRunsData.forEach(r => {
    runPerAgente[r.agent] = (runPerAgente[r.agent] || 0) + 1;
  });

  // Costo stimato per run (input+output tokens medi per agente)
  const costoPerRun = {
    scout: 0.12,
    editoriale: 0.18,
    seo: 0.10,
    'cost-guardian': 0.02,
    growth: 0.01,
    deliverability: 0.01
  };

  // Calcola costo Anthropic reale
  let stimaAnthropicMese = 0;
  const dettaglioAgenti = [];
  Object.entries(runPerAgente).forEach(([agente, runs]) => {
    const costo = (costoPerRun[agente] || 0.05) * runs;
    stimaAnthropicMese += costo;
    dettaglioAgenti.push({ agente, runs, costo });
  });

  // Email inviate questo mese da Supabase (stima da iscritti × edizioni)
  let emailInviate = 0;
  try {
    const subs = await supaFetch('/rest/v1/subscribers?confirmed=eq.true&select=email');
    const numIscritti = Array.isArray(subs) ? subs.length : 0;
    const edizioni = await supaFetch(
      `/rest/v1/editions?published=eq.true&created_at=gte.${inizioMese.toISOString()}&select=num`
    );
    const numEdizioni = Array.isArray(edizioni) ? edizioni.length : 0;
    emailInviate = numIscritti * numEdizioni;
    console.log(`Iscritti: ${numIscritti}, Edizioni mese: ${numEdizioni}, Email stimate: ${emailInviate}`);
  } catch(e) {
    console.error('Errore calcolo email:', e.message);
  }

  // Costo Resend (gratis fino a 3000/mese, poi €0.0001/email)
  const costoResend = emailInviate > 3000 ? (emailInviate - 3000) * 0.0001 : 0;
  const costoTotale = stimaAnthropicMese + costoResend;

  const alerts = [];
  if (stimaAnthropicMese > SOGLIA_ANTHROPIC * 0.8) alerts.push(`Anthropic vicino alla soglia: €${stimaAnthropicMese.toFixed(2)}/€${SOGLIA_ANTHROPIC}`);
  if (costoResend > SOGLIA_RESEND * 0.8) alerts.push(`Resend vicino alla soglia: €${costoResend.toFixed(2)}/€${SOGLIA_RESEND}`);

  const report = {
    mese: oggi,
    run_totali: agentRunsData.length,
    run_per_agente: runPerAgente,
    anthropic_stimato: stimaAnthropicMese,
    resend_stimato: costoResend,
    totale_stimato: costoTotale,
    email_inviate: emailInviate,
    alerts
  };

  await memSet('cost_report', report, 'cost-guardian');

  // Tabella dettaglio agenti
  const agentiHTML = dettaglioAgenti.length > 0
    ? dettaglioAgenti.map(a => `
      <tr style="background:${dettaglioAgenti.indexOf(a)%2===0?'#EDE9E0':'#E6E1D8'}">
        <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:10px;color:#4A4845">${a.agente}</td>
        <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:10px;text-align:center;color:#1A1A1A">${a.runs}</td>
        <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:#1A1A1A;font-weight:700">€${a.costo.toFixed(3)}</td>
      </tr>`).join('')
    : `<tr><td colspan="3" style="padding:12px 24px;font-family:'Courier New',monospace;font-size:10px;color:#9A9690;text-align:center">Nessun run registrato questo mese</td></tr>`;

  const statusColor = alerts.length > 0 ? '#C8251D' : '#1B4332';
  const statusLabel = alerts.length > 0 ? 'ALERT' : 'OK';

  const html = `
    <table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
      <tr><td style="padding:24px 28px;background:#1A1A1A;border-bottom:2px solid #1A1A1A">
        <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin:0;letter-spacing:-1px">Valore Atteso</h1>
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Cost Guardian &middot; ${oggi}</p>
      </td></tr>
      <tr><td style="padding:14px 28px;background:${alerts.length > 0 ? '#FEF2F2' : '#E4EDE7'};border-bottom:1px solid #D0CBC0">
        <p style="font-family:'Courier New',monospace;font-size:10px;color:${statusColor};letter-spacing:.1em;text-transform:uppercase;margin:0;font-weight:700">${statusLabel} &mdash; Costi ${oggi}</p>
        ${alerts.map(a => `<p style="font-family:Georgia,serif;font-size:13px;color:#C8251D;margin:6px 0 0">&#9888; ${a}</p>`).join('')}
      </td></tr>
      <tr><td style="padding:16px 28px">
        <table width="100%" style="border-collapse:collapse;font-family:'Courier New',monospace;font-size:11px">
          <tr style="background:#D0CBC0">
            <td style="padding:8px 24px;font-size:9px;color:#1A1A1A;letter-spacing:.08em;text-transform:uppercase;font-weight:500">Voce</td>
            <td style="padding:8px 24px;font-size:9px;color:#1A1A1A;letter-spacing:.08em;text-transform:uppercase;font-weight:500;text-align:right">Stimato / Soglia</td>
          </tr>
          <tr style="background:#EDE9E0">
            <td style="padding:8px 24px;color:#4A4845">Anthropic API (${agentRunsData.length} run)</td>
            <td style="padding:8px 24px;text-align:right;color:#1A1A1A;font-weight:700">€${stimaAnthropicMese.toFixed(2)} / €${SOGLIA_ANTHROPIC}</td>
          </tr>
          <tr style="background:#E6E1D8">
            <td style="padding:8px 24px;color:#4A4845">Resend (${emailInviate} email)</td>
            <td style="padding:8px 24px;text-align:right;color:#1A1A1A;font-weight:700">€${costoResend.toFixed(2)} / €${SOGLIA_RESEND}</td>
          </tr>
          <tr style="background:#D0CBC0">
            <td style="padding:10px 24px;color:#1A1A1A;font-weight:700;font-size:12px">Totale stimato</td>
            <td style="padding:10px 24px;text-align:right;color:#1A1A1A;font-weight:700;font-size:13px">€${costoTotale.toFixed(2)}</td>
          </tr>
        </table>
      </td></tr>
      ${dettaglioAgenti.length > 0 ? `
      <tr><td style="padding:0 28px 16px">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;padding-top:16px">Dettaglio run per agente</p>
        <table width="100%" style="border-collapse:collapse">
          <tr style="background:#D0CBC0">
            <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:9px;color:#1A1A1A;font-weight:500">Agente</td>
            <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:9px;color:#1A1A1A;font-weight:500;text-align:center">Run</td>
            <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:9px;color:#1A1A1A;font-weight:500;text-align:right">Costo</td>
          </tr>
          ${agentiHTML}
        </table>
      </td></tr>` : ''}
      <tr><td style="padding:14px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0;text-align:center">
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">Dati da Supabase &middot; visibili all'AD</p>
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
    `${agentRunsData.length} run, €${costoTotale.toFixed(2)} stimati`, report, Date.now() - start);

  if (alerts.length > 0) process.exit(1);
  console.log('Cost Guardian completato. Costo stimato:', costoTotale.toFixed(2));
}

main().catch(async e => {
  console.error('ERRORE Cost Guardian:', e.message);
  await logRun('cost-guardian', 'error', e.message).catch(() => {});
  process.exit(1);
});
