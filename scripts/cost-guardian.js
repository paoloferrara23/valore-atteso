// scripts/cost-guardian.js — Cost Guardian v2
// Gira: venerdì 08:00 IT (7 UTC)
// Monitora costi reali, proietta spesa mensile, manda email SOLO se ci sono alert o è fine mese

const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

// ── Soglie alert ──────────────────────────────────────────────────────────────
const SOGLIE = {
  anthropic_mensile: parseFloat(process.env.SOGLIA_ANTHROPIC || '15'),  // €
  resend_email_mese: 3000,   // oltre = a pagamento
  run_agenti_giorno: 20,     // troppi run = qualcosa non va
};

async function supaFetch(path) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

// ── Stima costo Anthropic da token usati nei run ──────────────────────────────
// Prezzi claude-opus-4-5: $15/1M input, $75/1M output
// Prezzi claude-haiku-4-5: $0.80/1M input, $4/1M output
function stimaCostoRun(agent, durationMs) {
  // Stima approssimativa basata su tipo agente e durata
  const agentiOpus   = ['scout', 'editoriale', 'genera-edizione', 'genera-opzioni'];
  const agentiHaiku  = ['growth', 'seo', 'content-agent', 'security', 'deliverability', 'cost-guardian'];
  const isOpus = agentiOpus.some(a => agent.includes(a));
  const secs = (durationMs || 5000) / 1000;
  // Stima token: ~500 tok/sec per Opus, ~1000 tok/sec per Haiku
  const tokInput  = isOpus ? secs * 300 : secs * 200;
  const tokOutput = isOpus ? secs * 200 : secs * 100;
  const costoUSD = isOpus
    ? (tokInput * 15 + tokOutput * 75) / 1_000_000
    : (tokInput * 0.80 + tokOutput * 4) / 1_000_000;
  return costoUSD * 0.92; // USD → EUR approssimativo
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const oggiShort = new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const isFineMese = new Date().getDate() >= 25;
  console.log('Cost Guardian v2 avviato:', new Date().toISOString());

  const inizioMese = new Date();
  inizioMese.setDate(1); inizioMese.setHours(0,0,0,0);
  const inizioSettimana = new Date(Date.now() - 7 * 86400000);

  const alerts = [];

  // ── 1. Agent runs questo mese ─────────────────────────────────────────────
  const runs = await supaFetch(`/rest/v1/agent_runs?created_at=gte.${inizioMese.toISOString()}&select=agent,status,created_at,data&order=created_at.desc&limit=500`);
  const runsArr = Array.isArray(runs) ? runs : [];

  const runPerAgente = {};
  const errorPerAgente = {};
  let costoAnthropicStimato = 0;

  runsArr.forEach(r => {
    runPerAgente[r.agent] = (runPerAgente[r.agent] || 0) + 1;
    if (r.status === 'error') errorPerAgente[r.agent] = (errorPerAgente[r.agent] || 0) + 1;
    costoAnthropicStimato += stimaCostoRun(r.agent, r.data?.duration_ms);
  });

  // Agenti con errori frequenti
  Object.entries(errorPerAgente).forEach(([agent, count]) => {
    if (count >= 3) alerts.push({ tipo: 'AGENT_ERRORS', gravita: 'alta', msg: `${agent} ha avuto ${count} errori questo mese`, link: null });
  });

  // ── 2. Iscritti e email ───────────────────────────────────────────────────
  const subs = await supaFetch('/rest/v1/subscribers?confirmed=eq.true&select=email,created_at');
  const numIscritti = Array.isArray(subs) ? subs.length : 0;
  const nuoviMese   = Array.isArray(subs) ? subs.filter(s => s.created_at >= inizioMese.toISOString()).length : 0;
  const nuoviSett   = Array.isArray(subs) ? subs.filter(s => s.created_at >= inizioSettimana.toISOString()).length : 0;

  const edizioni = await supaFetch(`/rest/v1/editions?published=eq.true&select=num,sent_count,date&order=num.desc&limit=10`);
  const edizioniArr = Array.isArray(edizioni) ? edizioni : [];
  const edizioniMese = edizioniArr.filter(e => e.date >= inizioMese.toISOString().slice(0,10));
  const emailInviateMese = edizioniMese.reduce((acc, e) => acc + (e.sent_count || numIscritti), 0);

  // Costo Resend reale
  // Piano gratuito: 3.000 email/mese. Pro: $20/mese per 50k email
  const costoResend = emailInviateMese > 3000 ? 18.5 : 0; // €18.5 ≈ $20
  const percResend  = Math.min(100, (emailInviateMese / 3000 * 100)).toFixed(0);

  if (emailInviateMese > 2700) alerts.push({ tipo: 'RESEND_LIMIT', gravita: 'alta', msg: `${emailInviateMese}/${SOGLIE.resend_email_mese} email Resend — vicino al limite gratuito`, link: 'https://resend.com/overview' });

  // ── 3. Proiezione mensile ─────────────────────────────────────────────────
  const giornoPassa = new Date().getDate();
  const giorniMese  = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const proiezioneAnthropicMese = (costoAnthropicStimato / giornoPassa) * giorniMese;

  if (proiezioneAnthropicMese > SOGLIE.anthropic_mensile) {
    alerts.push({ tipo: 'ANTHROPIC_COST', gravita: 'media', msg: `Proiezione costo Anthropic: €${proiezioneAnthropicMese.toFixed(2)} questo mese (soglia: €${SOGLIE.anthropic_mensile})`, link: 'https://console.anthropic.com/settings/billing' });
  }

  // ── 4. Costo totale stimato ───────────────────────────────────────────────
  // Vercel Hobby: €0 (gratuito)
  // Supabase Free: €0
  // Resend: €0 o €18.5
  // Anthropic: stimato
  // Instagram Ads: non monitorabile via API
  const costoTotaleStimato = costoAnthropicStimato + costoResend;
  const costoTotaleMese    = proiezioneAnthropicMese + costoResend;

  // ── 5. Salva report ───────────────────────────────────────────────────────
  const prevReport = await supaFetch('/rest/v1/agent_memory?key=eq.cost_report&select=value').catch(() => []);
  const prev = Array.isArray(prevReport) && prevReport[0] ? prevReport[0].value : null;

  const report = {
    data: new Date().toISOString(),
    mese: oggiShort,
    runs_mese: runsArr.length,
    run_per_agente: runPerAgente,
    error_per_agente: errorPerAgente,
    iscritti: numIscritti,
    nuovi_mese: nuoviMese,
    nuovi_settimana: nuoviSett,
    email_inviate_mese: emailInviateMese,
    costo_anthropic_stimato: parseFloat(costoAnthropicStimato.toFixed(2)),
    costo_resend: costoResend,
    costo_totale_stimato: parseFloat(costoTotaleStimato.toFixed(2)),
    proiezione_mese: parseFloat(costoTotaleMese.toFixed(2)),
    alerts: alerts.length,
  };
  await memSet('cost_report', report, 'cost-guardian');

  // Manda email solo se: ci sono alert, è fine mese, o è la prima settimana del mese
  const primaSettimana = new Date().getDate() <= 7;
  if (alerts.length === 0 && !isFineMese && !primaSettimana) {
    await logRun('cost-guardian', 'success', `Tutto nella norma. Costo stimato: €${costoTotaleStimato.toFixed(2)}`, report, Date.now()-start);
    console.log('Cost Guardian: nessun alert, email non inviata.');
    return;
  }

  // ── 6. Email con nuovo template ───────────────────────────────────────────
  const status = alerts.some(a => a.gravita === 'alta') ? 'warning' : 'success';

  // Tabella run per agente
  const runRows = Object.entries(runPerAgente)
    .sort((a,b) => b[1]-a[1])
    .map(([agent, count]) => {
      const errori = errorPerAgente[agent] || 0;
      return [
        { value: agent, mono: true },
        { value: String(count), mono: true, bold: true, align: 'center', color: '#1A1A1A' },
        { value: errori > 0 ? `${errori} ✗` : '—', mono: true, align: 'center', color: errori > 0 ? '#C8251D' : '#9A9690' },
        { value: `€${stimaCostoRun(agent, 5000).toFixed(3)}×${count}`, mono: true, align: 'right', color: '#9A9690' },
      ];
    });

  const html = agentEmail({
    agentName: 'Cost Guardian',
    agentKey: 'cost-guardian',
    status: alerts.length > 0 ? 'warning' : 'success',
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      // KPI costi
      { type: 'kpi_grid', kpis: [
        {
          label: 'Costo stimato mese',
          value: `€${costoTotaleStimato.toFixed(2)}`,
          color: costoTotaleStimato < 10 ? '#1B4332' : costoTotaleStimato < 20 ? '#8E6B33' : '#C8251D',
          sub: `proiezione: €${costoTotaleMese.toFixed(2)}`,
          subColor: '#9A9690'
        },
        {
          label: 'Anthropic API',
          value: `€${costoAnthropicStimato.toFixed(2)}`,
          color: '#1A1A1A',
          sub: `${runsArr.length} run · stima`,
          subColor: '#9A9690'
        },
        {
          label: 'Resend email',
          value: costoResend > 0 ? `€${costoResend.toFixed(0)}` : 'Gratuito',
          color: costoResend > 0 ? '#C8251D' : '#1B4332',
          sub: `${emailInviateMese}/${SOGLIE.resend_email_mese} email (${percResend}%)`,
          subColor: parseInt(percResend) > 90 ? '#C8251D' : '#9A9690'
        },
        {
          label: 'Vercel + Supabase',
          value: '€0',
          color: '#1B4332',
          sub: 'piani gratuiti',
          subColor: '#9A9690'
        },
      ]},

      // Proiezione dark cards
      { type: 'dark_cards', label: 'Proiezione fine mese', cards: [
        {
          label: 'Costo totale stimato',
          value: `€${costoTotaleMese.toFixed(2)}`,
          valueColor: costoTotaleMese < 15 ? '#4ADE80' : costoTotaleMese < 25 ? '#FCD34D' : '#FCA5A5',
          sub: `${giornoPassa}/${giorniMese} giorni trascorsi`,
          labelColor: '#9A9690'
        },
        {
          label: 'Break-even primo sponsor',
          value: '€200-400/ed.',
          valueColor: '#C8A97A',
          sub: 'a 200 iscritti',
          labelColor: '#C8A97A',
          accent: '200,169,122'
        },
      ]},

      // Crescita iscritti
      { type: 'kpi_grid', kpis: [
        { label: 'Iscritti totali',   value: String(numIscritti), color: '#1A1A1A', sub: 'confermati', subColor: '#9A9690' },
        { label: 'Nuovi questo mese', value: `+${nuoviMese}`,    color: '#1B4332', sub: oggiShort, subColor: '#9A9690' },
        { label: 'Nuovi settimana',   value: `+${nuoviSett}`,    color: nuoviSett >= 5 ? '#1B4332' : '#8E6B33', sub: 'ultimi 7gg', subColor: '#9A9690' },
        { label: 'Edizioni mese',     value: String(edizioniMese.length), color: '#1A1A1A', sub: 'pubblicate', subColor: '#9A9690' },
      ]},

      // Alert
      ...alerts.map(a => ({
        type: 'alert',
        text: `<strong>${a.tipo.replace(/_/g,' ')}</strong>${a.link ? ` — <a href="${a.link}" style="color:#C8251D">${a.link.replace('https://','')}</a>` : ''}<br>${a.msg}`,
        type: a.gravita === 'alta' ? 'warning' : 'info'
      })),

      // Run per agente
      ...(runRows.length ? [{ type: 'table', label: `Run agenti questo mese (${runsArr.length} totali)`, headers: [
        { label: 'Agente' },
        { label: 'Run', align: 'center' },
        { label: 'Errori', align: 'center' },
        { label: 'Costo stimato', align: 'right' },
      ], rows: runRows }] : []),

      // Note fisse
      { type: 'alert', text: 'I costi Anthropic sono <strong>stime</strong> basate su durata run — verifica il dato esatto su <a href="https://console.anthropic.com/settings/billing" style="color:#1B3A6B">console.anthropic.com</a>', type: 'info' },
    ]
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `Cost Guardian VA · €${costoTotaleStimato.toFixed(2)} stimati · ${alerts.length > 0 ? `⚠ ${alerts.length} alert` : '✓ OK'} · ${oggiShort}`,
      html
    })
  });

  await logRun('cost-guardian', status,
    `€${costoTotaleStimato.toFixed(2)} stimati, ${runsArr.length} run, ${numIscritti} iscritti, ${alerts.length} alert`,
    report, Date.now()-start);

  console.log(`Cost Guardian completato. Costo stimato: €${costoTotaleStimato.toFixed(2)}`);
}

main().catch(async e => {
  console.error('ERRORE Cost Guardian:', e.message);
  await logRun('cost-guardian', 'error', e.message).catch(() => {});
  process.exit(1);
});
