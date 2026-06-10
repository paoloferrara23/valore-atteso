const { renderSponsorEmail } = require('./sponsor-renderer');

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSection(section, index) {
  if (!section) return '';
  const body = Array.isArray(section.body)
    ? section.body.join('\n\n')
    : String(section.body || '');
  const paragraphs = body.split(/\n{2,}/).filter(Boolean).map((paragraph) => (
    `<p style="font-family:Georgia,serif;font-size:14px;color:#4C453D;line-height:1.8;margin:0 0 14px;">${esc(paragraph)}</p>`
  )).join('');
  return `
    <tr><td style="padding:26px 28px;background:${index % 2 ? '#F7F4EF' : '#F0EBE1'};border-bottom:1px solid #CEC3B2;">
      <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.14em;color:#8E6B33;text-transform:uppercase;margin-bottom:10px;">${esc(section.label || `Sezione ${index + 1}`)}</div>
      <h2 style="font-family:Georgia,serif;font-size:20px;color:#1C1914;line-height:1.2;margin:0 0 16px;">${esc(section.title)}</h2>
      ${paragraphs}
    </td></tr>`;
}

function buildSponsorPreviewHtml(edition) {
  const sponsors = edition.sponsors || [];
  const main = sponsors.filter((sponsor) => sponsor.slot_type === 'main').map(renderSponsorEmail).join('');
  const secondary = sponsors.filter((sponsor) => sponsor.slot_type === 'secondary').map(renderSponsorEmail).join('');
  const sections = (edition.sections || []).map(renderSection).join('');

  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Preview sponsor</title></head>
<body style="margin:0;padding:0;background:#D8D0C4;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#D8D0C4">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#F0EBE1;">
  <tr><td style="background:#1C1914;padding:7px 28px;color:#C8A97A;font-family:'Courier New',monospace;font-size:9px;">PREVIEW · VALORE ATTESO</td></tr>
  <tr><td style="padding:18px 28px;border-bottom:3px solid #1C1914;">
    <table width="100%"><tr><td style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#1C1914;">VALORE ATTESO</td><td align="right" style="font-family:Georgia,serif;font-size:19px;font-weight:900;color:#8E6B33;">#${esc(edition.num)}</td></tr></table>
  </td></tr>
  <tr><td style="background:#1C1914;padding:32px 28px 28px;">
    <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8A97A;text-transform:uppercase;margin-bottom:12px;">Questa settimana</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;color:#FFFDF8;line-height:1.1;margin:0 0 10px;">${esc(edition.title)}</h1>
    ${edition.subtitle ? `<div style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:#C8A97A;margin-bottom:16px;">${esc(edition.subtitle)}</div>` : ''}
    ${edition.opener ? `<p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:rgba(240,235,225,.88);line-height:1.8;margin:0;">${esc(edition.opener)}</p>` : ''}
  </td></tr>
  ${main ? `<tr><td>${main}</td></tr>` : ''}
  ${sections}
  ${secondary ? `<tr><td>${secondary}</td></tr>` : ''}
  ${edition.tesi ? `<tr><td style="background:#1C1914;padding:28px;color:#FFFDF8;"><div style="font-family:'Courier New',monospace;font-size:8px;color:#C8A97A;text-transform:uppercase;margin-bottom:12px;">La tesi di Valore Atteso</div><div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;">${esc(edition.tesi.headline || edition.tesi.intro || '')}</div></td></tr>` : ''}
  <tr><td style="padding:24px 28px;background:#E7DFD2;text-align:center;font-family:'Courier New',monospace;font-size:8px;color:#777066;">Preview editoriale · Nessun invio automatico</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

module.exports = {
  buildSponsorPreviewHtml
};
