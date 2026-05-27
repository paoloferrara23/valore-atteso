// growth-agent.js — Analisi crescita iscritti con AI
// Gira: mercoledì 7:00 UTC (8:00 IT) | Scrive: growth_report

const { memGet, memSet, logRun } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function supaFetch(path) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function callClaude(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status}`);
  const d = await r.json();
  return d.content[0].text;
}

function semaforo(val, soglie) {
  if (val >= soglie.verde) return { colore: '#1B6B3A', emoji: '🟢' };
  if (val >= soglie.giallo) return { colore: '#B45309', emoji: '🟡' };
  return { colore: '#C8251D', emoji: '🔴' };
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  console.log('Growth Agent avviato:', new Date().toISOString());

  // ── Dati iscritti ────────────────────────────────────────────────────────
  const tutti = await supaFetch('/rest/v1/subscribers?select=email,confirmed,created_at,source&order=created_at.asc');
  const confermati = tutti.filter(s => s.confirmed);
  const nonConfermati = tutti.filter(s => !s.confirmed);

  const ora = Date.now();
  const ieri       = new Date(ora - 1 * 24 * 3600 * 1000).toISOString();
  const sett1fa    = new Date(ora - 7 * 24 * 3600 * 1000).toISOString();
  const sett2fa    = new Date(ora - 14 * 24 * 3600 * 1000).toISOString();
  const mese1fa    = new Date(ora - 30 * 24 * 3600 * 1000).toISOString();
  const mese2fa    = new Date(ora - 60 * 24 * 3600 * 1000).toISOString();

  const nuoviSett   = confermati.filter(s => s.created_at >= sett1fa).length;
  const nuoviSett2  = confermati.filter(s => s.created_at >= sett2fa && s.created_at < sett1fa).length;
  const nuoviMese   = confermati.filter(s => s.created_at >= mese1fa).length;
  const nuoviMese2  = confermati.filter(s => s.created_at >= mese2fa && s.created_at < mese1fa).length;
  const nuoviIeri   = confermati.filter(s => s.created_at >= ieri).length;

  const deltaSett = nuoviSett2 > 0 ? (((nuoviSett - nuoviSett2) / nuoviSett2) * 100).toFixed(0) : null;
  const deltaMese = nuoviMese2 > 0 ? (((nuoviMese - nuoviMese2) / nuoviMese2) * 100).toFixed(0) : null;

  const tassoConv = tutti.length > 0 ? ((confermati.length / tutti.length) * 100).toFixed(1) : 0;

  // Proiezione: a questo ritmo, quando raggiungo 100 e 200?
  const velocitaMedia7gg = nuoviSett / 7; // iscritti/giorno
  const mancano100 = Math.max(0, 100 - confermati.length);
  const mancano200 = Math.max(0, 200 - confermati.length);
  const giorni100 = velocitaMedia7gg > 0 ? Math.ceil(mancano100 / velocitaMedia7gg) : null;
  const giorni200 = velocitaMedia7gg > 0 ? Math.ceil(mancano200 / velocitaMedia7gg) : null;
  const data100 = giorni100 ? new Date(ora + giorni100 * 24 * 3600 * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : 'N/D';
  const data200 = giorni200 ? new Date(ora + giorni200 * 24 * 3600 * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : 'N/D';

  // Fonti
  const fonti = {};
  confermati.forEach(s => { const src = s.source || 'organico'; fonti[src] = (fonti[src] || 0) + 1; });
  const fontiFiltrate = Object.entries(fonti).sort((a, b) => b[1] - a[1]);

  // Edizioni inviate (per correlazione)
  const edizioni = await supaFetch('/rest/v1/editions?select=num,title,date,sent_count&published=eq.true&order=date.desc&limit=4');

  // Report precedente per confronto
  const prevReport = await memGet('growth_report');
  const prevConfermati = prevReport?.value?.confermati || 0;
  const deltaAssoluto = confermati.length - prevConfermati;

  // ── Analisi AI ───────────────────────────────────────────────────────────
  const prompt = `Sei il growth analyst di Valore Atteso, newsletter italiana sul business del calcio (target: M&A, PE, finanza).

DATI QUESTA SETTIMANA:
- Iscritti confermati: ${confermati.length} (erano ${prevConfermati} settimana scorsa, +${deltaAssoluto})
- Nuovi questa settimana: ${nuoviSett} (settimana scorsa: ${nuoviSett2}, variazione: ${deltaSett !== null ? deltaSett + '%' : 'N/D'})
- Nuovi ultimo mese: ${nuoviMese} (mese precedente: ${nuoviMese2})
- Tasso conversione email: ${tassoConv}%
- Velocità media: ${velocitaMedia7gg.toFixed(1)} iscritti/giorno
- Proiezione 100 iscritti: ${data100}
- Fonti principali: ${fontiFiltrate.slice(0, 3).map(([k, v]) => k + ' (' + v + ')').join(', ')}
- Ultime edizioni inviate: ${edizioni.map(e => '#' + e.num + ' ' + e.title).join(' | ')}

