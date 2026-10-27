// api/_lib/email/build.js — validate → render HTML → render text/plain → controlli post-build → report.
// Deterministico: stesso contratto e stesse opzioni, stessi byte (nessun timestamp né ID casuale).
//
// Modalità:
//   preview  anteprima per Paolo: placeholder ammessi ed elencati, immagini da percorso locale
//   test     come preview, ma immagini con URL assoluto (per l'invio di prova a un solo indirizzo)
//   send     HTML per Brevo: placeholder, nomi di stampa, link non ammessi o edizione non approvata bloccano

const crypto = require('crypto');
const cfg = require('./config');
const { validate, PLACEHOLDER, SUBSCRIBERS } = require('./validate');
const { privacyUrl, unsubscribeUrl } = require('./urls');
const { renderHtml } = require('./render-html');
const { renderText } = require('./render-text');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const kb = s => Math.round(Buffer.byteLength(s) / 102.4) / 10;
const unescapeAttr = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

// Controllo di un URL verso valoreatteso.com: ritorna l'elenco dei problemi.
// Ammessi solo www.valoreatteso.com (con UTM), mailto: e wa.me; ogni altro dominio è vietato.
function checkUrl(url, edition, where) {
  if (url === unsubscribeUrl() || url === privacyUrl()) return []; // link di servizio senza UTM
  let u;
  try { u = new URL(url); } catch (_) { return [`${where}: URL non valido ${url}`]; }
  const out = [];
  const host = u.hostname.toLowerCase();
  const q = u.searchParams;
  if (host !== 'www.valoreatteso.com') return [`${where}: link esterno non ammesso (${url})`];
  if (/\.html$/.test(u.pathname)) out.push(`${where}: URL con .html (${url})`);
  if (u.hash) out.push(`${where}: ancora non ammessa ${u.hash} (${url})`);
  if (!/^\/($|archivio$|edizione-\d+$)/.test(u.pathname)) out.push(`${where}: pagina non prevista ${u.pathname}`);
  if (q.get('utm_medium') === 'share') {
    if (!['whatsapp', 'email'].includes(q.get('utm_source'))) out.push(`${where}: share con utm_source non valido (${url})`);
    if (q.get('utm_campaign') !== `va-${edition}`) out.push(`${where}: utm_campaign diverso da va-${edition} (${url})`);
    if (q.has('utm_content')) out.push(`${where}: share senza utm_content (${url})`);
  } else {
    if (q.get('utm_source') !== 'newsletter' || q.get('utm_medium') !== 'email') out.push(`${where}: UTM newsletter/email mancanti (${url})`);
    if (q.get('utm_campaign') !== `va-${edition}`) out.push(`${where}: utm_campaign diverso da va-${edition} (${url})`);
    if (!cfg.utmBlocks.includes(q.get('utm_content'))) out.push(`${where}: utm_content fuori lista (${url})`);
  }
  return out;
}

