// security-agent.js — Monitora anomalie sicurezza e spam
// Gira: ogni giorno alle 10:00 | Scrive: security_report

const { memSet, logRun, supaFetch } = require('./memory');

const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

function isEmailSuspect(email) {
  const suspectPatterns = [
    /^\d+@/,                          // inizia con numeri
    /[+]{2,}/,                        // doppio +
    /@(mailinator|guerrilla|yopmail|tempmail|throwam|sharklasers|trashmail)/i,
    /test\d{3,}@/i,                   // test123@
    /(.)\1{4,}/,                      // caratteri ripetuti tipo aaaaaa
  ];
  return suspectPatterns.some(p => p.test(email));
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT');
  console.log('Security Agent avviato:', new Date().toISOString());

  const alerts = [];
  const info = [];

  // 1. Iscrizioni anomale nell'ultima ora (possibile bot/flood)
  const unOraFa = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const recenti = await supaFetch(
      `/rest/v1/subscribers?created_at=gte.${unOraFa}&select=email,created_at,confirmed`
    );
    const nuovi = Array.isArray(recenti) ? recenti : [];

    if (nuovi.length > 20) {
      alerts.push({
        tipo: 'BOT_FLOOD',
        gravita: 'critica',
        messaggio: `${nuovi.length} iscrizioni nell'ultima ora — possibile attacco bot`,
        dettaglio: 'Verifica manuale raccomandata'
      });
    } else if (nuovi.length > 10) {
      alerts.push({
        tipo: 'HIGH_SIGNUP_RATE',
        gravita: 'media',
        messaggio: `${nuovi.length} iscrizioni nell'ultima ora — monitorare`,
        dettaglio: 'Potrebbe essere traffico legittimo da condivisione virale'
      });
    }

    // 2. Email sospette tra le ultime iscrizioni
    const emailSospette = nuovi.filter(s => isEmailSuspect(s.email));
    if (emailSospette.length > 0) {
      alerts.push({
        tipo: 'SUSPECT_EMAILS',
        gravita: 'media',
        messaggio: `${emailSospette.length} email sospette rilevate`,
        dettaglio: emailSospette.map(s => s.email).join(', ')
      });
    }

    info.push(`Iscrizioni ultima ora: ${nuovi.length}`);
  } catch(e) {
    console.error('Errore check iscrizioni:', e.message);
  }

  // 3. Controlla iscrizioni delle ultime 24h
  const ieri = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const ieri24h = await supaFetch(
      `/rest/v1/subscribers?created_at=gte.${ieri}&select=email,confirmed`
    );
    const nuovi24h = Array.isArray(ieri24h) ? ieri24h : [];
    const sospette24h = nuovi24h.filter(s => isEmailSuspect(s.email));

    info.push(`Iscrizioni 24h: ${nuovi24h.length} (${sospette24h.length} sospette)`);

    if (sospette24h.length > 5) {
      alerts.push({
        tipo: 'SPAM_CAMPAIGN',
        gravita: 'alta',
        messaggio: `${sospette24h.length} email sospette nelle ultime 24h`,
        dettaglio: 'Possibile campagna spam in corso'
      });
    }
  } catch(e) {
    console.error('Errore check 24h:', e.message);
  }

  // 4. Controlla disiscrizioni anomale (purge improvvisa)
  try {
    const tutti = await supaFetch('/rest/v1/subscribers?select=confirmed');
    const totale = Array.isArray(tutti) ? tutti.length : 0;
    const prevReport = await supaFetch('/rest/v1/agent_memory?key=eq.security_report&select=value').catch(() => []);
    const prev = Array.isArray(prevReport) && prevReport[0] ? prevReport[0].value : null;

    if (prev && prev.totale_iscritti) {
      const calo = prev.totale_iscritti - totale;
      if (calo > 10) {
        alerts.push({
          tipo: 'MASS_UNSUBSCRIBE',
          gravita: 'alta',
          messaggio: `${calo} disiscrizioni dall'ultimo controllo`,
          dettaglio: `Da ${prev.totale_iscritti} a ${totale} iscritti`
        });
      }
    }
    info.push(`Totale iscritti: ${totale}`);

    const report = {
      data: oggi,
      alerts: alerts.length,
      totale_iscritti: totale,
      dettaglio_alerts: alerts,
      info
    };

    await memSet('security_report', report, 'security');

    const statusLabel = alerts.length > 0
      ? (alerts.some(a => a.gravita === 'critica') ? 'CRITICAL' : 'WARNING')
      : 'OK';
    const statusColor = statusLabel === 'CRITICAL' ? '#C8251D' : statusLabel === 'WARNING' ? '#D4A017' : '#1B4332';
    const statusBg = statusLabel === 'CRITICAL' ? '#FEF2F2' : statusLabel === 'WARNING' ? '#FAEEDA' : '#E4EDE7';

    const alertsHTML = alerts.map((a, i) => `
      <tr style="background:${i%2===0?'#FEF2F2':'#FDE8E8'}">
        <td style="padding:8px 20px;font-family:'Courier New',monospace;font-size:9px;color:#C8251D;font-weight:700;text-transform:uppercase;width:30%">${a.tipo}</td>
        <td style="padding:8px 20px;font-family:Georgia,serif;font-size:13px;color:#1A1A1A">${a.messaggio}</td>
      </tr>
      ${a.dettaglio ? `<tr><td colspan="2" style="padding:0 20px 10px;font-family:'Courier New',monospace;font-size:9px;color:#9A9690;background:#FEF2F2">${a.dettaglio}</td></tr>` : ''}`
    ).join('');

    const html = `
      <table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
        <tr><td style="padding:24px 28px;background:#1A1A1A">
          <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin:0;letter-spacing:-1px">Valore Atteso</h1>
          <p style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Security Agent &middot; ${oggi}</p>
        </td></tr>

        <tr><td style="padding:14px 28px;background:${statusBg};border-bottom:2px solid ${statusColor}">
          <p style="font-family:'Courier New',monospace;font-size:11px;color:${statusColor};letter-spacing:.1em;text-transform:uppercase;margin:0;font-weight:700">
            ${statusLabel} &mdash; ${alerts.length} alert${alerts.length!==1?'s':''}
          </p>
        </td></tr>

        ${alerts.length > 0 ? `
        <tr><td style="padding:16px 28px 0">
          <table width="100%" style="border-collapse:collapse">
            <tr style="background:#1A1A1A">
              <td style="padding:6px 20px;font-family:'Courier New',monospace;font-size:9px;color:#fff">Tipo</td>
              <td style="padding:6px 20px;font-family:'Courier New',monospace;font-size:9px;color:#fff">Dettaglio</td>
            </tr>
            ${alertsHTML}
          </table>
        </td></tr>` : ''}

        <tr><td style="padding:16px 28px">
          <p style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px">Riepilogo sistema</p>
          ${info.map(i => `<p style="font-family:'Courier New',monospace;font-size:10px;color:#4A4845;margin:4px 0">→ ${i}</p>`).join('')}
        </td></tr>

        <tr><td style="padding:14px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0;text-align:center">
          <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">Security Agent &middot; Dati da Supabase</p>
        </td></tr>
      </table>`;

    // Manda sempre se ci sono alert, ogni lunedì se tutto OK
    const isLunedi = new Date().getDay() === 1;
    if (alerts.length > 0 || isLunedi) {
      await httpRequest('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: FROM,
          to: APPROVAL_EMAIL,
          subject: `${statusLabel} Security VA · ${alerts.length} alerts · ${oggi}`,
          html
        })
      });
    }

    await logRun('security', alerts.length > 0 ? 'warning' : 'success',
      `${alerts.length} alerts. ${info.join(', ')}`, report, Date.now() - start);

    console.log(`Security Agent completato. ${alerts.length} alerts.`);
  } catch(e) {
    console.error('Errore finale security:', e.message);
    throw e;
  }
}

main().catch(async e => {
  console.error('ERRORE Security Agent:', e.message);
  await logRun('security', 'error', e.message).catch(() => {});
  process.exit(1);
});
