// api/_lib/email/render-html.js — HTML del template A2 generico (blocchi B0-B9, footer opzione 1).
// Riceve un contratto già validato: rende quello che riceve, non scrive contenuti.
// Solo tabelle annidate (Outlook), colori sia in bgcolor sia inline, un solo <style>.

const cfg = require('./config');
const { vaUrl, editionPath, whatsappHref, mailtoHref, contactHref } = require('./urls');
const { isPh } = require('./validate');
// I valori brevi non vanno a capo; un segnaposto lungo sì, per non allargare la mail.
const nowrap = v => (isPh(v) ? '' : 'white-space:nowrap;');

const C = {
  cream: '#F3EFE6', paper: '#FBF9F4', white: '#FFFFFF', ink: '#1C1914', text: '#2B2824', muted: '#4F545F',
  blue: '#00266E', blue200: '#C9D2EA', goldDark: '#E5962E', goldBar: '#D67F0D', goldRule: '#B08A4B',
  inkText2: '#C9C2B6', legal: '#A8A196', line: '#DDD3C2', line2: '#E7DFD2', lineDark: '#3A352E', sumRule: '#274681',
};
const FD = "'Playfair Display',Georgia,'Times New Roman',serif";
const FT = 'Inter,Arial,Helvetica,sans-serif';
const FM = "'IBM Plex Mono','Courier New',monospace";
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const NUM = 'font-variant-numeric:lining-nums;';
const DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad2 = n => String(n).padStart(2, '0');
const label = (size, color, extra = '') =>
  `font-family:${FM};font-size:${size}px;letter-spacing:.14em;text-transform:uppercase;color:${color};${extra}`;

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return esc(iso);
  return `${DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]} ${m[3]}.${m[2]}.${m[1]}`;
}

// ── B6a · KPI ibridi: si impilano anche senza media query ────────────────────
function kpiBlock(kpi) {
  if (!kpi.length) return '';
  const w = Math.floor(590 / kpi.length);
  const cells = kpi.map((k, i) => {
    const sep = i ? `border-left:1px solid ${C.line2};` : '';
    const mso = i ? `<!--[if mso]></td><td width="${w}" valign="top"><![endif]-->` : '';
    return `${mso}<div class="kpi${i ? '' : ' kpi-first'}" style="display:inline-block;width:100%;min-width:180px;max-width:196px;vertical-align:top;">
<table ${T} width="100%"><tr><td class="kpi-c ln" style="padding:14px 16px;${sep}">
<p class="ff-d kpi-v lk num" style="margin:0;font-family:${FD};font-size:24px;line-height:1.15;font-weight:700;color:${C.blue};${nowrap(k.value)}${NUM}">${esc(k.value)}</p>
<p class="ff-t kpi-l mu" style="margin:4px 0 0;font-family:${FT};font-size:12.5px;line-height:1.4;color:${C.muted};">${esc(k.label)}</p>
</td></tr></table></div>`;
  }).join('');
  return `<div class="kpiwrap box box-bd" style="font-size:0;line-height:0;border:1px solid ${C.line};border-top:3px solid ${C.blue};background:${C.white};margin:0 0 16px;">
<!--[if mso]><table ${T} width="590"><tr><td width="${w}" valign="top"><![endif]-->
${cells}
<!--[if mso]></td></tr></table><![endif]-->
</div>`;
}

// ── B6b-d · Moduli ──────────────────────────────────────────────────────────
function barsModule(m) {
  const nums = m.rows.map(r => (typeof r.value === 'number' ? r.value : 0));
  const max = Math.max(...nums, 1);
  const rows = m.rows.map((r, i) => {
    const pct = Math.max(1.2, Math.round(nums[i] / max * 1000) / 10);
    const bar = pct >= 100
      ? `<td width="100%" bgcolor="${C.blue}" height="18" class="bar" style="height:18px;font-size:0;line-height:0;background:${C.blue};">&nbsp;</td>`
      : `<td width="${pct}%" bgcolor="${C.blue}" height="18" class="bar" style="height:18px;font-size:0;line-height:0;background:${C.blue};">&nbsp;</td><td bgcolor="${C.line}" height="18" class="track" style="height:18px;font-size:0;line-height:0;background:${C.line};">&nbsp;</td>`;
    return `<tr>
<td class="bl ff-t t" width="110" style="width:110px;${nowrap(r.label)}font-family:${FT};font-size:13px;line-height:18px;color:${C.text};padding:6px 10px 6px 0;">${esc(r.label)}</td>
<td class="bv ff-d t num" width="96" style="width:96px;${nowrap(r.display)}font-family:${FD};font-size:15px;line-height:18px;font-weight:700;color:${C.ink};padding:6px 10px 6px 0;${NUM}">${esc(r.display)}</td>
<td class="bt" style="padding:6px 0;"><table ${T} width="100%"><tr>${bar}</tr></table></td>
</tr>`;
  }).join('');
  return `<table ${T} width="100%" class="box box-bd" bgcolor="${C.white}" style="background:${C.white};border:1px solid ${C.line};margin:0 0 18px;"><tr><td style="padding:14px 16px 10px;">
<p class="ff-m mu" style="margin:0 0 8px;${label(11, C.muted)}">${esc(m.title || '')}</p>
<table ${T} width="100%">${rows}</table>
</td></tr></table>`;
}

