// api/_lib/email/urls.js — Unica fonte degli URL verso valoreatteso.com (HTML e text/plain).
// Formato: https://valoreatteso.com/{edition} e /archivio, senza www, .html o #edizione.

const { site } = require('./config');

function utm(edition, block) {
  return `utm_source=newsletter&utm_medium=email&utm_campaign=va-${edition}&utm_content=${block}`;
}

// va_url('/', 'testata_logo', '027') → https://valoreatteso.com/?utm_...&utm_content=testata_logo
function vaUrl(path, block, edition, hash = '') {
  return `${site}${path}?${utm(edition, block)}${hash ? '#' + hash : ''}`;
}

const editionPath = edition => `/${edition}`;

// Link di condivisione: pagina dell'edizione, source whatsapp|email, medium share.
function shareUrl(edition, source) {
  return `${site}${editionPath(edition)}?utm_source=${source}&utm_medium=share&utm_campaign=va-${edition}`;
}

function whatsappHref(c) {
  return 'https://wa.me/?text=' + encodeURIComponent(`${c.share.text} ${shareUrl(c.edition, 'whatsapp')}`);
}

function mailtoHref(c) {
  return 'mailto:?subject=' + encodeURIComponent(`Valore Atteso #${c.edition} · ${c.title}`) +
    '&body=' + encodeURIComponent(`${c.share.text}\n\n${shareUrl(c.edition, 'email')}`);
}

const contactHref = edition => `mailto:info@valoreatteso.com?subject=${encodeURIComponent(`Valore Atteso #${edition}`)}`;

module.exports = { vaUrl, editionPath, shareUrl, whatsappHref, mailtoHref, contactHref, utm };
