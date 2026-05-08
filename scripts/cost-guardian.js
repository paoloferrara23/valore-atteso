// cost-guardian.js — Monitora costi reali da Supabase + reminder balance manuale
// Gira: venerdì 9:00 | Scrive: cost_report

const { memSet, logRun, supaFetch } = require('./memory');

const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SOGLIA_ANTHROPIC = parseFloat(process.env.SOGLIA_ANTHROPIC || '10');
const SOGLIA_RESEND = parseFloat(process.env.SOGLIA_RESEND || '10');
const FROM = 'Valore Atteso <info@valoreatteso.com>';
const CONSOLE_URL = 'https://console.anthropic.com/settings/billing';

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
      `/rest/v1/agent_runs?created_at=gte.${inizioMese.toISOString()}&select=agent,status,created_at&order=created_at.desc`
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

  // Iscritti e edizioni
  let numIscritti = 0;
  let numEdizioni = 0;
  let emailInviate = 0;

  try {
    const subs = await supaFetch('/rest/v1/subscribers?confirmed=eq.true&select=email');
    numIscritti = Array.isArray(subs) ? subs.length : 0;
    const edizioni = await supaFetch(
      `/rest/v1/editions?published=eq.true&created_at=gte.${inizioMese.toISOString()}&select=num`
    );
    numEdizioni = Array.isArray(edizioni) ? edizioni.length : 0;
    emailInviate = numIscritti * numEdizioni;
  } catch(e) {
    console.error('Errore calcolo dati:', e.message);
  }

  // Costo Resend (gratis fino a 3000/mese)
  const costoResend = emailInviate > 3000 ? (emailInviate - 3000) * 0.0001 : 0;

  const report = {
    mese: oggi,
    run_totali: agentRunsData.length,
    run_per_agente: runPerAgente,
    iscritti: numIscritti,
    email_inviate: emailInviate,
    edizioni_mese: numEdizioni,
    resend_stimato: costoResend,
  };

  await memSet('cost_report', report, 'cost-guardian');

  // Dettaglio agenti
  const dettaglioAgenti = Object.entries(runPerAgente);

  const agentiHTML = dettaglioAgenti.length > 0
    ? dettaglioAgenti.map(([agente, runs], i) => `
      <tr style="background:${i%2===0?'#EDE9E0':'#E6E1D8'}">
        <td style="padding:7px 24px;font-family:'Courier New',monospace;font-size:10px;color:#4A4845">${agente}</td>
        <td style="padding:7px 24px;font-family:'Courier New',monospace;font-size:10px;text-align:right;color:#1A1A1A;font-weight:700">${runs}</td>
      </tr>`).join('')
    : `<tr><td colspan="2" style="padding:12px 24px;font-family:'Courier New',monospace;font-size:10px;color:#9A9690;text-align:center">Nessun run registrato questo mese</td></tr>`;

  const html = `
    <table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
      <tr><td style="padding:24px 28px;background:#1A1A1A">
        <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin:0;letter-spacing:-1px">Valore Atteso</h1>
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Cost Guardian &middot; ${oggi}</p>
      </td></tr>

      <!-- REMINDER BALANCE ANTHROPIC -->
      <tr><td style="padding:16px 28px;background:#FAEEDA;border-bottom:2px solid #D4A017;border-top:1px solid #D0CBC0">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#854F0B;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;font-weight:700">&#9888; Verifica manuale richiesta</p>
        <p style="font-family:Georgia,serif;font-size:13px;color:#633806;font-weight:300;line-height:1.7;margin:0 0 10px">I costi Anthropic non sono recuperabili via API. Controlla il balance aggiornato direttamente nella console:</p>
        <a href="${CONSOLE_URL}" style="background:#1A1A1A;color:#fff;padding:8px 16px;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;display:inline-block">Apri Console Anthropic →</a>
      </td></tr>

      <!-- DATI SISTEMA -->
      <tr><td style="padding:16px 28px">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px">Stato sistema questo mese</p>
        <table width="100%" style="border-collapse:collapse;font-family:'Courier New',monospace;font-size:11px">
          <tr style="background:#D0CBC0">
            <td colspan="2" style="padding:7px 24px;font-size:9px;color:#1A1A1A;letter-spacing:.08em;text-transform:uppercase;font-weight:500">Metriche operative</td>
          </tr>
          <tr style="background:#EDE9E0">
            <td style="padding:7px 24px;color:#4A4845">Run agenti questo mese</td>
            <td style="padding:7px 24px;text-align:right;color:#1A1A1A;font-weight:700">${agentRunsData.length}</td>
          </tr>
          <tr style="background:#E6E1D8">
            <td style="padding:7px 24px;color:#4A4845">Iscritti confermati</td>
            <td style="padding:7px 24px;text-align:right;color:#1A1A1A;font-weight:700">${numIscritti}</td>
          </tr>
          <tr style="background:#EDE9E0">
            <td style="padding:7px 24px;color:#4A4845">Edizioni pubblicate questo mese</td>
            <td style="padding:7px 24px;text-align:right;color:#1A1A1A;font-weight:700">${numEdizioni}</td>
          </tr>
          <tr style="background:#E6E1D8">
            <td style="padding:7px 24px;color:#4A4845">Email inviate (stima)</td>
            <td style="padding:7px 24px;text-align:right;color:#1A1A1A;font-weight:700">${emailInviate}</td>
          </tr>
          <tr style="background:#EDE9E0">
            <td style="padding:7px 24px;color:#4A4845">Resend (stimato)</td>
            <td style="padding:7px 24px;text-align:right;color:${costoResend > 0 ? '#C8251D' : '#1B4332'};font-weight:700">€${costoResend.toFixed(2)} ${emailInviate <= 3000 ? '✓ nel piano gratuito' : ''}</td>
          </tr>
        </table>
      </td></tr>

      <!-- DETTAGLIO RUN PER AGENTE -->
      ${dettaglioAgenti.length > 0 ? `
      <tr><td style="padding:0 28px 20px">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px">Run per agente</p>
        <table width="100%" style="border-collapse:collapse">
          <tr style="background:#D0CBC0">
            <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:9px;color:#1A1A1A;font-weight:500">Agente</td>
            <td style="padding:6px 24px;font-family:'Courier New',monospace;font-size:9px;color:#1A1A1A;font-weight:500;text-align:right">Run</td>
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
      subject: `Cost Guardian VA · ${agentRunsData.length} run · ${numIscritti} iscritti · ${oggi}`,
      html
    })
  });

  await logRun('cost-guardian', 'success',
    `${agentRunsData.length} run, ${numIscritti} iscritti, ${numEdizioni} edizioni`, report, Date.now() - start);

  console.log('Cost Guardian completato.');
}

main().catch(async e => {
  console.error('ERRORE Cost Guardian:', e.message);
  await logRun('cost-guardian', 'error', e.message).catch(() => {});
  process.exit(1);
});
