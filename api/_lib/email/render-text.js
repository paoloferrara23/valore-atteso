// api/_lib/email/render-text.js — Versione text/plain, dagli stessi dati e dagli stessi URL dell'HTML.

const cfg = require('./config');
const { vaUrl, editionPath, shareUrl, privacyUrl, unsubscribeUrl } = require('./urls');
const { formatDate } = require('./render-html');

const pad2 = n => String(n).padStart(2, '0');
const RULE = '—';

function renderText(c) {
  const e = c.edition;
  const L = [];
  L.push(`VALORE ATTESO · Edizione #${e} · ${c.read_min} min · ${formatDate(c.date)}`, cfg.copy.motto, '');
  L.push(c.kicker.toUpperCase(), c.title, c.dek, '');
  L.push(cfg.copy.summaryTitle.toUpperCase());
  c.summary.forEach(r => L.push(`${pad2(r.section_n)} ${r.label}: ${r.number}. ${r.thesis}`));
  if (c.sponsor) L.push('', `${cfg.copy.sponsorLead} · ${c.sponsor.name}: ${c.sponsor.url}`);

  c.sections.forEach(s => {
    L.push('', RULE, `${pad2(s.n)} · ${s.label.toUpperCase()}`, s.title, '');
    s.kpi.forEach(k => L.push(`${k.label}: ${k.value}`));
    const m = s.module;
    if (m.type === 'bars') { L.push(m.title || ''); m.rows.forEach(r => L.push(`${r.label}: ${r.display}`)); }
    if (m.type === 'deal') { L.push((m.title || 'Scheda del deal').toUpperCase()); m.rows.forEach(r => L.push(`${r.key}: ${r.value}`)); }
    if (m.type === 'vs') {
      m.rows.forEach(r => L.push(`${r.label}: ${m.columns[0]} ${r.a} · ${m.columns[1]} ${r.b}`));
      if (m.note) L.push(m.note);
    }
    if (s.kpi.length || m.type !== 'none') L.push('');
    s.body.forEach(p => L.push(p, ''));
    L.push(cfg.copy.reading.replace(/^—\s*/, '').toUpperCase(), s.reading);
  });

  if (c.watch.length) {
    L.push('', RULE, cfg.copy.watchTitle.toUpperCase());
    c.watch.forEach(w => L.push(`- ${w.label}: ${w.text}`));
  }

  L.push('', RULE, cfg.copy.shareHeadline(e), cfg.copy.shareSubline);
  L.push(`Inoltra su WhatsApp: ${shareUrl(c, 'whatsapp')}`, `Inoltra via email: ${shareUrl(c, 'email')}`);
  L.push(`${cfg.copy.forwarded} Iscriviti gratis: ${vaUrl('/', 'inoltrata_iscriviti', e)}`, '');
  L.push('VALORE ATTESO', cfg.copy.tagline, '');
  L.push(`Leggi online: ${vaUrl(editionPath(c), 'footer_leggi_online', e)}`);
  L.push(`Archivio: ${vaUrl('/archivio', 'footer_archivio', e)}`);
  L.push(`Preferenze: ${cfg.legal.contact}`);
  L.push(`${cfg.copy.contact} ${cfg.legal.contact}`, '');
  L.push(cfg.copy.legalData, cfg.copy.legalAi);
  const owner = cfg.legal.ownerAddress ? `${cfg.legal.owner}, ${cfg.legal.ownerAddress}` : cfg.legal.owner;
  L.push(`${cfg.copy.legalOwner} ${owner} · ${cfg.copy.privacy} ${privacyUrl()} · ${cfg.copy.contactLabel} ${cfg.legal.contact}`);
  L.push(`${cfg.copy.unsubscribe}: ${unsubscribeUrl()}`);
  return L.join('\n') + '\n';
}

module.exports = { renderText };