function dealModule(m) {
  const rows = m.rows.map(r => `<tr>
<td class="ff-m mu ln" width="38%" valign="top" style="width:38%;${label(11, C.muted, 'letter-spacing:.1em;')}line-height:16px;padding:11px 10px 11px 0;border-bottom:1px solid ${C.line2};word-break:break-word;">${esc(r.key)}</td>
<td class="ff-t t ln num" valign="top" style="font-family:${FT};font-size:14px;line-height:1.45;color:${C.ink};padding:9px 0;border-bottom:1px solid ${C.line2};word-break:break-word;${NUM}">${esc(r.value)}</td>
</tr>`).join('');
  return `<table ${T} width="100%" style="margin:0 0 18px;">
<tr><td colspan="2" class="ff-m t rule-ink" style="${label(11, C.ink)}font-weight:600;padding:0 0 8px;border-bottom:2px solid ${C.ink};">${esc(m.title || 'Scheda del deal')}</td></tr>
${rows}</table>`;
}

function vsModule(m) {
  const head = `<tr>
<td class="rule-ink" width="38%" style="width:38%;border-bottom:2px solid ${C.ink};padding:0 0 8px;">&nbsp;</td>
${m.columns.map(col => `<td class="ff-m t rule-ink" width="31%" style="width:31%;${label(11, C.ink)}font-weight:600;padding:0 6px 8px 0;border-bottom:2px solid ${C.ink};word-break:break-word;">${esc(col)}</td>`).join('')}
</tr>`;
  const rows = m.rows.map(r => `<tr>
<td class="ff-m mu ln" valign="top" style="${label(11, C.muted, 'letter-spacing:.1em;')}line-height:16px;padding:11px 8px 11px 0;border-bottom:1px solid ${C.line2};word-break:break-word;">${esc(r.label)}</td>
${[r.a, r.b].map(v => `<td class="ff-d lk ln num" valign="top" style="font-family:${FD};font-size:16px;line-height:1.3;font-weight:700;color:${C.blue};padding:9px 6px 9px 0;border-bottom:1px solid ${C.line2};word-break:break-word;${NUM}">${esc(v)}</td>`).join('')}
</tr>`).join('');
  const note = m.note
    ? `<tr><td colspan="3" class="ff-t mu" style="font-family:${FT};font-size:12px;line-height:1.5;color:${C.muted};padding:8px 0 0;">${esc(m.note)}</td></tr>`
    : '';
  return `<table ${T} width="100%" style="margin:0 0 18px;">${head}${rows}${note}</table>`;
}

const MODULES = { bars: barsModule, deal: dealModule, vs: vsModule, none: () => '' };

