// scripts/deliverability-agent.js — Deliverability Agent v2
// Gira: martedì 14:00 IT (13 UTC) — dopo invio newsletter
// Analizza: metriche reali ultima edizione via Resend + Supabase

const { memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function supaFetch(path) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

async function resendFetch(path) {
  const r = await fetch(`https://api.resend.com${path}`, {
    headers: { 'Authorization': `Bearer ${RESEND_KEY}` }
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  console.log('Deliverability Agent v2 avviato:', new Date().toISOString());

  // ── 1. Ultima edizione inviata ───────────────────────────────────────────
  const edizioni = await supaFetch('/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=*');
  const ed = edizioni?.[0];
  if (!ed) throw new Error('Nessuna edizione pubblicata trovata');
  console.log(`Analisi edizione #${ed.num}: ${ed.title}`);

  // ── 2. Email Resend ultime 100 (filtrate per newsletter reale) ───────────
  let emails = [];
  try {
    const data = await resendFetch('/emails?limit=100');
    // Filtra solo email inviate a indirizzi reali (non @valoreatteso.com, non test)
    emails = (data.data || []).filter(e =>
      e.from?.includes('info@valoreatteso.com') &&
      !e.to?.some(t => t.includes('valoreatteso.com') || t.includes('test'))
    );
    console.log(`Email Resend filtrate: ${emails.length} su ${data.data?.length || 0}`);
  } catch(e) {
    console.warn('Resend API non disponibile:', e.message);
  }

  // ── 3. Calcola metriche ──────────────────────────────────────────────────
  // inviate  = totale REALE della spedizione (sent_count salvato da send-newsletter)
  // tracciate = campione realmente restituito da Resend (max 100/pagina): base dei tassi
  // I tassi si calcolano SEMPRE sul campione tracciato, cosi numeratore e denominatore
  // sono coerenti (altrimenti open-rate tra due dataset diversi = numero falso).
  const tracciate  = emails.length;
  const inviate    = ed.sent_count > 0 ? ed.sent_count : tracciate;
  const campioneParziale = tracciate < inviate; // Resend ha restituito meno record del reale
  const consegnate = emails.filter(e => ['delivered','opened','clicked'].includes(e.last_event)).length;
  const aperte     = emails.filter(e => ['opened','clicked'].includes(e.last_event)).length;
  const cliccate   = emails.filter(e => e.last_event === 'clicked').length;
  const bounced    = emails.filter(e => e.last_event === 'bounced').length;
  const spam       = emails.filter(e => e.last_event === 'complained').length;
  const pending    = emails.filter(e => ['queued','sending'].includes(e.last_event)).length;

  const pct = (n, d) => d > 0 ? ((n/d)*100).toFixed(1) : 'N/D';
  const tassoConsegna = pct(consegnate, tracciate);
  const tassoApertura = pct(aperte, consegnate);
  const tassoClick    = pct(cliccate, aperte);
  const tassoBounce   = pct(bounced, tracciate);
  const tassoSpam     = pct(spam, tracciate);

  // ── 4. Alert ────────────────────────────────────────────────────────────
  const alerts = [];
  if (parseFloat(tassoApertura) < 20 && tracciate > 10)
    alerts.push(`Tasso apertura basso: ${tassoApertura}% — ottimale B2B >30%`);
  if (parseFloat(tassoBounce) > 2 && tracciate > 5)
    alerts.push(`Bounce rate alto: ${tassoBounce}% — massimo accettabile 2%`);
  if (spam > 0)
    alerts.push(`${spam} segnalazione spam — controllare immediatamente gli indirizzi`);
  if (parseFloat(tassoConsegna) < 95 && tracciate > 5)
    alerts.push(`Deliverability bassa: ${tassoConsegna}% — verificare reputazione dominio`);

  // ── 5. Salva report ─────────────────────────────────────────────────────
  const report = {
    data: new Date().toISOString(),
    edizione: ed.num,
    email_inviate: inviate,
    email_tracciate: tracciate,
    campione_parziale: campioneParziale,
    consegnate, aperte, cliccate, bounced, spam,
    tasso_consegna: tassoConsegna,
    tasso_apertura: tassoApertura,
    tasso_click: tassoClick,
    tasso_bounce: tassoBounce,
    alerts
  };
  await memSet('deliverability_report', report, 'deliverability');

  // ── 6. Email con nuovo template ─────────────────────────────────────────
  const status = alerts.length > 0 ? 'warning' : 'success';
  const sc = (val, good, warn) => {
    const v = parseFloat(val);
    if (isNaN(v)) return '#9A9690';
    return v >= good ? '#1B4332' : v >= warn ? '#8E6B33' : '#C8251D';
  };

  const html = agentEmail({
    agentName: 'Deliverability Agent',
    agentKey: 'deliverability',
    status,
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      // Edizione analizzata
      { type: 'narrative', label: 'Edizione analizzata', text: `<strong>#${ed.num}</strong> — ${ed.title}<br><span style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690">${inviate} email inviate${campioneParziale ? ` · tassi su ${tracciate} tracciate da Resend` : ' · dati Resend in tempo reale'}</span>`, dark: true },

      // KPI principali
      { type: 'kpi_grid', kpis: [
        { label: 'Consegnate',   value: `${tassoConsegna}%`, color: sc(tassoConsegna, 97, 95),  sub: `${consegnate}/${tracciate}`,   subColor: '#9A9690' },
        { label: 'Apertura',     value: `${tassoApertura}%`, color: sc(tassoApertura, 30, 20),  sub: 'benchmark >30%',            subColor: '#9A9690' },
        { label: 'Click rate',   value: `${tassoClick}%`,    color: sc(tassoClick, 5, 2),       sub: 'benchmark 3-7%',            subColor: '#9A9690' },
        { label: 'Bounce',       value: `${tassoBounce}%`,   color: sc(2-parseFloat(tassoBounce||0), 0, -2), sub: 'max 2%', subColor: '#9A9690' },
      ]},

      // Alert o OK
      ...(alerts.length > 0
        ? alerts.map(a => ({ type: 'alert', text: a, type: 'warning' }))
        : [{ type: 'alert', text: 'Nessun problema rilevato. Deliverability nella norma.', type: 'success' }]
      ),

      // Benchmark table
      { type: 'table', label: 'Confronto con benchmark B2B', headers: [
        { label: 'Metrica' },
        { label: 'Valore Atteso', align: 'center' },
        { label: 'Benchmark B2B', align: 'center' },
        { label: 'Stato', align: 'center' },
      ], rows: [
        [
          { value: 'Tasso apertura' },
          { value: `${tassoApertura}%`, mono: true, bold: true, color: sc(tassoApertura, 30, 20), align: 'center' },
          { value: '30–45%', mono: true, color: '#9A9690', align: 'center' },
          { value: parseFloat(tassoApertura) >= 30 ? '✓ Ottimo' : parseFloat(tassoApertura) >= 20 ? '→ Nella norma' : '✗ Basso', mono: true, color: sc(tassoApertura, 30, 20), align: 'center' },
        ],
        [
          { value: 'Tasso click' },
          { value: `${tassoClick}%`, mono: true, bold: true, color: sc(tassoClick, 5, 2), align: 'center' },
          { value: '3–7%', mono: true, color: '#9A9690', align: 'center' },
          { value: parseFloat(tassoClick) >= 5 ? '✓ Ottimo' : parseFloat(tassoClick) >= 3 ? '→ Nella norma' : '✗ Basso', mono: true, color: sc(tassoClick, 5, 2), align: 'center' },
        ],
        [
          { value: 'Bounce rate' },
          { value: `${tassoBounce}%`, mono: true, bold: true, color: parseFloat(tassoBounce) <= 2 ? '#1B4332' : '#C8251D', align: 'center' },
          { value: '<2%', mono: true, color: '#9A9690', align: 'center' },
          { value: parseFloat(tassoBounce) <= 2 ? '✓ OK' : '✗ Alto', mono: true, color: parseFloat(tassoBounce) <= 2 ? '#1B4332' : '#C8251D', align: 'center' },
        ],
        [
          { value: 'Spam complaints' },
          { value: `${spam}`, mono: true, bold: true, color: spam === 0 ? '#1B4332' : '#C8251D', align: 'center' },
          { value: '0', mono: true, color: '#9A9690', align: 'center' },
          { value: spam === 0 ? '✓ OK' : '✗ Attenzione', mono: true, color: spam === 0 ? '#1B4332' : '#C8251D', align: 'center' },
        ],
        [
          { value: 'Deliverability' },
          { value: `${tassoConsegna}%`, mono: true, bold: true, color: sc(tassoConsegna, 97, 95), align: 'center' },
          { value: '>97%', mono: true, color: '#9A9690', align: 'center' },
          { value: parseFloat(tassoConsegna) >= 97 ? '✓ Ottima' : '→ Verifica', mono: true, color: sc(tassoConsegna, 97, 95), align: 'center' },
        ],
      ]},

      // Dettaglio numeri
      { type: 'dark_cards', label: 'Dettaglio invio', cards: [
        { label: 'Email inviate',   value: String(inviate),    labelColor: '#9A9690', valueColor: '#FFFDF8' },
        { label: 'Aperte',          value: String(aperte),     labelColor: '#9A9690', valueColor: '#4ADE80' },
        { label: 'Cliccate',        value: String(cliccate),   labelColor: '#9A9690', valueColor: '#C8A97A' },
        { label: 'Bounce + Spam',   value: String(bounced + spam), labelColor: '#9A9690', valueColor: bounced+spam > 0 ? '#FCA5A5' : '#FFFDF8' },
      ]},
    ]
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `Deliverability VA #${ed.num} · ${alerts.length > 0 ? '⚠ ALERT' : '✓ OK'} · Apertura ${tassoApertura}%`,
      html
    })
  });

  await logRun('deliverability', status,
    `Edizione #${ed.num}: apertura ${tassoApertura}%, click ${tassoClick}%, bounce ${tassoBounce}%`,
    report, Date.now()-start);

  console.log(`Deliverability Agent completato. Apertura: ${tassoApertura}%`);
}

main().catch(async e => {
  console.error('ERRORE Deliverability:', e.message);
  await logRun('deliverability', 'error', e.message).catch(() => {});
  process.exit(1);
});
