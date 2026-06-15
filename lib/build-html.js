// lib/build-html.js — costruisce l'HTML della newsletter
const { renderSponsorEmail } = require('./sponsor-renderer');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toSentenceCase(s) {
  if (!s) return '';
  const str = String(s);
  if (str === str.toUpperCase()) return str[0] + str.slice(1).toLowerCase();
  return str;
}

function buildHtml(edition) {
  const { num, title, subtitle, date, opener, sections = [], tesi, monitoring = [], sponsors = [] } = edition;

  const s1 = sections[0] || {};
  const s2 = sections[1] || {};
  const s3 = sections[2] || {};

  function renderKpiRow(kpis) {
    if (!kpis || !kpis.length) return '';
    const rows = kpis.slice(0, 3).map((k, i) => {
      const border = i < Math.min(kpis.length, 3) - 1 ? 'border-right:1px solid #2C2C2A;' : '';
      const sub = k.sub ? `<div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.65);margin-top:3px;line-height:1.4;">${esc(k.sub)}</div>` : '';
      return `<td style="padding:12px 8px;${border}vertical-align:top;width:33%;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:15px;font-weight:900;color:#E8C87A;letter-spacing:-.3px;line-height:1.2;margin-bottom:6px;white-space:nowrap;">${esc(k.value)}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.85);letter-spacing:.06em;text-transform:uppercase;line-height:1.5;">${esc(k.label)}</div>
        ${sub}
      </td>`;
    }).join('');
    return `<!--[if mso]><table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1C1914" style="background:#1C1914;border:1px solid #2C2C2A;margin-bottom:18px;"><tr>${rows}</tr></table><![endif]--><!--[if !mso]><!--><table class="kpi-row" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1C1914" style="background:#1C1914;border:1px solid #2C2C2A;margin-bottom:18px;"><tr>${rows}</tr></table><!--<![endif]-->`;
  }

  function renderSection(sec, idx) {
    if (!sec || !sec.title) return '';
    const sectionLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
    const label = sec.label || sectionLabels[idx] || `0${idx + 1}`;
    const bg = idx % 2 === 0 ? '#F0EBE1' : '#F7F4EF';

    const kpisData = sec.kpis?.length
      ? sec.kpis
      : (sec.kpi_rows?.length ? sec.kpi_rows.map(k => ({ label: k.key, value: k.value, sub: k.sub })) : []);

    const kpiRow = renderKpiRow(kpisData);

    const verdict = toSentenceCase(sec.verdict || '');
    const verdictHtml = verdict ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1C1914" style="background:#1C1914;margin-top:18px;border-left:4px solid #E8C87A;">
        <tr><td style="padding:18px 20px;background:#1C1914;" bgcolor="#1C1914">
          <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#E8C87A;text-transform:uppercase;margin-bottom:10px;font-weight:700;">— La nostra lettura</div>
          <p style="font-family:Georgia,serif;font-size:15px;color:#FFFFFF;line-height:1.7;margin:0;font-weight:400;mso-line-height-rule:exactly;">${esc(verdict)}</p>
        </td></tr>
      </table>` : '';

    const bodyParas = Array.isArray(sec.body)
      ? sec.body
      : String(sec.body || '').split('\n\n').filter(p => p.trim());

    const bodyHtml = bodyParas.map(p =>
      `<p style="font-family:Georgia,serif;font-size:14px;color:#4C453D;font-weight:300;line-height:1.85;margin:0 0 14px;">${esc(p)}</p>`
    ).join('');

    return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background:${bg};border-bottom:2px solid #CEC3B2;">
      <tr><td style="padding:28px 28px 26px;background:${bg};" bgcolor="${bg}">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
          <tr>
            <td width="26" style="width:26px;">
              <div style="width:26px;height:26px;background:#1C1914;text-align:center;line-height:26px;font-family:'Courier New',monospace;font-size:9px;font-weight:700;color:#C8A97A;">${idx + 1}</div>
            </td>
            <td style="padding-left:10px;font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;vertical-align:middle;">${esc(label)}</td>
          </tr>
        </table>
        <h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1C1914;letter-spacing:-.4px;line-height:1.2;margin:0 0 18px;">${esc(sec.title)}</h2>
        ${kpiRow}
        ${bodyHtml}
        ${verdictHtml}
      </td></tr>
    </table>`;
  }

  function renderTesi(tesi = {}) {
    if (!tesi || (!tesi.headline && !tesi.top?.length && !tesi.mid?.length)) return '';
    const topItems = (tesi.top || []).map(t => `
      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#C8A97A;flex-shrink:0;margin-top:2px;">→</span>
        <span style="font-family:Georgia,serif;font-size:13px;color:rgba(255,255,255,0.6);font-weight:300;line-height:1.5;">${esc(t)}</span>
      </div>`).join('');
    const midItems = (tesi.mid || []).map(t => `
      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#777066;flex-shrink:0;margin-top:2px;">→</span>
        <span style="font-family:Georgia,serif;font-size:13px;color:rgba(255,255,255,0.35);font-weight:300;line-height:1.5;">${esc(t)}</span>
      </div>`).join('');

    if (!topItems && !midItems) return '';

    return `
    <div style="background:#1C1914;padding:30px 28px 28px;">
      <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.18em;color:#C8A97A;text-transform:uppercase;margin-bottom:16px;">— La tesi di Valore Atteso</div>
      <p style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#fff;line-height:1.35;margin:0 0 6px;letter-spacing:-.3px;">${esc(tesi.headline || '')}</p>
      <p style="font-family:Georgia,serif;font-size:13px;font-weight:300;color:rgba(255,255,255,0.45);line-height:1.75;margin:0 0 22px;font-style:italic;">${esc(tesi.intro || '')}</p>
      <div style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0;margin-bottom:24px;">
        <div style="padding-right:24px;">${topItems}</div>
        <div style="background:rgba(255,255,255,0.07);"></div>
        <div style="padding-left:24px;">${midItems}</div>
      </div>
    </div>`;
  }

  const sectionsHtml = sections.map((sec, i) => renderSection(sec, i)).join('');
  const tesiHtml = renderTesi(tesi);
  const mainSponsorHtml = sponsors
    .filter(sponsor => sponsor.slot_type === 'main')
    .map(renderSponsorEmail)
    .join('');
  const secondarySponsorHtml = sponsors
    .filter(sponsor => sponsor.slot_type === 'secondary')
    .map(renderSponsorEmail)
    .join('');

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)} — Valore Atteso #${esc(num)}</title>
<style>
@media (prefers-color-scheme: dark) {
  body, table, td, div, p, a { color: inherit !important; background-color: inherit !important; }
  body { background: #D8D0C4 !important; }
  .force-light { background: #D8D0C4 !important; }
}
@media only screen and (max-width:600px){
  table[width="640"]{width:100%!important;}
  .kpi-top td{display:block!important;width:100%!important;border-right:none!important;border-bottom:1px solid #CEC3B2!important;box-sizing:border-box!important;}
  .kpi-row td{padding:10px 8px!important;}
  .kpi-row td div:first-child{font-size:13px!important;white-space:nowrap!important;}
  h1{font-size:20px!important;letter-spacing:-.5px!important;}
  h2.subtitle{font-size:14px!important;}
  h2.section-title{font-size:17px!important;}
  .section-pad{padding:20px 18px 22px!important;}
  .verdict-text{font-size:13px!important;}
}
</style>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#D8D0C4;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;" data-ogsc bgcolor="#D8D0C4">

<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#F0EBE1;">
  ${esc(subtitle || opener || '')} · valoreatteso.com
</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#D8D0C4" style="background:#D8D0C4;">
<tr><td align="center" style="padding:0;">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#F0EBE1;">

  <!-- PREHEADER -->
  <tr><td style="background:#1C1914;padding:7px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.45);letter-spacing:.06em;">
        Problemi di visualizzazione? <a href="https://valoreatteso.com/archivio.html" style="color:#C8A97A;text-decoration:underline;">Leggi online</a>
      </td>
      <td align="right" style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.4);letter-spacing:.08em;text-transform:uppercase;">Valore Atteso</td>
    </tr></table>
  </td></tr>

  <!-- MASTHEAD -->
  <tr><td style="background:#F0EBE1;padding:18px 28px 16px;border-bottom:3px solid #1C1914;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:34px;height:34px;border:2px solid #1C1914;text-align:center;vertical-align:middle;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#1C1914;">VA</td>
          <td style="padding-left:14px;">
            <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-1px;color:#1C1914;line-height:1;">VALORE ATTESO</div>
            <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;margin-top:2px;">Il calcio dei numeri, non dei goal.</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:bottom;">
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.1em;text-transform:uppercase;">Edizione</div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#8E6B33;letter-spacing:-1px;line-height:1.1;">#${esc(num)}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;">${esc(date || '')}</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- HERO -->
  <tr><td style="background:#1C1914;padding:32px 28px 28px;">
    <div style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:.16em;color:#C8A97A;text-transform:uppercase;margin-bottom:12px;font-weight:700;">— Questa settimana</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:900;color:#FFFDF8;line-height:1.1;letter-spacing:-1px;margin:0 0 8px;">${esc(title)}</h1>
    ${subtitle ? `<h2 class="subtitle" style="font-family:Georgia,serif;font-size:16px;font-weight:400;font-style:italic;color:#C8A97A;line-height:1.3;margin:0 0 18px;">${esc(subtitle)}</h2>` : ''}
    ${opener ? `<div style="border-left:2px solid rgba(200,169,122,0.3);padding-left:14px;margin-bottom:20px;">
      <p style="font-family:Georgia,serif;font-size:13px;color:rgba(240,235,225,0.88);font-style:italic;line-height:1.8;margin:0;font-weight:400;">${esc(opener)}</p>
    </div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid rgba(200,169,122,0.2);margin-top:16px;">
      <tr><td style="padding-top:16px;text-align:center;">
        <p style="font-family:'Courier New',monospace;font-size:9px;color:#C8A97A;letter-spacing:.16em;text-transform:uppercase;margin:0 0 10px;font-weight:700;">— Condividi con un collega —</p>
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td width="50%" style="padding-right:6px;">
            <a href="https://wa.me/?text=Ho%20letto%20Valore%20Atteso%2C%20la%20newsletter%20sul%20business%20del%20calcio%20europeo.%20Vale%20la%20pena%3A%20valoreatteso.com" bgcolor="#F4EFE6" style="display:block;background:#F4EFE6;color:#1C1914;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:10px;text-decoration:none;text-align:center;font-weight:700;">WhatsApp →</a>
          </td>
          <td width="50%" style="padding-left:6px;">
            <a href="mailto:?subject=Valore%20Atteso%20%23${esc(num)}%20%E2%80%94%20${encodeURIComponent(edition.title)}&body=Ti%20condivido%20l%27ultima%20edizione%20di%20Valore%20Atteso%2C%20newsletter%20sul%20business%20del%20calcio%20europeo.%0A%0AQuesta%20settimana%3A%20${encodeURIComponent(edition.title)}%0A%0AIscriviti%20gratis%3A%20valoreatteso.com" bgcolor="#1C1914" style="display:block;background:#1C1914;color:#F4EFE6;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:10px;text-decoration:none;text-align:center;font-weight:700;border:1px solid #F4EFE6;">Email →</a>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  ${mainSponsorHtml ? `<tr><td>${mainSponsorHtml}</td></tr>` : ''}

  <!-- SEZIONI -->
  <tr><td>${sectionsHtml}</td></tr>

  ${secondarySponsorHtml ? `<tr><td>${secondarySponsorHtml}</td></tr>` : ''}

  <!-- TESI -->
  ${tesiHtml ? `<tr><td>${tesiHtml}</td></tr>` : ''}

  <!-- CTA -->
  <tr><td style="background:#1C1914;padding:32px 28px;text-align:center;">
    <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.12em;color:rgba(255,255,255,0.5);text-transform:uppercase;margin-bottom:12px;">Edizione #${esc(num)}</div>
    <p style="font-family:Georgia,serif;font-size:14px;color:rgba(255,255,255,0.55);font-weight:300;line-height:1.6;margin:0 0 20px;">Leggi l'analisi completa con tutti i dati nell'archivio.</p>
    <a href="${process.env.SITE_URL || 'https://valoreatteso.com'}/archivio.html" style="display:inline-block;background:#C8A97A;color:#1C1914;font-family:'Courier New',monospace;font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:12px 28px;text-decoration:none;">Leggi nell'archivio →</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#E7DFD2;border-top:3px solid #1C1914;padding:24px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding-bottom:16px;">
          <div style="font-family:Georgia,serif;font-size:15px;font-weight:900;color:#1C1914;letter-spacing:-.5px;margin-bottom:3px;">Valore Atteso</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;letter-spacing:.06em;">Il calcio dei numeri, non dei goal.</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #CEC3B2;padding-top:14px;">
      <tr>
        <td style="vertical-align:top;padding-bottom:16px;">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;">Seguici</div>
          <a href="https://instagram.com/valoreatteso" style="font-family:'Courier New',monospace;font-size:10px;color:#8E6B33;text-decoration:none;letter-spacing:.06em;font-weight:600;">@valoreatteso</a>
        </td>
        <td align="right" style="vertical-align:top;padding-bottom:16px;">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px;">Sito Web</div>
          <div style="font-family:'Courier New',monospace;font-size:10px;color:#8E6B33;margin-bottom:10px;">valoreatteso.com</div>
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px;">Contatti</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:#4C453D;">info@valoreatteso.com</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #CEC3B2;padding:22px 0 20px;text-align:center;">
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.12em;text-transform:uppercase;margin:0 0 6px;">Hai trovato utile questa analisi?</p>
        <p style="font-family:Georgia,serif;font-size:14px;color:#1C1914;margin:0 0 14px;line-height:1.5;">Condividila con un collega.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
          <tr>
            <td style="padding-right:8px;">
              <a href="https://wa.me/?text=Ho%20letto%20Valore%20Atteso%2C%20la%20newsletter%20sul%20business%20del%20calcio%20europeo.%20Vale%20la%20pena%3A%20valoreatteso.com" style="display:inline-block;background:#1C1914;color:#F4EFE6;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:10px 18px;text-decoration:none;">WhatsApp →</a>
            </td>
            <td>
              <a href="mailto:?subject=Valore%20Atteso%20%23${esc(num)}%20%E2%80%94%20${encodeURIComponent(edition.title)}&body=Ti%20condivido%20l%27ultima%20edizione%20di%20Valore%20Atteso%2C%20newsletter%20sul%20business%20del%20calcio%20europeo.%0A%0AQuesta%20settimana%3A%20${encodeURIComponent(edition.title)}%0A%0AIscriviti%20gratis%3A%20valoreatteso.com" style="display:inline-block;background:#F4EFE6;color:#1C1914;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:10px 18px;text-decoration:none;border:1px solid #1C1914;">Email →</a>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #CEC3B2;padding:14px 0 18px;text-align:center;">
        <p style="font-family:'Courier New',monospace;font-size:8.5px;color:#9A9690;letter-spacing:.04em;line-height:1.9;margin:0;">
          Hai ricevuto questa email perché sei iscritto a Valore Atteso.<br>
          Per cancellarti <a href="https://valoreatteso.com/cancella.html?email={{EMAIL}}" style="color:#777066;text-decoration:underline;">clicca qui</a>.
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

module.exports = { buildHtml };
