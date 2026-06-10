function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSponsorEmail(sponsor) {
  if (!sponsor || !sponsor.asset) return '';
  const asset = sponsor.asset;
  const isMain = sponsor.slot_type === 'main';
  const background = isMain ? '#E7DFD2' : '#F7F4EF';
  const padding = isMain ? '26px 28px' : '20px 28px';
  const headlineSize = isMain ? '20px' : '16px';
  const body = esc(asset.body);
  const logo = asset.logo_signed_url
    ? `<img src="${esc(asset.logo_signed_url)}" alt="${esc(sponsor.company)}" width="${isMain ? 120 : 90}" style="display:block;max-width:${isMain ? 120 : 90}px;max-height:54px;object-fit:contain;margin:0 0 16px;">`
    : '';

  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${background}" style="background:${background};border-top:1px solid #CEC3B2;border-bottom:1px solid #CEC3B2;">
    <tr><td style="padding:${padding};background:${background};" bgcolor="${background}">
      <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.16em;color:#8E6B33;text-transform:uppercase;margin-bottom:13px;">Partner · ${isMain ? 'Main slot' : 'Slot secondario'}</div>
      ${logo}
      <h2 style="font-family:Georgia,serif;font-size:${headlineSize};font-weight:700;color:#1C1914;line-height:1.2;margin:0 0 10px;">${esc(asset.headline)}</h2>
      <p style="font-family:Georgia,serif;font-size:14px;color:#4C453D;font-weight:300;line-height:1.75;margin:0 0 15px;">${body}</p>
      <a href="${esc(asset.cta_url)}" style="display:inline-block;background:#1C1914;color:#F0EBE1;font-family:'Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:10px 17px;text-decoration:none;">Scopri di più →</a>
      <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;margin-top:14px;">Contenuto sponsorizzato</div>
    </td></tr>
  </table>`;
}

function renderSponsorWeb(sponsor) {
  if (!sponsor || !sponsor.asset) return '';
  const asset = sponsor.asset;
  const isMain = sponsor.slot_type === 'main';
  return `
    <div class="art-sponsor ${isMain ? 'main' : 'secondary'}">
      <div class="art-sponsor-label">Partner · ${isMain ? 'Main slot' : 'Slot secondario'}</div>
      ${asset.logo_signed_url ? `<img src="${esc(asset.logo_signed_url)}" alt="${esc(sponsor.company)}">` : ''}
      <h2>${esc(asset.headline)}</h2>
      <p>${esc(asset.body)}</p>
      <a href="${esc(asset.cta_url)}" target="_blank" rel="noopener sponsored">Scopri di più →</a>
      <small>Contenuto sponsorizzato</small>
    </div>`;
}

module.exports = {
  renderSponsorEmail,
  renderSponsorWeb
};
