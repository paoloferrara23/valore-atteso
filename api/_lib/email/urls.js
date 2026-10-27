// api/_lib/email/urls.js — Unica fonte degli URL verso valoreatteso.com (HTML e text/plain).
// Pagina dell'edizione: https://www.valoreatteso.com/edizione-26 (la pagina generata da
// scripts/generate-edition-pages.js). Se all'invio non esiste ancora, si ripiega su /archivio.

const cfg = require('./config');

const utm = (edition, block) => `utm_source=newsletter&utm_medium=email&utm_campaign=va-${edition}&utm_content=${block}`;

function editionPath(c) {
  return c.edition_page === false ? '/archivio' : `/edizione-${parseInt(c.edition, 10)}`;
}

function vaUrl(path, block, edition) {
  return `${cfg.site}${path}?${utm(edition, block)}`;
}

// Condivisione: pagina dell'edizione, source whatsapp|email, medium share, senza utm_content.
function shareUrl(c, source) {
  return `${cfg.site}${editionPath(c)}?utm_source=${source}&utm_medium=share&utm_campaign=va-${c.edition}`;
}

function whatsappHref(c) {
  return 'https://wa.me/?text=' + encodeURIComponent(`${cfg.copy.shareText} ${shareUrl(c, 'whatsapp')}`);
}

function mailtoHref(c) {
  return 'mailto:?subject=' + encodeURIComponent(`Valore Atteso #${c.edition} · ${c.title}`) +
    '&body=' + encodeURIComponent(`${cfg.copy.shareText}\n\n${shareUrl(c, 'email')}`);
}

const contactHref = edition => `mailto:${cfg.legal.contact}?subject=${encodeURIComponent(`Valore Atteso #${edition}`)}`;
const privacyUrl = () => `${cfg.site}${cfg.legal.privacyPath}`;
const unsubscribeUrl = () => `${cfg.site}${cfg.unsubscribePath}`;

module.exports = { vaUrl, editionPath, shareUrl, whatsappHref, mailtoHref, contactHref, privacyUrl, unsubscribeUrl, utm };
