// scripts/security-agent.js — Security Agent v2
// Gira: ogni giorno 09:00 UTC (10:00 IT)
// Manda email SOLO se ci sono alert — silenzioso se tutto ok

const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function supabase(path) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${path}`);
  return r.json();
}

// ── Pattern email sospette ────────────────────────────────────────────────────
function isEmailSuspect(email) {
  if (!email) return false;
  const patterns = [
    /^[0-9]+@/,                                    // solo numeri prima di @
    /@(mailinator|guerrilla|yopmail|tempmail|throwam|sharklasers|trashmail|10minute|fakeinbox|maildrop|dispostable|spamgourmet|mailnull|spamex|trashmail|getairmail|filzmail|jetable|nwldx|sogetthis|trbvm|uggsrock|vomoto|walala|wetrainbayarea|willselfdestruct|wuzupmail|yahoob|ymail|zoemail|zomg)/i,
    /test[0-9]{3,}@/i,                             // test123@
    /[a-z]{1}[0-9]{8,}@/i,                         // a12345678@
    /(.)\\1{4,}/,                                   // caratteri ripetuti aaaaaa
    /^[a-z]{1,2}[0-9]{6,}@/i,                      // ab123456@
    /@(.*\\.)*([a-z]{1,3})\\.([a-z]{2})\\.([a-z]{2})$/i, // domini troppo annidati
  ];
  return patterns.some(p => p.test(email));
}

// ── Livelli di gravità ────────────────────────────────────────────────────────
const GRAVITA = { critica: 0, alta: 1, media: 2, bassa: 3 };

function addAlert(alerts, tipo, gravita, messaggio, dettaglio = null) {
  alerts.push({ tipo, gravita, messaggio, dettaglio });
  console.log(`[${gravita.toUpperCase()}] ${tipo}: ${messaggio}`);
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  console.log('Security Agent v2 avviato:', new Date().toISOString());

  const alerts = [];
  const info   = [];

  // ── CHECK 1: Iscrizioni anomale ultima ora ────────────────────────────────
  try {
    const unOraFa = new Date(Date.now() - 3600000).toISOString();
    const recenti = await supabase(`/rest/v1/subscribers?created_at=gte.${unOraFa}&select=email,created_at,confirmed`);
    const nuovi = Array.isArray(recenti) ? recenti : [];

    if (nuovi.length > 50) addAlert(alerts, 'BOT_FLOOD', 'critica', `${nuovi.length} iscrizioni nell\'ultima ora — attacco bot in corso`, 'Azione immediata: verifica IP e blocca se necessario');
    else if (nuovi.length > 20) addAlert(alerts, 'HIGH_SIGNUP_RATE', 'alta', `${nuovi.length} iscrizioni nell\'ultima ora`, 'Potrebbe essere bot o campagna virale — monitorare');
    else if (nuovi.length > 10) addAlert(alerts, 'SIGNUP_SPIKE', 'media', `${nuovi.length} iscrizioni nell\'ultima ora`, 'Spike insolito — probabilmente legittimo');

    const sospette = nuovi.filter(s => isEmailSuspect(s.email));
    if (sospette.length > 3) addAlert(alerts, 'SUSPECT_EMAILS', 'alta', `${sospette.length} email sospette nell\'ultima ora`, sospette.map(s => s.email).slice(0, 5).join(', '));
    else if (sospette.length > 0) addAlert(alerts, 'SUSPECT_EMAILS', 'media', `${sospette.length} email sospette rilevate`, sospette.map(s => s.email).join(', '));

    info.push(`Iscrizioni ultima ora: ${nuovi.length} (${sospette.length} sospette)`);
  } catch(e) { console.error('CHECK 1 fallito:', e.message); }

  // ── CHECK 2: Iscrizioni ultime 24h ───────────────────────────────────────
  try {
    const ieri = new Date(Date.now() - 86400000).toISOString();
    const nuovi24h = await supabase(`/rest/v1/subscribers?created_at=gte.${ieri}&select=email,confirmed`);
    const n24 = Array.isArray(nuovi24h) ? nuovi24h : [];
    const sospette24h = n24.filter(s => isEmailSuspect(s.email));
    const nonConfermati = n24.filter(s => !s.confirmed);
    const tassoConf = n24.length > 0 ? ((n24.length - nonConfermati.length) / n24.length * 100).toFixed(0) : 'N/D';

    if (sospette24h.length > 10) addAlert(alerts, 'SPAM_CAMPAIGN_24H', 'alta', `${sospette24h.length} email sospette nelle ultime 24h`, 'Possibile campagna spam in corso');
    if (parseFloat(tassoConf) < 30 && n24.length > 5) addAlert(alerts, 'LOW_CONFIRMATION_RATE', 'media', `Tasso conferma basso: ${tassoConf}% (${n24.length - nonConfermati.length}/${n24.length})`, 'Email di conferma potrebbe finire in spam, oppure bot');

    info.push(`Iscrizioni 24h: ${n24.length} | Tasso conferma: ${tassoConf}% | Sospette: ${sospette24h.length}`);
  } catch(e) { console.error('CHECK 2 fallito:', e.message); }

  // ── CHECK 3: Disiscrizioni anomale ───────────────────────────────────────
  try {
    const tutti = await supabase('/rest/v1/subscribers?select=confirmed,created_at');
    const totale = Array.isArray(tutti) ? tutti.length : 0;
    const confermati = Array.isArray(tutti) ? tutti.filter(s => s.confirmed).length : 0;

    const prevRow = await supabase('/rest/v1/agent_memory?key=eq.security_report&select=value').catch(() => []);
    const prev = Array.isArray(prevRow) && prevRow[0] ? prevRow[0].value : null;

    if (prev?.totale_iscritti) {
      const calo = prev.totale_iscritti - totale;
      const caloConf = (prev.confermati || 0) - confermati;
      if (caloConf > 15) addAlert(alerts, 'MASS_UNSUBSCRIBE', 'critica', `${caloConf} disiscrizioni dall\'ultimo controllo`, `Da ${prev.confermati} a ${confermati} confermati`);
      else if (caloConf > 5) addAlert(alerts, 'HIGH_UNSUBSCRIBE', 'alta', `${caloConf} disiscrizioni insolite`, `Da ${prev.confermati} a ${confermati} confermati`);
    }

    info.push(`Totale iscritti: ${totale} | Confermati: ${confermati}`);

    // Salva per confronto futuro
    await memSet('security_report', {
      data: new Date().toISOString(),
      totale_iscritti: totale,
      confermati,
      alerts: alerts.length,
      dettaglio_alerts: alerts,
      info
    }, 'security');
  } catch(e) { console.error('CHECK 3 fallito:', e.message); }

  // ── CHECK 4: Rate limit table — IP che hanno tentato molte volte ──────────
  try {
    const un_ora_fa = new Date(Date.now() - 3600000).toISOString();
    const rateLimits = await supabase(`/rest/v1/rate_limits?created_at=gte.${un_ora_fa}&select=ip,count,action&order=count.desc&limit=10`);
    const limits = Array.isArray(rateLimits) ? rateLimits : [];
    const bloccati = limits.filter(l => l.count >= 3);

    if (bloccati.length > 5) addAlert(alerts, 'MULTIPLE_IP_BLOCKED', 'alta', `${bloccati.length} IP bloccati dal rate limiter nell\'ultima ora`, bloccati.slice(0,3).map(l => `${l.ip} (${l.count} tentativi)`).join(', '));
    else if (bloccati.length > 0) addAlert(alerts, 'IP_RATE_LIMITED', 'bassa', `${bloccati.length} IP bloccati dal rate limiter`, bloccati.map(l => `${l.ip} (${l.count} tentativi)`).join(', '));

    if (limits.length > 0) info.push(`IP con tentivi multipli: ${limits.length} | Bloccati: ${bloccati.length}`);
  } catch(e) { console.warn('CHECK 4 (rate limits) saltato:', e.message); }

  // ── CHECK 5: Accessi falliti Control Room (da agent_runs) ─────────────────
  try {
    const ieri = new Date(Date.now() - 86400000).toISOString();
    const runs = await supabase(`/rest/v1/agent_runs?created_at=gte.${ieri}&status=eq.error&select=agent,summary,created_at`);
    const errori = Array.isArray(runs) ? runs : [];
    const critici = errori.filter(e => e.summary?.includes('Non autorizzato') || e.summary?.includes('401'));

    if (critici.length > 3) addAlert(alerts, 'UNAUTHORIZED_ACCESS_ATTEMPTS', 'alta', `${critici.length} tentativi non autorizzati sulle API nelle ultime 24h`, 'Qualcuno sta tentando di chiamare le API senza token');
    else if (critici.length > 0) addAlert(alerts, 'UNAUTHORIZED_ATTEMPTS', 'bassa', `${critici.length} tentativo/i non autorizzato/i`, 'Probabilmente test — monitorare');

    if (errori.length > 0) info.push(`Errori agenti 24h: ${errori.length} | Non autorizzati: ${critici.length}`);
  } catch(e) { console.warn('CHECK 5 saltato:', e.message); }

  // ── CHECK 6: Deliverability Resend ───────────────────────────────────────
  try {
    const resendRes = await fetch('https://api.resend.com/emails?limit=20', {
      headers: { 'Authorization': `Bearer ${RESEND_KEY}` }
    });
    if (resendRes.ok) {
      const data = await resendRes.json();
      const emails = (data.data || []).filter(e => !e.to?.some(t => t.includes('valoreatteso.com')));
      const bounced = emails.filter(e => e.last_event === 'bounced').length;
      const spam = emails.filter(e => e.last_event === 'complained').length;

      if (spam > 0) addAlert(alerts, 'SPAM_COMPLAINTS', 'critica', `${spam} segnalazione/i spam su Resend — azione immediata necessaria`, 'Rischio blocco account Resend. Rimuovere indirizzi problematici.');
      if (bounced > emails.length * 0.05 && emails.length > 5) addAlert(alerts, 'HIGH_BOUNCE_RATE', 'alta', `Bounce rate ${((bounced/emails.length)*100).toFixed(1)}% (${bounced}/${emails.length})`, 'Superiore al 5% — pulizia lista raccomandata');

      info.push(`Resend ultime email: ${emails.length} | Bounced: ${bounced} | Spam: ${spam}`);
    }
  } catch(e) { console.warn('CHECK 6 (Resend) saltato:', e.message); }

  // ── Determina status globale ──────────────────────────────────────────────
  const hasCritica = alerts.some(a => a.gravita === 'critica');
  const hasAlta    = alerts.some(a => a.gravita === 'alta');
  const status     = hasCritica ? 'error' : hasAlta ? 'warning' : 'success';

  await logRun('security', status,
    alerts.length > 0 ? `${alerts.length} alerts: ${alerts.map(a=>a.tipo).join(', ')}` : 'Nessuna anomalia rilevata',
    { alerts: alerts.length, info }, Date.now()-start
  );

  // ── Manda email SOLO se ci sono alert ────────────────────────────────────
  if (alerts.length === 0) {
    console.log('Security Agent completato — nessuna anomalia. Email non inviata.');
    return;
  }

  // Ordina per gravità
  alerts.sort((a, b) => GRAVITA[a.gravita] - GRAVITA[b.gravita]);

  const alertRows = alerts.map(a => {
    const cfg = {
      critica: { bg: '#FEF2F2', border: '#C8251D', color: '#C8251D' },
      alta:    { bg: '#FEF9EC', border: '#D4A017', color: '#8E6B33' },
      media:   { bg: '#EFF6FF', border: '#1B3A6B', color: '#1B3A6B' },
      bassa:   { bg: '#F0FDF4', border: '#1B4332', color: '#1B4332' },
    }[a.gravita] || { bg: '#F5F2EB', border: '#9A9690', color: '#9A9690' };

    return [
      { value: a.tipo.replace(/_/g,' '), mono: true, bold: true, color: cfg.color },
      { value: a.gravita.toUpperCase(), mono: true, color: cfg.color, align: 'center' },
      { value: a.messaggio, mono: false },
    ];
  });

  const html = agentEmail({
    agentName: 'Security Agent',
    agentKey: 'security',
    status,
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      { type: 'narrative', label: `${alerts.length} alert rilevat${alerts.length === 1 ? 'o' : 'i'}`, text: hasCritica ? '⚠ Situazione critica — azione immediata raccomandata.' : hasAlta ? 'Anomalie rilevate che richiedono attenzione.' : 'Anomalie minori — monitorare la situazione.', dark: true },

      { type: 'table', label: 'Alert rilevati', headers: [
        { label: 'Tipo' },
        { label: 'Gravità', align: 'center' },
        { label: 'Descrizione' },
      ], rows: alertRows },

      ...alerts.filter(a => a.dettaglio).map(a => ({
        type: 'alert',
        text: `<strong>${a.tipo.replace(/_/g,' ')}</strong><br>${a.dettaglio}`,
        type: a.gravita === 'critica' ? 'warning' : a.gravita === 'alta' ? 'warning' : 'info'
      })),

      { type: 'table', label: 'Riepilogo sistema', headers: [
        { label: 'Metrica' }, { label: 'Valore' }
      ], rows: info.map(i => {
        const [label, ...rest] = i.split(':');
        return [{ value: label.trim(), mono: false }, { value: rest.join(':').trim(), mono: true, bold: true }];
      })},
    ]
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `${hasCritica ? '🔴 CRITICO' : hasAlta ? '🟡 ALERT' : '🔵 INFO'} Security VA · ${alerts.length} alert · ${new Date().toLocaleDateString('it-IT')}`,
      html
    })
  });

  console.log(`Security Agent completato. ${alerts.length} alerts — email inviata.`);
}

main().catch(async e => {
  console.error('ERRORE Security Agent:', e.message);
  await logRun('security', 'error', e.message).catch(() => {});
  process.exit(1);
});
