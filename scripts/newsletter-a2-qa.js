// scripts/newsletter-a2-qa.js — controlli automatici sull'anteprima A2 (nessun invio, nessuna rete).
// Uso: node scripts/newsletter-a2-qa.js [num]   dopo newsletter-a2-preview.js
// Screenshot 640/375 chiaro/scuro + 375 senza CSS (Gmail con account non Google),
// posizione della sezione 01, dimensioni minime dei testi, contrasti, pulsanti,
// testi della #026 presenti, validazione dei casi d'errore. Report in qa-<num>.json.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { editionToA2, validateA2 } = require('../api/_lib/newsletter-a2');

const num = String(process.argv[2] || '026').padStart(3, '0');
const dir = path.join(__dirname, '..', 'docs', 'newsletter-a2');
const shots = path.join(dir, 'screens');
fs.mkdirSync(shots, { recursive: true });
const html = fs.readFileSync(path.join(dir, `preview-${num}.html`), 'utf8');
const edition = JSON.parse(fs.readFileSync(path.join(dir, `${num}-edition.json`), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(dir, `${num}-layout.json`), 'utf8'));

// Misure eseguite nella pagina: testi, contrasti, pulsanti, KPI.
function inPage() {
  const lum = c => {
    const m = c.match(/[\d.]+/g).map(Number);
    const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return { L: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m.length > 3 ? m[3] : 1 };
  };
  const bgOf = el => {
    for (let e = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && lum(bg).a > 0.5) return bg;
    }
    return 'rgb(255,255,255)';
  };
  const out = { texts: [], contrastFails: [], minContrast: 99 };
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || el.closest('[style*="display:none"]')) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fg = lum(cs.color).L, bg = lum(bgOf(el)).L;
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    const size = parseFloat(cs.fontSize);
    const isLabel = /Mono|Courier/.test(cs.fontFamily);
    out.texts.push({ size, isLabel, tag: el.tagName });
    out.minContrast = Math.min(out.minContrast, ratio);
    if (ratio < 4.5) out.contrastFails.push({ text: own.slice(0, 50), ratio: +ratio.toFixed(2), color: cs.color, bg: bgOf(el) });
  });
  const s1 = document.getElementById('s1');
  out.section1Top = s1 ? Math.round(s1.getBoundingClientRect().top + window.scrollY) : null;
  out.buttons = [...document.querySelectorAll('a')].filter(a => /Inoltra/.test(a.textContent))
    .map(a => ({ text: a.textContent.trim(), h: Math.round(a.getBoundingClientRect().height), w: Math.round(a.getBoundingClientRect().width) }));
  out.kpiCells = [...document.querySelectorAll('.kpi .kc')].map(td => Math.round(td.getBoundingClientRect().width));
  out.scrollWidth = document.documentElement.scrollWidth;
  out.height = document.documentElement.scrollHeight;
  out.text = document.body.innerText.replace(/\s+/g, ' ');
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const report = { num, weightKB: +(Buffer.byteLength(html) / 1024).toFixed(1), renders: {} };
  const variants = [
    { name: '640-light', width: 640, scheme: 'light', html },
    { name: '640-dark', width: 640, scheme: 'dark', html },
    { name: '375-light', width: 375, scheme: 'light', html },
    { name: '375-dark', width: 375, scheme: 'dark', html },
    // Gmail app con account non Google: niente <style>, solo stili inline.
    { name: '375-nocss', width: 375, scheme: 'light', html: html.replace(/<style>[\s\S]*?<\/style>/g, '') },
  ];
  let text = '';
  for (const v of variants) {
    const page = await browser.newPage({ viewport: { width: v.width, height: 900 }, colorScheme: v.scheme });
    await page.route('**/*', r => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(v.html, { waitUntil: 'load' });
    const m = await page.evaluate(inPage);
    await page.screenshot({ path: path.join(shots, `a2-${num}-${v.name}.png`), fullPage: true });
    text = text || m.text;
    const body = m.texts.filter(t => !t.isLabel);
    const labels = m.texts.filter(t => t.isLabel);
    report.renders[v.name] = {
      section1Top: m.section1Top, height: m.height, horizontalScroll: m.scrollWidth > v.width + 1,
      minBodyPx: Math.min(...body.map(t => t.size)), minLabelPx: Math.min(...labels.map(t => t.size)),
      paragraphsUnder15: body.filter(t => t.tag === 'P' && t.size < 15).length,
      minContrast: +m.minContrast.toFixed(2), contrastFails: m.contrastFails,
      buttons: m.buttons, kpiCellWidths: m.kpiCells,
    };
    await page.close();
  }
  await browser.close();

  // Testi della #026: ogni paragrafo, titolo, lettura e fonte deve comparire identico.
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const must = [edition.title, edition.subtitle];
  edition.sections.forEach(s => {
    must.push(s.title, s.verdict, ...s.body.split(/\n{2,}/), ...s.sources);
  });
  edition.sections[0].kpis.forEach(k => must.push(k.value, k.label));
  report.missingText = must.map(norm).filter(t => !text.includes(t));
  // Cosa della mail inviata non compare più (scelte da far confermare).
  report.notRendered = {
    opener: !text.includes(norm(edition.opener)),
    kpiSezione2e3: edition.sections.slice(1).flatMap(s => s.kpis.map(k => `${k.value} | ${k.label}`))
      .filter(k => !text.includes(k.split(' | ')[1])),
  };

  // Validazione: i casi che devono bloccare il render.
  const base = () => editionToA2(JSON.parse(JSON.stringify(edition)), JSON.parse(JSON.stringify(layout)));
  const cases = {
    ok: m => m,
    fontiVuote: m => { m.sections[1].sources = []; return m; },
    sintesiMancante: m => { m.summary = m.summary.slice(0, 2); return m; },
    numeroSintesiAssente: m => { m.summary[2].number = '€999M'; return m; },
    numeroRipetuto: m => { m.sections[0].kpi.push({ value: '€565M', label: 'doppione' }); return m; },
    moduloNonValido: m => { m.sections[2].module.type = 'grafico'; return m; },
    letturaMancante: m => { m.sections[0].reading = ''; return m; },
  };
  report.validation = Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, validateA2(f(base()))]));

  fs.writeFileSync(path.join(dir, `qa-${num}.json`), JSON.stringify(report, null, 2));
  const r = report.renders;
  console.log(`peso ${report.weightKB} KB`);
  Object.entries(r).forEach(([k, v]) => console.log(`${k}: sez.01 a ${v.section1Top}px, altezza ${v.height}px, scroll orizz. ${v.horizontalScroll}, testo min ${v.minBodyPx}px, etichette min ${v.minLabelPx}px, p<15px ${v.paragraphsUnder15}, contrasto min ${v.minContrast}, sotto 4,5: ${v.contrastFails.length}, pulsanti ${v.buttons.map(b => b.h + 'x' + b.w).join(' ')}, KPI ${v.kpiCellWidths.join('/')}`));
  console.log('testi mancanti:', report.missingText.length ? report.missingText : 'nessuno');
  console.log('non mostrati:', JSON.stringify(report.notRendered));
  Object.entries(report.validation).forEach(([k, v]) => console.log(`validazione ${k}: ${v.length ? v.join(' | ') : 'OK'}`));
})().catch(e => { console.error(e); process.exit(1); });