function postChecks(html, text, c, mode) {
  const errors = [];
  const warnings = [];
  const place = [];
  const strict = mode === 'send';

  // Placeholder rimasti nell'output (compresi quelli di configurazione, es. [[TITOLARE]]).
  const visible = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  [visible, text].forEach((s, i) => {
    const re = new RegExp(PLACEHOLDER.source, 'gi');
    let m;
    while ((m = re.exec(s))) place.push(`${i ? 'text' : 'html'}: ${s.slice(Math.max(0, m.index - 10), m.index + 40).replace(/\s+/g, ' ').trim()}`);
  });
  if (strict && place.length) errors.push(`placeholder rimasti nell'output (${place.length})`);

  // Merge tag: solo quelli in whitelist.
  [...new Set((html + text).match(/\{\{[^}]*\}\}/g) || [])].forEach(t => {
    if (!cfg.mergeTags.includes(t)) errors.push(`merge tag non in whitelist: ${t}`);
  });

  // Link: HTML e text/plain.
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(m => unescapeAttr(m[1]));
  hrefs.forEach(h => {
    if (h.startsWith('#')) { if (!/^#s[1-3]$/.test(h)) errors.push(`ancora interna non valida ${h}`); return; }
    if (h.startsWith('mailto:')) {
      const keys = [...new URLSearchParams(h.split('?')[1] || '').keys()];
      if (keys.some(k => !['subject', 'body'].includes(k))) errors.push(`mailto con parametri non ammessi: ${h}`);
      return;
    }
    if (h.startsWith('https://wa.me/')) {
      const txt = new URL(h).searchParams.get('text') || '';
      const inner = (txt.match(/https:\/\/\S+/) || [])[0];
      if (!inner) errors.push('WhatsApp senza URL dell\'edizione');
      else checkUrl(inner, c.edition, 'WhatsApp').forEach(e => errors.push(e));
      return;
    }
    checkUrl(h, c.edition, 'HTML').forEach(e => errors.push(e));
  });
  const textUrls = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map(m => m[0]);
  textUrls.forEach(u => checkUrl(u, c.edition, 'text/plain').forEach(e => errors.push(e)));
  // Immagini: esattamente 2, con alt; in send/test src assoluti su dominio VA.
  const imgs = [...html.matchAll(/<img[^>]*>/g)].map(m => m[0]);
  if (imgs.length !== 2) errors.push(`attese 2 immagini, trovate ${imgs.length}`);
  imgs.forEach(t => {
    if (!/alt="Valore Atteso"/.test(t)) errors.push('immagine senza alt="Valore Atteso"');
    const src = (t.match(/src="([^"]*)"/) || [])[1] || '';
    if (mode !== 'preview' && !/^https:\/\/www\.valoreatteso\.com\//.test(src)) errors.push(`immagine non ospitata su valoreatteso.com: ${src}`);
  });

  if (!c.sponsor && /Presentato da/i.test(html)) errors.push('sponsor null ma "Presentato da" presente');
  if (SUBSCRIBERS.test(visible) || SUBSCRIBERS.test(text)) errors.push('numero di iscritti nell\'output');
  if (/font-size:\s*(9|10|10\.5)px/.test(html)) errors.push('font-size sotto 11px nell\'HTML');
  if (/display:\s*(flex|grid)|position:\s*(absolute|fixed|relative)|float:\s*(left|right)/i.test(html)) errors.push('layout con flex/grid/position/float');

  const size = kb(html);
  if (size > cfg.limits.maxKB) errors.push(`HTML di ${size} KB (massimo ${cfg.limits.maxKB} KB prima di Brevo)`);
  else if (size > cfg.limits.warnKB) warnings.push(`HTML di ${size} KB (avviso oltre ${cfg.limits.warnKB} KB)`);

  return { errors, warnings, placeholders: place, hrefs: [...new Set([...hrefs, ...textUrls])] };
}

function build(contract, opts = {}) {
  const mode = opts.mode || 'preview';
  const v = validate(contract, mode === 'send' ? 'send' : 'preview');
  const report = {
    edition: contract && contract.edition, mode,
    errors: v.issues.filter(i => i.level === 'error'),
    warnings: v.issues.filter(i => i.level === 'warning'),
    placeholders: v.placeholders.map(p => `${p.path}: ${p.value}`),
  };
  // Con errori di schema la struttura non è affidabile: ci si ferma. Con errori di regola
  // si rende comunque, così il report elenca anche i problemi dell'output.
  if (report.errors.some(e => /^schema:/.test(e.rule))) return { ok: false, report };

  const c = v.contract;
  const html = renderHtml(c, { assetBase: mode === 'preview' ? opts.assetBase : undefined });
  const text = renderText(c);
  const post = postChecks(html, text, c, mode);
  post.errors.forEach(e => report.errors.push({ level: 'error', field: 'output', rule: e }));
  post.warnings.forEach(w => report.warnings.push({ level: 'warning', field: 'output', rule: w }));
  report.subject = c.subject;
  report.outputPlaceholders = post.placeholders;
  report.weightKB = { html: kb(html), text: kb(text) };
  report.sha256 = { html: sha(html), text: sha(text) };
  report.hrefs = post.hrefs;
  return { ok: report.errors.length === 0, html, text, report };
}

function reportMarkdown(r) {
  const L = [`# Report build #${r.edition} (${r.mode})`, '', `Esito: **${r.errors.length ? 'BLOCCATO' : 'OK'}** · errori ${r.errors.length} · avvisi ${r.warnings.length} · placeholder ${r.placeholders.length}`, ''];
  if (r.weightKB) L.push(`Peso: HTML ${r.weightKB.html} KB · text/plain ${r.weightKB.text} KB`, `SHA-256 HTML ${r.sha256.html}`, `SHA-256 text ${r.sha256.text}`, '');
  const list = (title, items) => { if (items.length) { L.push(`## ${title}`, ...items.map(i => `- ${i}`), ''); } };
  const fmt = i => `\`${i.field}\`: ${i.rule}${i.value !== undefined && i.value !== null && i.field !== 'output' ? ` (${JSON.stringify(i.value).slice(0, 90)})` : ''}`;
  list('Errori', r.errors.map(fmt));
  list('Avvisi', r.warnings.map(fmt));
  list('Placeholder da fornire', r.placeholders);
  if (r.hrefs) list('Link', r.hrefs.map(h => `\`${h}\``));
  return L.join('\n') + '\n';
}

module.exports = { build, reportMarkdown, checkUrl };
