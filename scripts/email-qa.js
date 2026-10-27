// scripts/email-qa.js — Test del template email (§5 del prompt ed. 27). Nessun invio, nessuna rete.
// Uso: node scripts/email-qa.js 026   (dopo `npm run edition -- 026 --mode=preview`)
// Screenshot DPR 2 in dist/{n}/screens: 640/375 chiaro/scuro e 375 senza media query.
// Misure: #s1, tap <44px, font sotto i minimi, overflow, KPI impilati senza media query,
// etichette delle barre su una riga, motto su una riga, loghi non deformati, contrasti.
// Per la 026 anche: variante con intro, testi uguali all'invio, casi di validazione.
// Report in dist/{n}/qa.json e qa.md.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { build } = require('../api/_lib/email/build');
const cfg = require('../api/_lib/email/config');

const edition = String(process.argv[2] || '026').padStart(3, '0');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', edition);
const shots = path.join(dist, 'screens');
fs.mkdirSync(shots, { recursive: true });
const contract = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', `${edition}.json`), 'utf8'));
const html = fs.readFileSync(path.join(dist, 'preview.html'), 'utf8');
const noMq = h => h.replace(/@media only screen[\s\S]*?\n}\n/, '');

function ratio(a, b) {
  const L = hex => { const [r, g, b2] = hex.match(/\w\w/g).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b2; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return Math.round((x + 0.05) / (y + 0.05) * 100) / 100;
}

function inPage() {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = c => { const [r, g, b] = rgb(c).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alpha = c => { const v = rgb(c); return v.length > 3 ? v[3] : 1; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && alpha(bg) > 0.5) return bg; } return 'rgb(255, 255, 255)'; };
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[style*="display:none"]'); };
  const out = { small: [], under12: [], contrast: [], minContrast: 99, taps: [], kpiTops: [], barLabels: [] };
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own || !vis(el)) return;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const mono = /Mono|Courier/.test(cs.fontFamily);
    if (size < 11) out.small.push(`${size}px ${own.slice(0, 30)}`);
    if (!mono && size < 12) out.under12.push(`${size}px ${own.slice(0, 30)}`);
    const fg = lum(cs.color), bg = lum(bgOf(el));
    const r = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    out.minContrast = Math.min(out.minContrast, r);
    if (r < 4.5) out.contrast.push(`${r.toFixed(2)} ${own.slice(0, 30)} (${cs.color} su ${bgOf(el)})`);
  });
  document.querySelectorAll('a').forEach(a => {
    if (!vis(a)) return;
    const h = Math.round(a.getBoundingClientRect().height);
    const isSource = !!a.closest('[id^="fonti-s"]');
    if (h < 44) out.taps.push({ text: a.textContent.trim().slice(0, 30), h, source: isSource });
  });
  out.kpiTops = [...document.querySelectorAll('.kpi')].map(k => Math.round(k.getBoundingClientRect().top));
  out.barLabels = [...document.querySelectorAll('.bl')].map(td => ({ text: td.textContent.trim(), lines: Math.round(td.getBoundingClientRect().height / parseFloat(getComputedStyle(td).lineHeight) - 0.2) }));
  const motto = document.querySelector('.motto');
  out.mottoLines = motto ? Math.round(motto.getBoundingClientRect().height / (parseFloat(getComputedStyle(motto).fontSize) * 1.2)) : null;
  out.images = [...document.images].map(i => ({ w: i.width, h: i.height, nw: i.naturalWidth, nh: i.naturalHeight, ok: i.complete && i.naturalWidth > 0 }));
  const s1 = document.getElementById('s1');
  out.s1 = s1 ? Math.round(s1.getBoundingClientRect().top + scrollY) : null;
  out.overflow = document.documentElement.scrollWidth > innerWidth + 1;
  out.height = document.documentElement.scrollHeight;
  out.text = document.body.innerText;
  return out;
}