Dammi:
1. UNA frase di valutazione della settimana (max 20 parole, diretta)
2. TRE azioni concrete da fare questa settimana per accelerare la crescita (specifiche per Valore Atteso, non generiche)
3. UN rischio da monitorare

Rispondi in JSON: {"valutazione":"...","azioni":["...","...","..."],"rischio":"..."}`;

  let analisi = { valutazione: 'Dati raccolti.', azioni: ['Pubblica su LinkedIn', 'Controlla tasso conversione', 'Analizza fonti'], rischio: 'N/D' };
  try {
    const raw = await callClaude(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) analisi = JSON.parse(match[0]);
  } catch(e) { console.warn('AI analysis fallita:', e.message); }

  // ── Salva report ─────────────────────────────────────────────────────────
  const report = {
    data: new Date().toISOString(),
    confermati: confermati.length,
    totale: tutti.length,
    tasso_conversione: parseFloat(tassoConv),
    nuovi_7gg: nuoviSett,
    nuovi_30gg: nuoviMese,
    velocita_giornaliera: parseFloat(velocitaMedia7gg.toFixed(2)),
    proiezione_100: data100,
    proiezione_200: data200,
    fonti,
    analisi
  };
  await memSet('growth_report', report, 'growth');

  // ── Email HTML ───────────────────────────────────────────────────────────
  const s_conv = semaforo(parseFloat(tassoConv), { verde: 70, giallo: 50 });
  const s_sett = semaforo(nuoviSett, { verde: 5, giallo: 2 });
  const s_delta = deltaSett !== null
    ? semaforo(parseFloat(deltaSett), { verde: 0, giallo: -20 })
    : { colore: '#9A9690', emoji: '⚪' };

  const fontiHTML = fontiFiltrate.map(([k, v]) => `
    <tr>
      <td style="padding:7px 14px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;color:#4A4845">${k}</td>
      <td style="padding:7px 14px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:12px;font-weight:700;text-align:right;color:#1A1A1A">${v}</td>
      <td style="padding:7px 14px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;text-align:right;color:#9A9690">${confermati.length > 0 ? ((v/confermati.length)*100).toFixed(0) : 0}%</td>
    </tr>`).join('');

  const edizioniHTML = edizioni.map(e => `
    <tr>
      <td style="padding:7px 14px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;color:#8E6B33">#${e.num}</td>
      <td style="padding:7px 14px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;color:#4A4845">${e.title}</td>
      <td style="padding:7px 14px;border-bottom:1px solid #E2DDD4;font-family:'Courier New',monospace;font-size:11px;text-align:right;color:#1A1A1A">${e.sent_count || '—'}</td>
    </tr>`).join('');

  const azioniHTML = analisi.azioni.map((a, i) => `
    <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;padding:12px 14px;background:#F0EBE1;border-left:3px solid #C8A97A">
      <span style="font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#8E6B33;flex-shrink:0;margin-top:1px">${i+1}.</span>
      <span style="font-family:Georgia,serif;font-size:13px;color:#1A1A1A;line-height:1.5">${a}</span>
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#D8D0C4">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#D8D0C4">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#F5F2EB">

  <!-- HEADER -->
  <tr><td style="padding:20px 28px;background:#1A1A1A">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px">Valore Atteso</div>
    <div style="font-family:'Courier New',monospace;font-size:8px;color:#C8A97A;letter-spacing:.16em;text-transform:uppercase;margin-top:4px">Growth Report · ${oggi}</div>
  </td></tr>

  <!-- VALUTAZIONE AI -->
  <tr><td style="padding:20px 28px;background:#1A1A1A;border-top:1px solid rgba(255,255,255,0.08)">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#8E6B33;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px">— Lettura della settimana</div>
    <div style="font-family:Georgia,serif;font-size:16px;color:#FFFDF8;line-height:1.5;font-style:italic">"${analisi.valutazione}"</div>
  </td></tr>

  <!-- KPI PRINCIPALI -->
  <tr><td style="padding:0">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #1A1A1A">
      <tr>
        <td style="padding:18px 20px;border-right:1px solid #D0CBC0;width:25%;text-align:center;background:#F0EBE1">
          <div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#1A1A1A;line-height:1">${confermati.length}</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;text-transform:uppercase;margin-top:4px">Confermati</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:${deltaAssoluto >= 0 ? '#1B6B3A' : '#C8251D'};margin-top:2px">${deltaAssoluto >= 0 ? '+' : ''}${deltaAssoluto} vs scorsa sett.</div>
        </td>
        <td style="padding:18px 20px;border-right:1px solid #D0CBC0;width:25%;text-align:center;background:#F5F2EB">
          <div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:${s_sett.colore};line-height:1">+${nuoviSett}</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;text-transform:uppercase;margin-top:4px">Nuovi 7gg</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:${s_delta.colore};margin-top:2px">${deltaSett !== null ? (deltaSett > 0 ? '↑' : '↓') + ' ' + Math.abs(deltaSett) + '% vs sett. prec.' : '—'}</div>
        </td>
        <td style="padding:18px 20px;border-right:1px solid #D0CBC0;width:25%;text-align:center;background:#F0EBE1">
          <div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:${s_conv.colore};line-height:1">${tassoConv}%</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;text-transform:uppercase;margin-top:4px">Conversione</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;margin-top:2px">target: >70%</div>
        </td>
        <td style="padding:18px 20px;width:25%;text-align:center;background:#F5F2EB">
          <div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#8E6B33;line-height:1">${velocitaMedia7gg.toFixed(1)}</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;text-transform:uppercase;margin-top:4px">Iscr./giorno</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;margin-top:2px">media 7gg</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- PROIEZIONI -->
  <tr><td style="padding:16px 28px;background:#1A1A1A">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#8E6B33;letter-spacing:.16em;text-transform:uppercase;margin-bottom:12px">— Proiezioni (a ritmo attuale)</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:50%;padding-right:12px">
          <div style="background:rgba(255,255,255,0.05);padding:12px 16px;border-left:2px solid #C8A97A">
            <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;text-transform:uppercase;margin-bottom:4px">100 iscritti</div>
            <div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#FFFDF8">${confermati.length >= 100 ? '✓ Raggiunto' : data100}</div>
            ${confermati.length < 100 ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:#777066;margin-top:2px">mancano ${mancano100} iscritti</div>` : ''}
          </div>
        </td>
        <td style="width:50%;padding-left:12px">
          <div style="background:rgba(255,255,255,0.05);padding:12px 16px;border-left:2px solid #8E6B33">
            <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;text-transform:uppercase;margin-bottom:4px">200 iscritti → primo sponsor</div>
            <div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#FFFDF8">${confermati.length >= 200 ? '✓ Raggiunto' : data200}</div>
            ${confermati.length < 200 ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:#777066;margin-top:2px">mancano ${mancano200} iscritti</div>` : ''}
          </div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- AZIONI -->
  <tr><td style="padding:20px 28px">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#C8251D;letter-spacing:.16em;text-transform:uppercase;margin-bottom:14px">— Azioni questa settimana</div>
    ${azioniHTML}
  </td></tr>

  <!-- RISCHIO -->
  <tr><td style="padding:0 28px 20px">
    <div style="background:#FEF3F2;border:1px solid #FECACA;padding:12px 16px">
      <div style="font-family:'Courier New',monospace;font-size:8px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">⚠ Rischio da monitorare</div>
      <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;line-height:1.5">${analisi.rischio}</div>
    </div>
  </td></tr>

  <!-- FONTI -->
  ${fontiFiltrate.length > 0 ? `
  <tr><td style="padding:0 28px 20px">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">— Fonti acquisizione</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#EDE9E0">
        <th style="padding:7px 14px;text-align:left;font-family:'Courier New',monospace;font-size:8px;color:#9A9690;font-weight:400">Fonte</th>
        <th style="padding:7px 14px;text-align:right;font-family:'Courier New',monospace;font-size:8px;color:#9A9690;font-weight:400">Iscritti</th>
        <th style="padding:7px 14px;text-align:right;font-family:'Courier New',monospace;font-size:8px;color:#9A9690;font-weight:400">%</th>
      </tr>
      ${fontiHTML}
    </table>
  </td></tr>` : ''}

  <!-- EDIZIONI -->
  ${edizioni.length > 0 ? `
  <tr><td style="padding:0 28px 20px">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">— Ultime edizioni</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#EDE9E0">
        <th style="padding:7px 14px;text-align:left;font-family:'Courier New',monospace;font-size:8px;color:#9A9690;font-weight:400">#</th>
        <th style="padding:7px 14px;text-align:left;font-family:'Courier New',monospace;font-size:8px;color:#9A9690;font-weight:400">Titolo</th>
        <th style="padding:7px 14px;text-align:right;font-family:'Courier New',monospace;font-size:8px;color:#9A9690;font-weight:400">Inviata a</th>
      </tr>
      ${edizioniHTML}
    </table>
  </td></tr>` : ''}

  <!-- FOOTER -->
  <tr><td style="padding:14px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0">
    <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">Report automatico Growth Agent · Dati in tempo reale da Supabase</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  // ── Invia email ──────────────────────────────────────────────────────────
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM,
      to: APPROVAL_EMAIL,
      subject: `Growth VA · ${confermati.length} iscritti · +${nuoviSett} questa settimana`,
      html
    })
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    throw new Error(`Resend: ${emailRes.status} ${err}`);
  }

  const duration = Date.now() - start;
  await logRun('growth', 'success',
    `${confermati.length} confermati (+${deltaAssoluto}), +${nuoviSett} nuovi, conv. ${tassoConv}%`,
    report, duration);

  console.log(`Growth Agent completato in ${duration}ms. Iscritti: ${confermati.length}, nuovi: ${nuoviSett}`);
}

main().catch(async e => {
  console.error('ERRORE Growth Agent:', e.message);
  await logRun('growth', 'error', e.message).catch(() => {});
  process.exit(1);
});