// ── B6 · Sezione ────────────────────────────────────────────────────────────
function section(s) {
  const paras = s.body.map(p => `<p class="ff-t t" style="margin:0 0 16px;font-family:${FT};font-size:15.5px;line-height:1.65;color:${C.text};">${esc(p)}</p>`).join('\n');
  const sources = s.sources.map(x => `<a class="lk" href="${esc(x.url)}" target="_blank" style="color:${C.blue};text-decoration:underline;">${esc(x.testo)}</a>`).join(' &middot; ');
  return `<tr><td class="px ln" id="s${s.n}" style="padding:30px 24px 24px;border-top:1px solid ${C.line};">
<a name="s${s.n}"></a>
<table ${T}><tr>
<td class="ff-d lk num" valign="bottom" style="font-family:${FD};font-size:34px;line-height:1;font-weight:700;color:${C.blue};padding:0 12px 0 0;${NUM}">${pad2(s.n)}</td>
<td class="ff-m mu lbl" valign="bottom" style="${label(11, C.muted)}padding:0 0 5px;">${esc(s.label)}</td>
</tr></table>
<h2 class="ff-d h2 t" style="margin:12px 0 18px;font-family:${FD};font-size:23px;line-height:1.22;font-weight:700;color:${C.ink};">${esc(s.title)}</h2>
${kpiBlock(s.kpi)}${MODULES[s.module.type](s.module)}
${paras}
<table ${T} width="100%" class="rd bdi" style="margin:4px 0 0;"><tr>
<td width="4" bgcolor="${C.goldBar}" style="width:4px;background:${C.goldBar};font-size:0;line-height:0;">&nbsp;</td>
<td class="rd-c" bgcolor="${C.ink}" style="background:${C.ink};padding:18px 20px;">
<p class="ff-m lbl" style="margin:0 0 8px;${label(11, C.goldDark)}font-weight:600;">${esc(cfg.copy.reading)}</p>
<p class="ff-t" style="margin:0;font-family:${FT};font-size:16px;line-height:1.55;color:${C.cream};">${esc(s.reading)}</p>
</td></tr></table>
<p id="fonti-s${s.n}" class="ff-t mu" style="margin:12px 0 0;font-family:${FT};font-size:12.5px;line-height:1.6;color:${C.muted};"><span class="ff-m t" style="${label(11, C.ink)}font-weight:600;">${esc(cfg.copy.sources)}</span>&nbsp; ${sources}</p>
</td></tr>`;
}

// ── B5 · In sintesi ─────────────────────────────────────────────────────────
function summary(c) {
  const rows = c.summary.map((r, i) => `<tr><td style="padding:12px 0;${i ? `border-top:1px solid ${C.sumRule};` : ''}">
<table ${T} width="100%"><tr>
<td class="sum-num ff-d num" width="132" valign="top" style="width:132px;font-family:${FD};font-size:26px;line-height:1.1;font-weight:700;color:${C.cream};padding:0 12px 0 0;word-break:break-word;${NUM}">${esc(r.number)}</td>
<td class="sum-txt" valign="top">
<p class="ff-m lbl" style="margin:0 0 4px;${label(11, C.goldDark)}">${pad2(r.section_n)} &middot; ${esc(r.label)}</p>
<p class="ff-t" style="margin:0;font-family:${FT};font-size:14.5px;line-height:1.5;color:${C.blue200};">${esc(r.thesis)} <a href="#s${r.section_n}" style="display:inline-block;padding:12px 0;margin:-12px 0;color:${C.cream};font-weight:600;text-decoration:none;white-space:nowrap;">${esc(cfg.copy.readMore)}</a></p>
</td></tr></table>
</td></tr>`).join('');
  return `<tr><td class="px sum-wrap" style="padding:18px 24px;">
<table ${T} width="100%" class="bdb" bgcolor="${C.blue}" style="background:${C.blue};"><tr><td class="sum-box" style="padding:16px 20px 4px;">
<p class="ff-m lbl" style="margin:0;${label(11, C.goldDark)}font-weight:600;">${esc(cfg.copy.summaryTitle)}</p>
<table ${T} width="100%">${rows}</table>
</td></tr></table>
</td></tr>`;
}

// ── B7 · Cosa guardare ──────────────────────────────────────────────────────
function watch(c) {
  const items = c.watch.map(w => `<tr>
<td width="14" valign="top" class="ff-t lk" style="width:14px;font-family:${FT};font-size:15px;line-height:1.55;color:${C.blue};">&bull;</td>
<td valign="top" class="ff-t t" style="font-family:${FT};font-size:15px;line-height:1.55;color:${C.text};padding:0 0 10px;"><span class="ff-m lk lbl" style="${label(11, C.blue)}font-weight:600;">${esc(w.label)}</span>&nbsp; ${esc(w.text)}</td>
</tr>`).join('');
  return `<tr><td class="px" style="padding:8px 24px 28px;">
<table ${T} width="100%"><tr><td class="rule-ink" style="border-top:3px solid ${C.ink};padding:14px 0 0;">
<p class="ff-m lk lbl" style="margin:0 0 12px;${label(11, C.blue)}font-weight:600;">${esc(cfg.copy.watchTitle)}</p>
<table ${T} width="100%">${items}</table>
</td></tr></table>
</td></tr>`;
}