async function render(browser, h, width, scheme, name) {
  const file = path.join(dist, `_qa-${name}.html`);
  fs.writeFileSync(file, h);
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto('file://' + file);
  const m = await page.evaluate(inPage);
  if (name) await page.screenshot({ path: path.join(shots, `${edition}-${name}.png`), fullPage: true });
  await page.close();
  fs.unlinkSync(file);
  return m;
}

(async () => {
  const browser = await chromium.launch();
  const report = { edition, renders: {} };
  const variants = [['640-light', 640, 'light', html], ['640-dark', 640, 'dark', html], ['375-light', 375, 'light', html], ['375-dark', 375, 'dark', html], ['375-senza-media-query', 375, 'light', noMq(html)]];
  let text = '';
  for (const [name, w, scheme, h] of variants) {
    const m = await render(browser, h, w, scheme, name);
    text = text || m.text;
    delete m.text;
    const kpiStacked = m.kpiTops.length < 2 || new Set(m.kpiTops).size === m.kpiTops.length;
    report.renders[name] = {
      s1: m.s1, height: m.height, overflow: m.overflow, minContrast: +m.minContrast.toFixed(2), contrastFails: m.contrast,
      fontsUnder11: m.small, nonLabelUnder12: m.under12, tapsUnder44: m.taps.filter(t => !t.source), sourceLinksUnder44: m.taps.filter(t => t.source).length,
      kpiTops: m.kpiTops, kpiStacked: w === 375 ? kpiStacked : null, barLabelsMultiline: m.barLabels.filter(b => b.lines > 1), mottoLines: m.mottoLines,
      images: m.images.map(i => ({ ...i, deformation: i.nw ? +Math.abs((i.w / i.h) / (i.nw / i.nh) - 1).toFixed(3) : null })),
    };
  }

  // Coppie grafiche (non testo) richieste dal §5.1.
  report.graphicPairs = {
    'filetto oro / ink': ratio('#D67F0D', '#1C1914'), 'filetto oro / pagina dark': ratio('#D67F0D', '#121110'),
    'bordo footer / pagina dark': ratio('#3A352E', '#121110'), 'bordo sintesi / pagina dark': ratio('#2E4A8F', '#121110'),
    'blu / ink (motivo del filetto)': ratio('#00266E', '#1C1914'),
  };

  if (edition === '026') {
    // Variante con il paragrafo d'apertura (§7: decisione di Paolo).
    const intro = fs.readFileSync(path.join(root, 'fixtures', '026-intro.txt'), 'utf8').trim();
    const withIntro = build({ ...contract, intro }, { mode: 'preview', assetBase: '../../email/brand/' });
    const mi = await render(browser, withIntro.html, 375, 'light', '');
    report.introVariant = { s1: mi.s1, overBy: Math.max(0, mi.s1 - 800) };

    // Testi: ogni paragrafo, titolo, lettura, tesi e voce del deal/vs deve comparire identico.
    const norm = s => String(s).replace(/\s+/g, ' ').trim();
    const flat = norm(text);
    const must = [contract.title, contract.dek, ...contract.summary.map(s => s.thesis)];
    contract.sections.forEach(s => must.push(s.title, s.reading, ...s.body, ...s.sources.map(x => x.testo), ...s.kpi.map(k => k.value)));
    report.missingText = must.map(norm).filter(t => !flat.includes(t));

    // Validazione: casi che devono bloccare, e un caso "pulito" che deve passare in send.
    const clone = () => JSON.parse(JSON.stringify(contract));
    const errs = (c, mode = 'preview') => build(c, { mode, assetBase: '../../email/brand/' }).report.errors.map(e => `${e.field}: ${e.rule}`);
    const clean = () => {
      const c = clone();
      c.sections.forEach((s, i) => { s.sources = [{ testo: `Documento ufficiale di prova ${i + 1}`, url: `https://example.org/doc-${i + 1}.pdf` }]; });
      c.sections[1].body = c.sections[1].body.map(p => p.replace(' secondo Reuters', ''));
      c.approvals = { copy: true, factcheck: true, paolo: true };
      return c;
    };
    const cases = {
      'fonti vuote': c => { c.sections[0].sources = []; return c; },
      'sintesi con 2 righe': c => { c.summary.pop(); return c; },
      'numero KPI mancante': c => { c.sections[0].kpi[0].value = 'n.d.'; return c; },
      'numero sintesi assente nella sezione': c => { c.summary[2].number = '€999M'; return c; },
      'numero ripetuto KPI/modulo': c => { c.sections[0].kpi[2].value = '€565M'; return c; },
      'modulo non valido': c => { c.sections[2].module.type = 'grafico'; return c; },
      'cella vs vuota': c => { c.sections[2].module.rows[0].b = ''; return c; },
      'valore vs con trattino': c => { c.sections[2].module.rows[3].b = '–'; return c; },
      'fonte su dominio di stampa': c => { const x = clean(); x.sections[0].sources[0].url = 'https://www.reuters.com/x'; return x; },
      'fonte con testo generico': c => { const x = clean(); x.sections[0].sources[0].testo = 'clicca qui'; return x; },
      'UTM su fonte esterna': c => { const x = clean(); x.sections[0].sources[0].url = 'https://example.org/a?utm_source=x'; return x; },
      'numero di iscritti': c => { c.dek = 'Siamo 182 iscritti'; return c; },
      'preheader troncato': c => { c.preheader = 'Il Milan fa mercato da Champions giocando l\'Europa League, il Valencia vende il 42% per…'; return c; },
    };
    report.validation = {};
    Object.entries(cases).forEach(([k, f]) => { report.validation[k] = errs(f(clone()), /stampa|generico|UTM su/.test(k) ? 'send' : 'preview'); });
    report.validation['026 in send (atteso: bloccato)'] = errs(clone(), 'send').length + ' errori';
    report.validation['026 pulita in send, dati legali ancora placeholder (atteso: bloccato)'] = errs(clean(), 'send');
    const saved = { ...cfg.legal };
    cfg.legal.titolare = 'Titolare di prova'; cfg.legal.indirizzo = 'Indirizzo di prova';
    report.validation['026 pulita in send, dati legali compilati (atteso: OK)'] = errs(clean(), 'send');
    Object.assign(cfg.legal, saved);
  }
  await browser.close();

  fs.writeFileSync(path.join(dist, 'qa.json'), JSON.stringify(report, null, 2) + '\n');
  const L = [`# QA #${edition}`, ''];
  Object.entries(report.renders).forEach(([k, v]) => L.push(`- **${k}**: #s1 a ${v.s1}px · altezza ${v.height}px · overflow ${v.overflow} · contrasto min ${v.minContrast} (sotto 4,5: ${v.contrastFails.length}) · font <11px ${v.fontsUnder11.length} · testo <12px ${v.nonLabelUnder12.length} · tap <44px ${v.tapsUnder44.length} (link fonti nel testo ${v.sourceLinksUnder44}) · KPI impilati ${v.kpiStacked} · etichette barre a capo ${v.barLabelsMultiline.length} · motto righe ${v.mottoLines} · loghi ${v.images.map(i => `${i.w}×${i.h} def ${i.deformation}`).join(', ')}`));
  L.push('', '## Coppie grafiche', ...Object.entries(report.graphicPairs).map(([k, v]) => `- ${k}: ${v}:1`));
  if (report.introVariant) L.push('', `## Variante con intro: #s1 a ${report.introVariant.s1}px (oltre gli 800px di ${report.introVariant.overBy}px)`);
  if (report.missingText) L.push('', `## Testi mancanti rispetto alla 026: ${report.missingText.length ? report.missingText.join(' | ') : 'nessuno'}`);
  if (report.validation) { L.push('', '## Validazione'); Object.entries(report.validation).forEach(([k, v]) => L.push(`- ${k}: ${Array.isArray(v) ? (v.length ? v.join(' · ') : 'OK') : v}`)); }
  fs.writeFileSync(path.join(dist, 'qa.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
