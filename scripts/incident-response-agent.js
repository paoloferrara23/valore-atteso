// scripts/incident-response-agent.js — v2 con nuovo template email
const { memSet, logRun, supaFetch } = require('./memory');
const { agentEmail } = require('./email-template');

const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SITE_URL       = process.env.SITE_URL || 'https://valoreatteso.com';
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  console.log('Incident Response Agent v2 avviato:', new Date().toISOString());

  const incidents = [];
  const warnings  = [];

  const ieri = new Date(Date.now() - 86400000).toISOString();

  // ── CHECK 1: Agent runs falliti 24h ──────────────────────────────────────
  try {
    const runs = await supaFetch(`/rest/v1/agent_runs?status=eq.error&created_at=gte.${ieri}&select=agent,summary,created_at&order=created_at.desc`);
    const failed = Array.isArray(runs) ? runs : [];
    failed.forEach(r => incidents.push({
      tipo: 'AGENT_FAILURE', gravita: 'alta',
      msg: `Agente "${r.agent}" fallito`,
      detail: r.summary?.slice(0, 120) || 'Nessun dettaglio',
      when: new Date(r.created_at).toLocaleString('it-IT')
    }));
    console.log(`Run falliti 24h: ${failed.length}`);
  } catch(e) { warnings.push({ tipo: 'SUPABASE_ERROR', msg: 'Impossibile leggere agent_runs: ' + e.message }); }

  // ── CHECK 2: Warning agenti 24h ───────────────────────────────────────────
  try {
    const warns = await supaFetch(`/rest/v1/agent_runs?status=eq.warning&created_at=gte.${ieri}&select=agent,summary`);
    const wa = Array.isArray(warns) ? warns : [];
    wa.forEach(r => warnings.push({ tipo: 'AGENT_WARNING', msg: `"${r.agent}" in warning`, detail: r.summary?.slice(0,80) }));
  } catch(e) { console.warn('Check warning fallito:', e.message); }

  // ── CHECK 3: API subscribe raggiungibile ──────────────────────────────────
  try {
    const apiTest = await fetch(`${SITE_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test-monitor@valoreatteso.com' }),
      signal: AbortSignal.timeout(10000)
    });
    if (apiTest.status >= 500) {
      incidents.push({ tipo: 'API_DOWN', gravita: 'critica', msg: `API /subscribe risponde ${apiTest.status}`, detail: 'Iscrizioni non funzionanti', when: oggi });
    } else {
      console.log(`API subscribe OK: ${apiTest.status}`);
    }
  } catch(e) {
    incidents.push({ tipo: 'API_UNREACHABLE', gravita: 'critica', msg: 'API /subscribe non raggiungibile', detail: e.message, when: oggi });
  }

  // ── CHECK 4: Tasso conferma iscritti ─────────────────────────────────────
  try {
    const subs = await supaFetch('/rest/v1/subscribers?select=confirmed,created_at');
    const arr = Array.isArray(subs) ? subs : [];
    const totale = arr.length;
    const confermati = arr.filter(s => s.confirmed).length;
    const tasso = totale > 0 ? (confermati / totale * 100).toFixed(1) : 100;
    if (totale > 5 && parseFloat(tasso) < 30) {
      incidents.push({ tipo: 'LOW_CONFIRMATION', gravita: 'media', msg: `Tasso conferma: ${tasso}% (${confermati}/${totale})`, detail: 'Email conferma potrebbe finire in spam', when: oggi });
    }
    console.log(`Iscritti: ${totale} totali, ${confermati} confermati (${tasso}%)`);
  } catch(e) { warnings.push({ tipo: 'SUBSCRIBERS_ERROR', msg: 'Impossibile leggere iscritti: ' + e.message }); }

  // ── CHECK 5: Memoria agenti aggiornata ────────────────────────────────────
  try {
    const mem = await supaFetch('/rest/v1/agent_memory?select=key,updated_at&order=updated_at.desc&limit=1');
    const last = Array.isArray(mem) && mem[0] ? new Date(mem[0].updated_at) : null;
    if (last) {
      const giorni = (Date.now() - last.getTime()) / 86400000;
      if (giorni > 8) warnings.push({ tipo: 'MEMORY_STALE', msg: `Nessuna scrittura agent_memory da ${Math.floor(giorni)} giorni`, detail: 'Gli agenti potrebbero non comunicare' });
    }
  } catch(e) { console.warn('Check memory fallito:', e.message); }

  // ── CHECK 6: Agenti non girati questa settimana ───────────────────────────
  try {
    const settimanaFa = new Date(Date.now() - 7 * 86400000).toISOString();
    const runsSettimana = await supaFetch(`/rest/v1/agent_runs?created_at=gte.${settimanaFa}&select=agent&order=created_at.desc`);
    const agentiGirati = new Set((Array.isArray(runsSettimana) ? runsSettimana : []).map(r => r.agent));
    const agentiAttesi = ['scout', 'seo', 'editoriale', 'growth', 'content-agent', 'deliverability', 'security'];
    const agentiSilenti = agentiAttesi.filter(a => !agentiGirati.has(a));
    if (agentiSilenti.length > 0) {
      warnings.push({ tipo: 'AGENTS_SILENT', msg: `Agenti non eseguiti questa settimana: ${agentiSilenti.join(', ')}`, detail: 'Verificare schedule e logs GitHub Actions' });
    }
    console.log(`Agenti attivi: ${agentiGirati.size}/${agentiAttesi.length}`);
  } catch(e) { console.warn('Check agenti silenti fallito:', e.message); }

  // ── Salva report ──────────────────────────────────────────────────────────
  const report = { data: oggi, incidents: incidents.length, warnings: warnings.length, dettaglio_incidents: incidents, dettaglio_warnings: warnings };
  await memSet('incident_report', report, 'incident-response');

  // Manda email solo se ci sono problemi o lunedì
  const haProblemi = incidents.length > 0 || warnings.length > 0;
  const isLunedi   = new Date().getDay() === 1;
  if (!haProblemi && !isLunedi) {
    await logRun('incident-response', 'success', 'Tutto OK — nessun problema.', report, Date.now()-start);
    console.log('Incident Response: tutto OK, email non inviata.');
    return;
  }

  const status = incidents.length > 0 ? 'warning' : 'success';

  // Righe incidents
  const incRows = incidents.map(i => [
    { value: i.tipo.replace(/_/g,' '), mono: true, bold: true, color: '#C8251D' },
    { value: i.gravita.toUpperCase(), mono: true, color: '#C8251D', align: 'center' },
    { value: i.msg },
    { value: i.when || '', mono: true, color: '#9A9690' },
  ]);

  // Righe warnings
  const warnRows = warnings.map(w => [
    { value: w.tipo.replace(/_/g,' '), mono: true, bold: true, color: '#8E6B33' },
    { value: w.msg },
    { value: w.detail || '', color: '#9A9690' },
  ]);

  const html = agentEmail({
    agentName: 'Incident Response',
    agentKey: 'incident-response',
    status,
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      { type: 'narrative', label: `${incidents.length} incident · ${warnings.length} warning`, text: incidents.length > 0 ? 'Problemi rilevati che richiedono attenzione immediata.' : warnings.length > 0 ? 'Anomalie minori — nessuna azione urgente.' : 'Sistema operativo — report settimanale.', dark: true },
      ...(incRows.length > 0 ? [{ type: 'table', label: 'Incidents', headers: [{ label: 'Tipo' }, { label: 'Gravità', align: 'center' }, { label: 'Messaggio' }, { label: 'Quando' }], rows: incRows }] : []),
      ...(warnRows.length > 0 ? [{ type: 'table', label: 'Warning', headers: [{ label: 'Tipo' }, { label: 'Messaggio' }, { label: 'Dettaglio' }], rows: warnRows }] : []),
      ...(!haProblemi ? [{ type: 'alert', text: 'Tutto OK — nessun problema rilevato questa settimana.', type: 'success' }] : []),
    ]
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `${incidents.length > 0 ? '🔴' : warnings.length > 0 ? '🟡' : '✓'} Incident Response VA · ${incidents.length} incidents · ${oggi}`, html })
  });

  await logRun('incident-response', status, `${incidents.length} incidents, ${warnings.length} warnings`, report, Date.now()-start);
  console.log(`Incident Response completato. ${incidents.length} incidents, ${warnings.length} warnings.`);
}

main().catch(async e => {
  console.error('ERRORE Incident Response:', e.message);
  await logRun('incident-response', 'error', e.message).catch(() => {});
  process.exit(1);
});