// ── B8 · Inoltro, B8b · filetto oro, B9 · footer (opzione 1) ─────────────────
function button(href, text, solid) {
  const bg = solid ? C.cream : C.blue;
  const fg = solid ? C.blue : C.cream;
  return `<table ${T} width="100%"><tr><td align="center" bgcolor="${bg}" style="background:${bg};border:1px solid ${C.cream};mso-padding-alt:14px 12px;">
<a href="${esc(href)}" target="_blank" style="display:block;padding:15px 12px;font-family:${FM};font-size:12px;line-height:16px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;color:${fg};" class="ff-m">${esc(text)}</a>
</td></tr></table>`;
}

function shareAndFooter(c, img) {
  const e = c.edition;
  const fl = (href, text) => `<div class="lg" style="display:inline-block;width:100%;max-width:148px;vertical-align:top;"><table ${T} width="100%"><tr><td align="left" style="border-top:1px solid ${C.lineDark};padding:0 8px 0 0;"><a href="${esc(href)}" target="_blank" class="ff-t" style="display:block;padding:13px 0;font-family:${FT};font-size:14px;line-height:18px;font-weight:600;color:${C.cream};text-decoration:none;">${esc(text)}</a></td></tr></table></div>`;
  const links = [
    [vaUrl(editionPath(e), 'footer_leggi_online', e), cfg.copy.linkOnline],
    [vaUrl('/archivio', 'footer_archivio', e), cfg.copy.linkArchive],
    // La pagina web dell'edizione non ha ancora id="fonti": niente ancora (§3.12).
    [vaUrl(editionPath(e), 'footer_fonti', e), cfg.copy.linkSources],
  ];
  const grid = links.map(([h, t], i) => `${i ? '<!--[if mso]></td><td width="148" valign="top"><![endif]-->' : ''}${fl(h, t)}`).join('');
  const legalP = (inner, last) => `<p class="ff-t" style="margin:0 0 ${last ? 0 : 8}px;font-family:${FT};font-size:12px;line-height:1.6;color:${C.legal};">${inner}</p>`;
  const mono12 = s => `<span class="ff-m" style="font-family:${FM};font-size:12px;color:${C.legal};">${s}</span>`;

  return `<tr><td class="px bdb" bgcolor="${C.blue}" style="background:${C.blue};padding:28px 24px 14px;">
<p class="ff-d" style="margin:0 0 6px;font-family:${FD};font-size:21px;line-height:1.3;font-weight:700;color:${C.cream};text-align:center;">${esc(c.share.headline)}</p>
<p class="ff-t" style="margin:0 0 18px;font-family:${FT};font-size:13px;line-height:1.5;color:${C.blue200};text-align:center;">${esc(c.share.subline)}</p>
<table ${T} width="100%"><tr>
<td class="stack" width="50%" valign="top" style="padding:0 4px 8px 0;">${button(whatsappHref(c), cfg.copy.shareWhatsapp, true)}</td>
<td class="stack" width="50%" valign="top" style="padding:0 0 8px 4px;">${button(mailtoHref(c), cfg.copy.shareEmail, false)}</td>
</tr></table>
<p class="ff-t" style="margin:6px 0 0;font-family:${FT};font-size:13px;line-height:20px;color:${C.blue200};text-align:center;">${esc(cfg.copy.forwarded)} <a href="${esc(vaUrl('/', 'inoltrata_iscriviti', e))}" target="_blank" style="display:inline-block;padding:12px 2px;color:${C.cream};font-weight:600;text-decoration:underline;">${esc(cfg.copy.signup)}</a></p>
</td></tr>
<tr><td bgcolor="${C.goldBar}" height="3" style="height:3px;line-height:3px;font-size:0;background:${C.goldBar};">&nbsp;</td></tr>
<tr><td class="px bdi" bgcolor="${C.ink}" style="background:${C.ink};padding:30px 24px 26px;">
<table ${T} width="100%"><tr>
<td class="stack" valign="middle" width="200" style="width:200px;padding:0 0 18px;"><a href="${esc(vaUrl('/', 'footer_logo', e))}" target="_blank" style="text-decoration:none;display:inline-block;">${img.lockup}</a></td>
<td class="stack" valign="middle" style="padding:0 0 18px;"><p class="ff-d" style="margin:0;font-family:${FD};font-style:italic;font-size:17px;line-height:1.45;color:${C.inkText2};">${esc(cfg.copy.tagline)}</p></td>
</tr></table>
<div style="font-size:0;line-height:0;text-align:left;"><!--[if mso]><table ${T} width="444" align="left"><tr><td width="148" valign="top"><![endif]-->${grid}<!--[if mso]></td></tr></table><![endif]--></div>
<table ${T} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:0;border-top:1px solid ${C.lineDark};">&nbsp;</td></tr></table>
<p class="ff-t" style="margin:6px 0 10px;font-family:${FT};font-size:13px;line-height:20px;color:${C.inkText2};">${esc(cfg.copy.contact)} <a href="${esc(contactHref(e))}" style="display:inline-block;padding:12px 0;color:${C.cream};font-weight:600;text-decoration:underline;">${esc(cfg.copy.contactEmail)}</a></p>
<table ${T} width="100%"><tr><td height="1" style="height:1px;line-height:1px;font-size:0;border-top:1px solid ${C.lineDark};">&nbsp;</td></tr></table>
<div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
${legalP(`${esc(cfg.copy.legalReceived)} ${mono12('{{EMAIL_TEXT}}')}.`)}
${legalP(esc(cfg.copy.legalAi))}
${legalP(`${esc(cfg.copy.legalOwner)} ${mono12(esc(cfg.legal.titolare))}, ${mono12(esc(cfg.legal.indirizzo))} &middot; <a href="${cfg.site}${cfg.legal.privacyPath}" target="_blank" style="display:inline-block;padding:12px 0;line-height:20px;color:${C.cream};text-decoration:underline;">${esc(cfg.copy.privacy)}</a>`)}
${legalP(`${esc(cfg.copy.unsubscribeLead)} <a href="${cfg.unsubscribeUrl}" target="_blank" style="display:inline-block;padding:12px 0;line-height:20px;color:${C.cream};font-weight:600;text-decoration:underline;">${esc(cfg.copy.unsubscribe)}</a>`, true)}
</td></tr>`;
}

