// api/send-newsletter.js
// CommonJS — Vercel serverless function
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const resend = new Resend(process.env.RESEND_KEY);

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Prefissa con ~ se il numero è stimato (non ha fonte primaria diretta)
function formatKpiValue(kpi) {
  if (!kpi) return '';
  const val = esc(kpi.value || '');
  if (kpi.stimato) return '~' + val;
  return val;
}

// ─────────────────────────────────────────────
// TEMPLATE HTML
// ─────────────────────────────────────────────

function buildHtml(edition) {
  const { num, title, subtitle, date, opener, sections = [], tesi, monitoring = [] } = edition;

  // Estrai le prime 3 sezioni
  const s1 = sections[0] || {};
  const s2 = sections[1] || {};
  const s3 = sections[2] || {};

  // KPI bar: prende i primi 3 kpi dalla prima sezione, o da edition.kpis se presenti
  const kpis = edition.kpis || [
    { label: s1.label || '', value: s1.kpis?.[0]?.value || '', sub: s1.kpis?.[0]?.sub || '', fonte: s1.kpis?.[0]?.fonte || '', stimato: s1.kpis?.[0]?.stimato || false, icon: 'bar' },
    { label: s2.label || '', value: s2.kpis?.[0]?.value || '', sub: s2.kpis?.[0]?.sub || '', fonte: s2.kpis?.[0]?.fonte || '', stimato: s2.kpis?.[0]?.stimato || false, icon: 'trophy' },
    { label: s3.label || '', value: s3.kpis?.[0]?.value || '', sub: s3.kpis?.[0]?.sub || '', fonte: s3.kpis?.[0]?.fonte || '', stimato: s3.kpis?.[0]?.stimato || false, icon: 'grid' },
  ];

  // Icone SVG per la KPI bar
  const icons = {
    bar: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4A017" stroke-width="2"><rect x="2" y="12" width="4" height="10"/><rect x="9" y="8" width="4" height="14"/><rect x="16" y="4" width="4" height="18"/></svg>`,
    trophy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4A017" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>`,
    grid: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4A017" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 21V9"/></svg>`,
  };

  // Renderizza barre comparative se presenti nella sezione
  function renderBars(bars = []) {
    if (!bars.length) return '';
    return bars.map((b, i) => `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
          <span style="font-family:'Courier New',monospace;font-size:9.5px;color:${i === 0 ? '#1A1A1A' : '#9A9690'};">${esc(b.label)}</span>
          <span style="font-family:'Courier New',monospace;font-size:9.5px;font-weight:700;color:${i === 0 ? '#D4A017' : (b.value === '€0' || b.value === '£0' ? '#C8251D' : (i > 2 ? '#9A9690' : '#4A4845'))};">${b.stimato ? '~' : ''}${esc(b.value)}</span>
        </div>
        <div style="height:4px;background:#D0CBC0;border-radius:1px;">
          <div style="height:100%;width:${b.pct || 0}%;background:${i === 0 ? '#D4A017' : (i > 2 ? '#9A9690' : '#1A1A1A')};border-radius:1px;"></div>
        </div>
      </div>`).join('');
  }

  // Renderizza tabella KPI sezione
  function renderKpiTable(kpiRows = [], fonte = '') {
    if (!kpiRows.length) return '';
    const rows = kpiRows.map(k => `
      <tr style="border-bottom:1px solid #D0CBC0;">
        <td style="padding:5px 0;color:#9A9690;font-family:'Courier New',monospace;font-size:10px;">${esc(k.key)}</td>
        <td style="padding:5px 0;text-align:right;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:${k.color || '#1A1A1A'};">${k.stimato ? '~' : ''}${esc(k.value)}</td>
      </tr>`).join('');

    return `
      <div style="background:#EDE9E0;padding:14px;margin-bottom:10px;">
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.12em;color:#9A9690;text-transform:uppercase;margin-bottom:9px;display:flex;align-items:center;gap:7px;">
          <span style="display:inline-block;width:8px;height:1px;background:#9A9690;"></span>Dati chiave
        </div>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        ${fonte ? `<div style="margin-top:9px;padding-top:8px;border-top:1px solid #D0CBC0;font-family:'Courier New',monospace;font-size:7px;color:#9A9690;line-height:1.6;">${esc(fonte)}</div>` : ''}
      </div>`;
  }

  // Renderizza una sezione corpo
  function renderSection(sec, idx) {
    if (!sec || !sec.title) return '';
    const sectionLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
    const label = sec.section_label || sectionLabels[idx] || `0${idx + 1}`;

    // Box insight (dark o accent)
    const insightBox = sec.insight ? `
      <div style="background:${sec.insight.dark ? '#1A1A1A' : '#EDE9E0'};border-left:${sec.insight.dark ? 'none' : `3px solid ${sec.insight.accent_color || '#D4A017'}`};padding:12px 14px;">
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.1em;color:${sec.insight.dark ? '#D4A017' : '#9A9690'};text-transform:uppercase;margin-bottom:5px;">${esc(sec.insight.label || 'La lettura')}</div>
        <p style="font-family:Georgia,serif;font-size:11.5px;color:${sec.insight.dark ? 'rgba(255,255,255,0.55)' : '#4A4845'};line-height:1.7;margin:0;font-weight:300;">${esc(sec.insight.text || '')}</p>
      </div>` : '';

    // Box bars (grafici a barre)
    const barsBox = sec.bars && sec.bars.length ? `
      <div style="background:#EDE9E0;padding:14px;margin-bottom:10px;">
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.12em;color:#9A9690;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:7px;">
          <span style="display:inline-block;width:8px;height:1px;background:#9A9690;"></span>${esc(sec.bars_label || 'Comparazione')}
        </div>
        ${renderBars(sec.bars)}
        ${sec.bars_note ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #D0CBC0;font-family:'Courier New',monospace;font-size:8px;color:#9A9690;line-height:1.55;">${esc(sec.bars_note)}</div>` : ''}
        ${sec.bars_fonte ? `<div style="margin-top:4px;font-family:'Courier New',monospace;font-size:7px;color:#9A9690;line-height:1.6;">${esc(sec.bars_fonte)}</div>` : ''}
      </div>` : '';

    // Note box (accent sinistro)
    const noteBox = sec.note_box ? `
      <div style="background:#EDE9E0;border-left:3px solid ${sec.note_box.color || '#D4A017'};padding:11px 13px;">
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.1em;color:#9A9690;text-transform:uppercase;margin-bottom:5px;">${esc(sec.note_box.label || '')}</div>
        <p style="font-family:Georgia,serif;font-size:11.5px;color:#4A4845;line-height:1.7;margin:0;font-weight:300;">${esc(sec.note_box.text || '')}</p>
      </div>` : '';

    const rightCol = sec.kpi_rows?.length
      ? renderKpiTable(sec.kpi_rows, sec.fonte) + insightBox + (sec.risk_box ? `
        <div style="margin-top:10px;background:#EDE9E0;border-left:3px solid #C8251D;padding:11px 13px;">
          <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.1em;color:#9A9690;text-transform:uppercase;margin-bottom:5px;">Rischio principale</div>
          <p style="font-family:Georgia,serif;font-size:11.5px;color:#4A4845;line-height:1.7;margin:0;font-weight:300;">${esc(sec.risk_box)}</p>
        </div>` : '')
      : barsBox + noteBox + insightBox;

    // Paragrafi body
    const bodyParas = Array.isArray(sec.body)
      ? sec.body.map((p, pi) => `<p style="font-family:Georgia,serif;font-size:13px;color:${pi === sec.body.length - 1 ? '#1A1A1A' : '#4A4845'};font-weight:${pi === sec.body.length - 1 ? '400' : '300'};line-height:1.85;margin:0 0 ${pi < sec.body.length - 1 ? '13px' : '0'};">${p}</p>`)
      : [`<p style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.85;margin:0;">${esc(sec.body || '')}</p>`];

    return `
    <div style="background:#F5F2EB;padding:28px 28px 24px;border-bottom:1px solid #D0CBC0;">

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="width:24px;height:24px;background:#1A1A1A;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;font-size:9px;font-weight:700;color:#D4A017;flex-shrink:0;">${idx + 1}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#9A9690;text-transform:uppercase;">${esc(label)}</div>
        <div style="flex:1;height:1px;background:#D0CBC0;"></div>
      </div>

      <h2 style="font-family:Georgia,serif;font-size:19px;font-weight:900;color:#1A1A1A;letter-spacing:-.5px;line-height:1.2;margin:0 0 5px;">${esc(sec.title)}</h2>
      ${sec.subtitle ? `<div style="font-family:Georgia,serif;font-size:12.5px;font-style:italic;color:#D4A017;margin-bottom:18px;font-weight:400;">${esc(sec.subtitle)}</div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 250px;gap:24px;align-items:start;">
        <div>${bodyParas.join('')}</div>
        <div>${rightCol}</div>
      </div>
    </div>`;
  }

  // Tesi — polarizzazione top/mid
  function renderTesi(tesi = {}) {
    const topItems = (tesi.top || []).map(t => `
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#D4A017;flex-shrink:0;margin-top:2px;">→</span>
        <span style="font-family:Georgia,serif;font-size:12.5px;color:rgba(255,255,255,0.6);font-weight:300;line-height:1.5;">${esc(t)}</span>
      </div>`).join('');

    const midItems = (tesi.mid || []).map(t => `
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#9A9690;flex-shrink:0;margin-top:2px;">→</span>
        <span style="font-family:Georgia,serif;font-size:12.5px;color:rgba(255,255,255,0.35);font-weight:300;line-height:1.5;">${esc(t)}</span>
      </div>`).join('');

    const monitorItems = (monitoring || []).map(m => `
      <div style="font-family:Georgia,serif;font-size:11.5px;color:rgba(255,255,255,0.35);font-weight:300;line-height:1.5;display:flex;gap:8px;">
        <span style="color:rgba(255,255,255,0.2);flex-shrink:0;">·</span>${esc(m)}
      </div>`).join('');

    return `
    <div style="background:#1A1A1A;padding:30px 28px 28px;">

      <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.18em;color:#D4A017;text-transform:uppercase;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:14px;height:1px;background:#D4A017;"></span>La tesi di Valore Atteso
      </div>

      <p style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#fff;line-height:1.35;margin:0 0 6px;letter-spacing:-.3px;">${esc(tesi.headline || '')}</p>
      <p style="font-family:Georgia,serif;font-size:13px;font-weight:300;color:rgba(255,255,255,0.45);line-height:1.75;margin:0 0 22px;font-style:italic;">${esc(tesi.intro || '')}</p>

      <div style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0;margin-bottom:24px;">
        <div style="padding-right:24px;">
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#D4A017;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:7px;">
            <span style="display:inline-block;width:8px;height:1px;background:#D4A017;"></span>Top club
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">${topItems}</div>
        </div>
        <div style="background:rgba(255,255,255,0.07);"></div>
        <div style="padding-left:24px;">
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:7px;">
            <span style="display:inline-block;width:8px;height:1px;background:#9A9690;"></span>Fascia media
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">${midItems}</div>
        </div>
      </div>

      ${monitorItems ? `
      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:18px;">
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.16em;color:#9A9690;text-transform:uppercase;margin-bottom:10px;">Cosa monitoreremo nelle prossime settimane</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;">${monitorItems}</div>
      </div>` : ''}
    </div>`;
  }

  // KPI bar
  function renderKpiBar(kpis) {
    return kpis.map((k, i) => `
      <div style="padding:18px 24px;${i < 2 ? 'border-right:1px solid #D0CBC0;' : ''}">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px;">
          ${icons[k.icon] || icons.bar}
          <span style="font-family:'Courier New',monospace;font-size:7.5px;color:#9A9690;letter-spacing:.14em;text-transform:uppercase;">${esc(k.label)}</span>
        </div>
        <div style="font-family:Georgia,serif;font-size:30px;font-weight:900;color:#1A1A1A;letter-spacing:-1.5px;line-height:1;margin-bottom:3px;">${formatKpiValue(k)}</div>
        <div style="font-family:'Courier New',monospace;font-size:10px;color:#D4A017;letter-spacing:.04em;margin-bottom:3px;">${esc(k.sub || '')}</div>
        ${k.fonte ? `<div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.04em;">${esc(k.fonte)}</div>` : ''}
      </div>`).join('');
  }

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(title)} — Valore Atteso #${esc(num)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F5F2EB;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#F5F2EB;">
  ${esc(subtitle || opener || '')} · valoreatteso.com
</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F2EB;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;">

  <!-- PREHEADER -->
  <tr><td style="background:#1A1A1A;padding:7px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.3);letter-spacing:.06em;">
        Se non visualizzi correttamente — <a href="{{WEBVIEW_URL}}" style="color:#D4A017;text-decoration:none;">clicca qui</a>
      </td>
      <td align="right" style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.2);">valoreatteso.com</td>
    </tr></table>
  </td></tr>

  <!-- MASTHEAD -->
  <tr><td style="background:#F5F2EB;padding:18px 28px 16px;border-bottom:3px solid #1A1A1A;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:34px;height:34px;border:2px solid #1A1A1A;text-align:center;vertical-align:middle;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#1A1A1A;letter-spacing:-1px;">VA</td>
          <td style="padding-left:14px;">
            <div style="font-family:Georgia,serif;font-size:24px;font-weight:900;letter-spacing:-1px;color:#1A1A1A;line-height:1;">VALORE ATTESO</div>
            <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#9A9690;text-transform:uppercase;margin-top:2px;">Il calcio dei numeri, non dei goal.</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:bottom;">
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.1em;text-transform:uppercase;">Edizione</div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#D4A017;letter-spacing:-1px;line-height:1.1;">#${esc(num)}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;">${esc(date || '')}</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- HERO -->
  <tr><td style="background:#1A1A1A;padding:32px 28px 28px;">
    <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#D4A017;text-transform:uppercase;margin-bottom:12px;">
      — Questa settimana
    </div>
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:900;color:#fff;line-height:1.1;letter-spacing:-1.5px;margin:0 0 6px;">${esc(title)}</h1>
    ${subtitle ? `<h2 style="font-family:Georgia,serif;font-size:20px;font-weight:400;font-style:italic;color:#D4A017;line-height:1.2;margin:0 0 18px;">${esc(subtitle)}</h2>` : ''}
    ${opener ? `<div style="border-left:2px solid rgba(212,160,23,0.3);padding-left:14px;max-width:460px;">
      <p style="font-family:Georgia,serif;font-size:13px;color:rgba(255,255,255,0.5);font-style:italic;line-height:1.75;margin:0;font-weight:300;">${esc(opener)}</p>
    </div>` : ''}
  </td></tr>

  <!-- KPI BAR -->
  <tr><td style="background:#EDE9E0;border-bottom:1px solid #D0CBC0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${renderKpiBar(kpis)}
    </tr></table>
  </td></tr>

  <!-- SEZIONI CORPO -->
  <tr><td>
    ${sections.map((sec, i) => renderSection(sec, i)).join('')}
  </td></tr>

  <!-- TESI DI VALORE ATTESO -->
  <tr><td>
    ${renderTesi(tesi || {})}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#EDE9E0;border-top:3px solid #1A1A1A;padding:22px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <!-- Logo -->
        <td width="33%" style="border-right:1px solid #D0CBC0;padding-right:20px;vertical-align:top;">
          <div style="font-family:Georgia,serif;font-size:15px;font-weight:900;color:#1A1A1A;letter-spacing:-.5px;margin-bottom:3px;">Valore Atteso</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.06em;line-height:1.6;">Il calcio dei numeri,<br>non dei goal.</div>
        </td>
        <!-- Social -->
        <td width="33%" align="center" style="border-right:1px solid #D0CBC0;vertical-align:middle;">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.14em;text-transform:uppercase;margin-bottom:9px;">Seguici</div>
          <table cellpadding="0" cellspacing="0" border="0" align="center"><tr>
            <td style="padding-right:8px;">
              <a href="https://instagram.com/valoreatteso" style="display:block;width:28px;height:28px;border:1px solid #D0CBC0;background:#F5F2EB;text-align:center;line-height:28px;text-decoration:none;">
                <img src="https://valoreatteso.com/icons/ig.png" width="12" height="12" alt="Instagram" style="vertical-align:middle;">
              </a>
            </td>
            <td>
              <a href="https://linkedin.com/company/valoreatteso" style="display:block;width:28px;height:28px;border:1px solid #D0CBC0;background:#F5F2EB;text-align:center;line-height:28px;text-decoration:none;">
                <img src="https://valoreatteso.com/icons/li.png" width="12" height="12" alt="LinkedIn" style="vertical-align:middle;">
              </a>
            </td>
          </tr></table>
        </td>
        <!-- Sito + contatti -->
        <td width="33%" style="padding-left:20px;vertical-align:middle;">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px;">Sito Web</div>
          <div style="font-family:'Courier New',monospace;font-size:10px;color:#D4A017;margin-bottom:8px;">valoreatteso.com</div>
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px;">Contatti</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:#4A4845;">info@valoreatteso.com</div>
        </td>
      </tr>
    </table>

    <!-- Legal -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #D0CBC0;padding:14px 0 18px;text-align:center;">
        <p style="font-family:'Courier New',monospace;font-size:8.5px;color:#9A9690;letter-spacing:.04em;line-height:1.9;margin:0;">
          Hai ricevuto questa email perché sei iscritto a Valore Atteso.<br>
          Puoi aggiornare le tue <a href="{{PREFS_URL}}" style="color:#4A4845;text-decoration:underline;">preferenze</a> o
          <a href="{{UNSUB_URL}}" style="color:#4A4845;text-decoration:underline;">disiscriverti</a> in qualsiasi momento.
        </p>
      </td></tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { edition_num, edition_id } = req.body;

    // 1. Recupera edizione da Supabase
    let query = supabase.from('editions').select('*').eq('published', true);
    if (edition_id) query = query.eq('id', edition_id);
    else if (edition_num) query = query.eq('num', String(edition_num).padStart(3, '0'));
    else return res.status(400).json({ error: 'Parametro edition_num o edition_id obbligatorio' });

    const { data: editions, error: edErr } = await query.limit(1);
    if (edErr) throw new Error('Supabase: ' + edErr.message);
    if (!editions || !editions.length) throw new Error('Edizione non trovata o non pubblicata');
    const edition = editions[0];

    // 2. Recupera iscritti confermati
    const { data: subs, error: subErr } = await supabase
      .from('subscribers')
      .select('email')
      .eq('confirmed', true);
    if (subErr) throw new Error('Supabase subscribers: ' + subErr.message);
    if (!subs || !subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'Nessun iscritto confermato' });

    // 3. Build HTML
    const html = buildHtml(edition);
    const subject = `#${edition.num} — ${edition.title}`;

    // 4. Invio batch con Resend (max 50 per chiamata)
    const BATCH = 50;
    let sent = 0;
    let errors = 0;

    for (let i = 0; i < subs.length; i += BATCH) {
      const batch = subs.slice(i, i + BATCH);
      const personalizedHtml = (email) => html
        .replace('{{UNSUB_URL}}', `${process.env.SITE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}`)
        .replace('{{PREFS_URL}}', `${process.env.SITE_URL}/preferenze?email=${encodeURIComponent(email)}`)
        .replace('{{WEBVIEW_URL}}', `${process.env.SITE_URL}/archivio#${edition.num}`);

      const results = await Promise.allSettled(
        batch.map(sub =>
          resend.emails.send({
            from: 'Valore Atteso <info@valoreatteso.com>',
            to: sub.email,
            subject,
            html: personalizedHtml(sub.email),
          })
        )
      );

      results.forEach(r => {
        if (r.status === 'fulfilled') sent++;
        else errors++;
      });
    }

    // 5. Aggiorna sent_at e sent_count su Supabase
    await supabase
      .from('editions')
      .update({ sent_at: new Date().toISOString(), sent_count: sent })
      .eq('id', edition.id);

    // 6. Log su agent_runs
    await supabase.from('agent_runs').insert({
      agent: 'send-newsletter',
      status: errors === 0 ? 'success' : 'partial',
      summary: `Edizione #${edition.num} inviata a ${sent} iscritti. Errori: ${errors}.`,
      data: { edition_num: edition.num, sent, errors },
    });

    return res.status(200).json({
      ok: true,
      edition: `#${edition.num}`,
      sent,
      errors,
    });

  } catch (err) {
    console.error('[send-newsletter]', err);
    await supabase.from('agent_runs').insert({
      agent: 'send-newsletter',
      status: 'error',
      summary: err.message,
    }).catch(() => {});
    return res.status(500).json({ error: err.message });
  }
};
