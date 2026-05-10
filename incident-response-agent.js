// incident-response-agent.js — Monitora errori e anomalie sistema
// Gira: ogni giorno alle 9:00 | Scrive: incident_report

const { memSet, logRun, supaFetch } = require('./memory');

const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SITE_URL = process.env.SITE_URL || 'https://valoreatteso.com';
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT');
  console.log('Incident Response Agent avviato:', new Date().toISOString());

  const incidents = [];
  const warnings = [];

  // 1. Controlla workflow GitHub falliti nelle ultime 24h
  const ieri = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const runs = await supaFetch(
      `/rest/v1/agent_runs?status=eq.error&created_at=gte.${ieri}&select=agent,status,summary,created_at&order=created_at.desc`
    );
    const failedRuns = Array.isArray(runs) ? runs : [];
    if (failedRuns.length > 0) {
      failedRuns.forEach(r => {
        incidents.push({
          tipo: 'AGENT_FAILURE',
          gravita: 'alta',
          messaggio: `Agente "${r.agent}" fallito`,
          dettaglio: r.summary || 'Nessun dettaglio',
          quando: new Date(r.created_at).toLocaleString('it-IT')
        });
      });
    }
    console.log(`Run falliti 24h: ${failedRuns.length}`);
  } catch(e) {
    warnings.push({ tipo: 'SUPABASE_ERROR', messaggio: 'Impossibile leggere agent_runs: ' + e.message });
  }

  // 2. Controlla warning negli ultimi run
  try {
    const warnRuns = await supaFetch(
      `/rest/v1/agent_runs?status=eq.warning&created_at=gte.${ieri}&select=agent,status,summary,created_at`
    );
    const warningRuns = Array.isArray(warnRuns) ? warnRuns : [];
    if (warningRuns.length > 0) {
      warningRuns.forEach(r => {
        warnings.push({
          tipo: 'AGENT_WARNING',
          messaggio: `Agente "${r.agent}" in warning`,
          dettaglio: r.summary || ''
        });
      });
    }
  } catch(e) {
    console.error('Errore lettura warning:', e.message);
  }

  // 3. Controlla raggiungibilità API subscribe
  try {
    const apiTest = await fetch(`${SITE_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test-monitor@valoreatteso.com' }),
      signal: AbortSignal.timeout(10000)
    });
    if (apiTest.status >= 500) {
      incidents.push({
        tipo: 'API_DOWN',
        gravita: 'critica',
        messaggio: `API /subscribe risponde con ${apiTest.status}`,
        dettaglio: 'Iscrizioni non funzionanti',
        quando: oggi
      });
    } else {
      console.log(`API subscribe OK: ${apiTest.status}`);
    }
  } catch(e) {
    incidents.push({
      tipo: 'API_UNREACHABLE',
      gravita: 'critica',
      messaggio: 'API /subscribe non raggiungibile',
      dettaglio: e.message,
      quando: oggi
    });
  }

  // 4. Controlla iscritti confermati vs totali — anomalie
  try {
    const tutti = await supaFetch('/rest/v1/subscribers?select=confirmed,created_at');
    const subs = Array.isArray(tutti) ? tutti : [];
    const totale = subs.length;
    const confermati = subs.filter(s => s.confirmed).length;
    const tasso = totale > 0 ? (confermati / totale * 100).toFixed(1) : 100;

    if (totale > 5 && parseFloat(tasso) < 30) {
      incidents.push({
        tipo: 'LOW_CONFIRMATION_RATE',
        gravita: 'media',
        messaggio: `Tasso conferma basso: ${tasso}% (${confermati}/${totale})`,
        dettaglio: 'Possibile problema con email di conferma o spam',
        quando: oggi
      });
    }
    console.log(`Iscritti: ${totale} totali, ${confermati} confermati (${tasso}%)`);
  } catch(e) {
    warnings.push({ tipo: 'SUBSCRIBERS_ERROR', messaggio: 'Impossibile leggere iscritti: ' + e.message });
  }

  // 5. Controlla Supabase agent_memory — ultima scrittura
  try {
    const mem = await supaFetch('/rest/v1/agent_memory?select=key,updated_at&order=updated_at.desc&limit=1');
    const lastWrite = Array.isArray(mem) && mem[0] ? new Date(mem[0].updated_at) : null;
    if (lastWrite) {
      const giorniSilenzio = (Date.now() - lastWrite.getTime()) / (1000 * 60 * 60 * 24);
      if (giorniSilenzio > 8) {
        warnings.push({
          tipo: 'MEMORY_STALE',
          messaggio: `Nessuna scrittura su agent_memory da ${Math.floor(giorniSilenzio)} giorni`,
          dettaglio: 'Gli agenti potrebbero non comunicare correttamente'
        });
      }
    }
  } catch(e) {
    console.error('Errore check memory:', e.message);
  }

  const report = {
    data: oggi,
    incidents: incidents.length,
    warnings: warnings.length,
    dettaglio_incidents: incidents,
    dettaglio_warnings: warnings
  };

  await memSet('incident_report', report, 'incident-response');

  // Manda email solo se ci sono incidents o warning
  const haProblemi = incidents.length > 0 || warnings.length > 0;
  const statusLabel = incidents.length > 0 ? 'INCIDENT' : warnings.length > 0 ? 'WARNING' : 'OK';
  const statusColor = incidents.length > 0 ? '#C8251D' : warnings.length > 0 ? '#D4A017' : '#1B4332';
  const statusBg = incidents.length > 0 ? '#FEF2F2' : warnings.length > 0 ? '#FAEEDA' : '#E4EDE7';

  const incidentsHTML = incidents.map((inc, i) => `
    <tr style="background:${i%2===0?'#FEF2F2':'#FDE8E8'}">
      <td style="padding:8px 20px;font-family:'Courier New',monospace;font-size:9px;color:#C8251D;font-weight:700;text-transform:uppercase">${inc.tipo}</td>
      <td style="padding:8px 20px;font-family:Georgia,serif;font-size:13px;color:#1A1A1A">${inc.messaggio}</td>
      <td style="padding:8px 20px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690">${inc.quando || ''}</td>
    </tr>
    ${inc.dettaglio ? `<tr style="background:#FEF2F2"><td colspan="3" style="padding:4px 20px 10px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690">${inc.dettaglio}</td></tr>` : ''}`
  ).join('');

  const warningsHTML = warnings.map((w, i) => `
    <tr style="background:${i%2===0?'#FAEEDA':'#F5E6C8'}">
      <td style="padding:8px 20px;font-family:'Courier New',monospace;font-size:9px;color:#854F0B;font-weight:700;text-transform:uppercase">${w.tipo}</td>
      <td colspan="2" style="padding:8px 20px;font-family:Georgia,serif;font-size:13px;color:#1A1A1A">${w.messaggio}</td>
    </tr>`
  ).join('');

  const html = `
    <table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
      <tr><td style="padding:24px 28px;background:#1A1A1A">
        <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin:0;letter-spacing:-1px">Valore Atteso</h1>
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Incident Response &middot; ${oggi}</p>
      </td></tr>

      <tr><td style="padding:16px 28px;background:${statusBg};border-bottom:2px solid ${statusColor}">
        <p style="font-family:'Courier New',monospace;font-size:11px;color:${statusColor};letter-spacing:.1em;text-transform:uppercase;margin:0;font-weight:700">
          ${statusLabel} &mdash; ${incidents.length} incident${incidents.length!==1?'s':''}, ${warnings.length} warning${warnings.length!==1?'s':''}
        </p>
      </td></tr>

      ${incidents.length > 0 ? `
      <tr><td style="padding:16px 28px 0">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;font-weight:700">Incidents critici</p>
        <table width="100%" style="border-collapse:collapse">
          <tr style="background:#1A1A1A">
            <td style="padding:6px 20px;font-family:'Courier New',monospace;font-size:9px;color:#fff">Tipo</td>
            <td style="padding:6px 20px;font-family:'Courier New',monospace;font-size:9px;color:#fff">Messaggio</td>
            <td style="padding:6px 20px;font-family:'Courier New',monospace;font-size:9px;color:#fff">Quando</td>
          </tr>
          ${incidentsHTML}
        </table>
      </td></tr>` : ''}

      ${warnings.length > 0 ? `
      <tr><td style="padding:16px 28px 0">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#854F0B;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;font-weight:700">Warning</p>
        <table width="100%" style="border-collapse:collapse">
          ${warningsHTML}
        </table>
      </td></tr>` : ''}

      ${!haProblemi ? `
      <tr><td style="padding:24px 28px;text-align:center">
        <p style="font-family:Georgia,serif;font-size:15px;color:#1B4332;margin:0">Tutto OK &mdash; nessun problema rilevato.</p>
      </td></tr>` : ''}

      <tr><td style="padding:14px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0;text-align:center">
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">Incident Response Agent &middot; Dati da Supabase</p>
      </td></tr>
    </table>`;

  // Manda sempre se ci sono problemi, ogni lunedì se tutto OK
  const oggi_data = new Date();
  const isLunedi = oggi_data.getDay() === 1;

  if (haProblemi || isLunedi) {
    await httpRequest('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: FROM,
        to: APPROVAL_EMAIL,
        subject: `${statusLabel} Incident Response VA · ${incidents.length} incidents · ${oggi}`,
        html
      })
    });
  }

  await logRun('incident-response', incidents.length > 0 ? 'warning' : 'success',
    `${incidents.length} incidents, ${warnings.length} warnings`, report, Date.now() - start);

  console.log(`Incident Response completato. ${incidents.length} incidents, ${warnings.length} warnings.`);
}

main().catch(async e => {
  console.error('ERRORE Incident Response:', e.message);
  await logRun('incident-response', 'error', e.message).catch(() => {});
  process.exit(1);
});