// ── Documento ───────────────────────────────────────────────────────────────
function renderHtml(c, opts = {}) {
  const base = opts.assetBase || cfg.logos.baseUrl;
  const L = cfg.logos;
  const img = {
    monogram: `<img src="${esc(base + L.monogram.file)}" width="${L.monogram.width}" height="${L.monogram.height}" alt="Valore Atteso" style="display:block;width:${L.monogram.width}px;height:${L.monogram.height}px;border:0;outline:none;text-decoration:none;font-family:Georgia,serif;font-size:16px;line-height:44px;color:${C.cream};">`,
    lockup: `<img src="${esc(base + L.lockup.file)}" width="${L.lockup.width}" height="${L.lockup.height}" alt="Valore Atteso" style="display:block;width:${L.lockup.width}px;height:${L.lockup.height}px;border:0;outline:none;text-decoration:none;font-family:Georgia,serif;font-size:20px;line-height:60px;color:${C.cream};">`,
  };
  const filler = '&zwnj;&nbsp;'.repeat(90);
  const sponsor = c.sponsor
    ? `<tr><td class="px box" align="center" bgcolor="${C.paper}" style="background:${C.paper};border-bottom:1px dashed ${C.goldRule};padding:0 24px;"><a href="${esc(c.sponsor.url)}" target="_blank" class="ff-m mu" style="display:inline-block;padding:14px 0;${label(11, C.muted)}text-decoration:none;">${esc(cfg.copy.sponsorLead)} &middot; ${esc(c.sponsor.name)}</a></td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="it" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(c.title)} · Valore Atteso #${esc(c.edition)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>.ff-d{font-family:Georgia,serif !important;}.ff-t{font-family:Arial,sans-serif !important;}.ff-m{font-family:'Courier New',monospace !important;}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
img{-ms-interpolation-mode:bicubic;}
a{text-decoration-skip-ink:auto;}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
.num{font-variant-numeric:lining-nums !important;}
@media only screen and (max-width:600px){
.wrap{width:100% !important;}
.px{padding-left:16px !important;padding-right:16px !important;}
.hide-m{display:none !important;}
.lead{padding-top:20px !important;}
.h1{font-size:25px !important;}
.h2{font-size:21px !important;}
.wm{font-size:22px !important;}
.motto{letter-spacing:.08em !important;}
.lbl{font-size:11.5px !important;}
.stack{display:block !important;width:100% !important;box-sizing:border-box;padding-left:0 !important;padding-right:0 !important;}
.sum-wrap{padding-top:16px !important;padding-bottom:16px !important;}
.sum-box{padding:16px 16px 4px !important;}
.sum-num{display:block !important;width:100% !important;padding:0 0 6px !important;font-size:24px !important;}
.sum-txt{display:block !important;width:100% !important;}
.kpi{display:block !important;max-width:none !important;}
.kpi-c{padding:9px 12px !important;border-left:0 !important;border-top:1px solid ${C.line2} !important;}
.kpi-first .kpi-c{border-top:0 !important;}
.kpi-v{display:inline-block !important;width:44%;vertical-align:middle;font-size:21px !important;}
.kpi-l{display:inline-block !important;width:54%;vertical-align:middle;text-align:right;margin:0 !important;}
.bl{display:inline-block !important;width:60% !important;box-sizing:border-box;}
.bv{display:inline-block !important;width:38% !important;box-sizing:border-box;text-align:right;padding-right:0 !important;}
.bt{display:block !important;width:100% !important;padding:2px 0 10px !important;}
.rd-c{padding:16px !important;}
.lg{max-width:50% !important;}
}
@media (prefers-color-scheme:dark){
.pg{background:#121110 !important;}
.pg-pad{padding-bottom:24px !important;}
.box{background:#1F1C18 !important;}
.box-bd,.ln{border-color:${C.lineDark} !important;}
.t{color:#EDE7DB !important;}
.mu{color:#B9B1A4 !important;}
.lk{color:#9DB4F0 !important;}
.bar{background:#9DB4F0 !important;}
.track{background:#2A2621 !important;}
.kpiwrap{border-top-color:#9DB4F0 !important;}
.rule-ink{border-color:#EDE7DB !important;}
.bdb{border:1px solid #2E4A8F !important;}
.bdi{border:1px solid ${C.lineDark} !important;}
}
[data-ogsb] .pg{background:#121110 !important;}
[data-ogsb] .box{background:#1F1C18 !important;}
[data-ogsb] .bar{background:#9DB4F0 !important;}
[data-ogsb] .track{background:#2A2621 !important;}
[data-ogsc] .t{color:#EDE7DB !important;}
[data-ogsc] .mu{color:#B9B1A4 !important;}
[data-ogsc] .lk{color:#9DB4F0 !important;}
</style>
</head>
<body class="pg" bgcolor="${C.cream}" style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.cream};opacity:0;">${esc(c.preheader)}${filler}</div>
<table ${T} width="100%" class="pg" bgcolor="${C.cream}" style="background:${C.cream};"><tr><td class="pg-pad" align="center" style="padding:0;">
<!--[if mso]><table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table ${T} width="100%" class="wrap" style="max-width:640px;">

<tr><td class="px" bgcolor="${C.ink}" style="background:${C.ink};padding:9px 24px;">
<table ${T} width="100%"><tr>
<td class="ff-m" style="${label(11, C.inkText2)}">Edizione #${esc(c.edition)} &middot; ${esc(c.read_min)} min</td>
<td class="ff-m hide-m" align="right" style="${label(11, C.inkText2)}">${formatDate(c.date)}</td>
</tr></table>
</td></tr>

<tr><td class="hd px" bgcolor="${C.blue}" style="background:${C.blue};padding:22px 24px 20px;">
<table ${T}><tr>
<td valign="middle" style="padding:0 14px 0 0;"><a href="${esc(vaUrl('/', 'testata_logo', c.edition))}" target="_blank" style="text-decoration:none;">${img.monogram}</a></td>
<td valign="middle">
<p class="ff-d wm" style="margin:0;font-family:${FD};font-size:26px;line-height:1.1;font-weight:700;letter-spacing:.04em;color:${C.cream};">VALORE ATTESO</p>
<p class="ff-m motto" style="margin:4px 0 0;${label(11, C.goldDark)}">${esc(cfg.copy.motto)}</p>
</td></tr></table>
</td></tr>
${sponsor}
<tr><td class="px lead" style="padding:28px 24px 0;">
<p class="ff-m mu lbl" style="margin:0 0 10px;${label(11, C.muted)}">&mdash; ${esc(c.kicker)}</p>
<h1 class="ff-d h1 t" style="margin:0 0 12px;font-family:${FD};font-size:30px;line-height:1.15;font-weight:700;color:${C.ink};">${esc(c.title)}</h1>
<p class="ff-t t" style="margin:0;font-family:${FT};font-size:16px;line-height:1.55;color:${C.text};">${esc(c.dek)}</p>
${c.intro ? `<p class="ff-t t" style="margin:12px 0 0;font-family:${FT};font-size:15.5px;line-height:1.65;color:${C.text};">${esc(c.intro)}</p>` : ''}
</td></tr>
${summary(c)}
${c.sections.map(section).join('\n')}
${watch(c)}
${shareAndFooter(c, img)}

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;
}

module.exports = { renderHtml, formatDate };
