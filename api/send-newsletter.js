// api/send-newsletter.js
// CommonJS — Vercel serverless function
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const resend = new Resend(process.env.RESEND_KEY);

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
  const { num, title, subtitle, date, opener, sections = [], tesi, monitoring = [] } = edition;

  const s1 = sections[0] || {};
  const s2 = sections[1] || {};
  const s3 = sections[2] || {};

  // KPI bar top — prende primo kpi da ogni sezione
  const kpiBar = [
    { label: '— ' + (s1.label || 'Il Bilancio'), value: s1.kpis?.[0]?.value || '', sub: s1.kpis?.[0]?.sub || '' },
    { label: '— ' + (s2.label || 'Il Deal'),     value: s2.kpis?.[0]?.value || '', sub: s2.kpis?.[0]?.sub || '' },
    { label: '— ' + (s3.label || 'La Metrica'),  value: s3.kpis?.[0]?.value || '', sub: s3.kpis?.[0]?.sub || '' },
  ];

  function renderKpiBar(items) {
    return items.map((k, i) => {
      const border = i < 2 ? 'border-right:1px solid #CEC3B2;' : '';
      return `<td style="padding:20px 24px;${border}vertical-align:top;">
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.14em;color:#777066;text-transform:uppercase;margin-bottom:10px;">${esc(k.label)}</div>
        <div style="font-family:Georgia,serif;font-size:30px;font-weight:900;color:#1C1914;letter-spacing:-1px;line-height:1;margin-bottom:5px;">${esc(k.value)}</div>
        <div style="font-family:Georgia,serif;font-size:12px;color:#8E6B33;font-style:italic;">${esc(k.sub)}</div>
      </td>`;
    }).join('');
  }

  function renderKpiRow(kpis) {
    if (!kpis || !kpis.length) return '';
    const rows = kpis.slice(0, 3).map((k, i) => {
      const border = i < Math.min(kpis.length, 3) - 1 ? 'border-right:1px solid #CEC3B2;' : '';
      const sub = k.sub ? `<div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;margin-top:3px;">${esc(k.sub)}</div>` : '';
      return `<td style="padding:16px 18px;${border}vertical-align:top;width:33%;">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#1C1914;letter-spacing:-.5px;line-height:1;margin-bottom:5px;">${esc(k.value)}</div>
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.04em;text-transform:uppercase;line-height:1.4;">${esc(k.label)}</div>
        ${sub}
      </td>`;
    }).join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E7DFD2;border:1px solid #CEC3B2;margin-bottom:18px;">
      <tr>${rows}</tr>
    </table>`;
  }

  function renderSection(sec, idx) {
    if (!sec || !sec.title) return '';
    const sectionLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
    const label = sec.label || sectionLabels[idx] || `0${idx + 1}`;
    const bg = idx % 2 === 0 ? '#F0EBE1' : '#F7F4EF';

    // Supporta sia kpis che kpi_rows
    const kpisData = sec.kpis?.length
      ? sec.kpis
      : (sec.kpi_rows?.length ? sec.kpi_rows.map(k => ({ label: k.key, value: k.value, sub: k.sub })) : []);

    const kpiRow = renderKpiRow(kpisData);

    const verdict = toSentenceCase(sec.verdict || '');
    const verdictHtml = verdict ? `
      <div style="margin-top:18px;background:#1C1914;padding:18px 20px;border-left:3px solid #C8A97A;">
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.16em;color:#C8A97A;text-transform:uppercase;margin-bottom:10px;">— La nostra lettura</div>
        <p style="font-family:Georgia,serif;font-size:15px;color:#FFFDF8;line-height:1.65;margin:0;font-weight:400;">${esc(verdict)}</p>
      </div>` : '';

    const bodyParas = Array.isArray(sec.body)
      ? sec.body
      : String(sec.body || '').split('\n\n').filter(p => p.trim());

    const bodyHtml = bodyParas.map(p =>
      `<p style="font-family:Georgia,serif;font-size:14px;color:#4C453D;font-weight:300;line-height:1.85;margin:0 0 14px;">${esc(p)}</p>`
    ).join('');

    return `
    <div style="background:${bg};padding:28px 28px 26px;border-bottom:2px solid #CEC3B2;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="width:26px;height:26px;background:#1C1914;border-radius:50%;text-align:center;line-height:26px;font-family:'Courier New',monospace;font-size:9px;font-weight:700;color:#C8A97A;">${idx + 1}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;">${esc(label)}</div>
        <div style="flex:1;height:1px;background:#CEC3B2;"></div>
      </div>
      <h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1C1914;letter-spacing:-.4px;line-height:1.2;margin:0 0 18px;">${esc(sec.title)}</h2>
      ${kpiRow}
      ${bodyHtml}
      ${verdictHtml}
    </div>`;
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

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(title)} — Valore Atteso #${esc(num)}</title>
<style>
@media only screen and (max-width:600px){
  table[width="640"]{width:100%!important;}
  .kpi-top td,.kpi-row td{display:block!important;width:100%!important;border-right:none!important;border-bottom:1px solid #CEC3B2!important;}
  h1{font-size:20px!important;letter-spacing:-.5px!important;}
  h2.subtitle{font-size:14px!important;}
  h2.section-title{font-size:17px!important;}
  .section-pad{padding:20px 18px 22px!important;}
  .verdict-text{font-size:13px!important;}
}
</style>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#D8D0C4;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#F0EBE1;">
  ${esc(subtitle || opener || '')} · valoreatteso.com
</div>

<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;margin:0 auto;background:#F0EBE1;">

  <!-- PREHEADER -->
  <tr><td style="background:#1C1914;padding:7px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.3);letter-spacing:.06em;">
        Se non visualizzi correttamente — <a href="{{WEBVIEW_URL}}" style="color:#C8A97A;text-decoration:none;">clicca qui</a>
      </td>
      <td align="right" style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.2);">valoreatteso.com</td>
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
    <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#8E6B33;text-transform:uppercase;margin-bottom:12px;">— Questa settimana</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:900;color:#FFFDF8;line-height:1.1;letter-spacing:-1px;margin:0 0 8px;">${esc(title)}</h1>
    ${subtitle ? `<h2 class="subtitle" style="font-family:Georgia,serif;font-size:16px;font-weight:400;font-style:italic;color:#C8A97A;line-height:1.3;margin:0 0 18px;">${esc(subtitle)}</h2>` : ''}
    ${opener ? `<div style="border-left:2px solid rgba(200,169,122,0.3);padding-left:14px;">
      <p style="font-family:Georgia,serif;font-size:13px;color:rgba(240,235,225,0.55);font-style:italic;line-height:1.8;margin:0;font-weight:300;">${esc(opener)}</p>
    </div>` : ''}
  </td></tr>

  <!-- KPI BAR -->
  <tr><td style="background:#E7DFD2;border-bottom:1px solid #CEC3B2;">
    <table class="kpi-top" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${renderKpiBar(kpiBar)}</tr>
    </table>
  </td></tr>

  <!-- SEZIONI -->
  <tr><td>${sectionsHtml}</td></tr>

  <!-- TESI -->
  ${tesiHtml ? `<tr><td>${tesiHtml}</td></tr>` : ''}

  <!-- CTA -->
  <tr><td style="background:#1C1914;padding:32px 28px;text-align:center;">
    <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.16em;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-bottom:12px;">Valore Atteso · Edizione #${esc(num)}</div>
    <p style="font-family:Georgia,serif;font-size:14px;color:rgba(255,255,255,0.55);font-weight:300;line-height:1.6;margin:0 0 20px;">Leggi l'analisi completa con tutti i dati nell'archivio.</p>
    <a href="${process.env.SITE_URL || 'https://valoreatteso.com'}/archivio.html" style="display:inline-block;background:#C8A97A;color:#1C1914;font-family:'Courier New',monospace;font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:12px 28px;text-decoration:none;">Leggi nell'archivio →</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#E7DFD2;border-top:3px solid #1C1914;padding:22px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="33%" style="border-right:1px solid #CEC3B2;padding-right:20px;vertical-align:top;">
          <div style="font-family:Georgia,serif;font-size:15px;font-weight:900;color:#1C1914;letter-spacing:-.5px;margin-bottom:3px;">Valore Atteso</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;letter-spacing:.06em;line-height:1.6;">Il calcio dei numeri,<br>non dei goal.</div>
        </td>
        <td width="33%" align="center" style="border-right:1px solid #CEC3B2;vertical-align:middle;">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.14em;text-transform:uppercase;margin-bottom:9px;">Seguici</div>
          <table cellpadding="0" cellspacing="0" border="0" align="center"><tr>
            <td style="padding-right:8px;">
              <a href="https://instagram.com/valoreatteso" style="display:block;width:28px;height:28px;border:1px solid #CEC3B2;background:#F0EBE1;text-align:center;line-height:28px;text-decoration:none;">
                <img src="https://valoreatteso.com/icons/ig.png" width="12" height="12" alt="Instagram" style="vertical-align:middle;">
              </a>
            </td>
            <td>
              <a href="https://linkedin.com/company/valoreatteso" style="display:block;width:28px;height:28px;border:1px solid #CEC3B2;background:#F0EBE1;text-align:center;line-height:28px;text-decoration:none;">
                <img src="https://valoreatteso.com/icons/li.png" width="12" height="12" alt="LinkedIn" style="vertical-align:middle;">
              </a>
            </td>
          </tr></table>
        </td>
        <td width="33%" style="padding-left:20px;vertical-align:middle;">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px;">Sito Web</div>
          <div style="font-family:'Courier New',monospace;font-size:10px;color:#8E6B33;margin-bottom:8px;">valoreatteso.com</div>
          <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px;">Contatti</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:#4C453D;">info@valoreatteso.com</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #CEC3B2;padding:14px 0 18px;text-align:center;">
        <p style="font-family:'Courier New',monospace;font-size:8.5px;color:#9A9690;letter-spacing:.04em;line-height:1.9;margin:0;">
          Hai ricevuto questa email perché sei iscritto a Valore Atteso.<br>
          Puoi aggiornare le tue <a href="{{PREFS_URL}}" style="color:#777066;text-decoration:underline;">preferenze</a> o
          <a href="{{UNSUB_URL}}" style="color:#777066;text-decoration:underline;">disiscriverti</a> in qualsiasi momento.
        </p>
      </td></tr>
    </table>
  </td></tr>

</table>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { edition_num, edition_id } = req.body;

    let query = supabase.from('editions').select('*').eq('published', true);
    if (edition_id) query = query.eq('id', edition_id);
    else if (edition_num) query = query.eq('num', String(edition_num).padStart(3, '0'));
    else return res.status(400).json({ error: 'Parametro edition_num o edition_id obbligatorio' });

    const { data: editions, error: edErr } = await query.limit(1);
    if (edErr) throw new Error('Supabase: ' + edErr.message);
    if (!editions || !editions.length) throw new Error('Edizione non trovata o non pubblicata');
    const edition = editions[0];

    const { data: subs, error: subErr } = await supabase
      .from('subscribers')
      .select('email')
      .eq('confirmed', true);
    if (subErr) throw new Error('Supabase subscribers: ' + subErr.message);
    if (!subs || !subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'Nessun iscritto confermato' });

    const html = buildHtml(edition);
    const subject = `#${edition.num} — ${edition.title}`;

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

    await supabase
      .from('editions')
      .update({ sent_at: new Date().toISOString(), sent_count: sent })
      .eq('id', edition.id);

    await supabase.from('agent_runs').insert({
      agent: 'send-newsletter',
      status: errors === 0 ? 'success' : 'partial',
      summary: `Edizione #${edition.num} inviata a ${sent} iscritti. Errori: ${errors}.`,
      data: { edition_num: edition.num, sent, errors },
    });

    return res.status(200).json({ ok: true, edition: `#${edition.num}`, sent, errors });

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
