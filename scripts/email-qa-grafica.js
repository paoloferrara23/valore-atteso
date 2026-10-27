// scripts/email-qa-grafica.js — QA del restyling grafico "ibrido" dell'email (PROMPT-SOLO-GRAFICA, §10).
// Uso: node scripts/email-qa-grafica.js 026 [cartella-strumenti]
// Rende dist/<n>/preview.html a 375 e 640 (chiaro, scuro), 375 senza media query e 375 con soli font di ripiego.
// Screenshot DPR 2 in dist/<n>/grafica/, misure DOM (testata, #s1, target, font, overflow, contrasti,
// testo chiaro su scuro) e, se c'è lo strumento measure.py del pacchetto, le quote colore sui render DPR 1.
// Nessuna rete: blocca tutto tranne file:, data: e Google Fonts (questi ultimi bloccati nella variante "ripiego").

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const n = String(process.argv[2] || "026").padStart(3, "0");
const tools = process.argv[3];
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', n);
const out = path.join(dist, 'grafica');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(dist, 'preview.html'), 'utf8');
const noMq = h => h.replace(/@media only screen[\s\S]*?\n\}\n/g, '');

const VARIANTS = [
  ['375-light', 375, 'light', html, true], ['375-dark', 375, 'dark', html, true],
  ['640-light', 640, 'light', html, true], ['640-dark', 640, 'dark', html, true],
  ['375-senza-media-query', 375, 'light', noMq(html), true], ['375-font-ripiego', 375, 'light', html, false],
];

function inPage() {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = c => { const [r, g, b] = rgb(c).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alpha = c => { const v = rgb(c); return v.length > 3 ? v[3] : 1; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && alpha(bg) > 0.5) return bg; } return 'rgb(255, 255, 255)'; };
  const hex = c => '#' + rgb(c).slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[style*="display:none"]'); };
  const o = { small: [], under12: [], contrast: [], minContrast: 99, taps: [], chars: 0, dark: 0, top: 0, topDark: 0 };
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].filter(x => x.nodeType === 3 && x.textContent.replace(/[\s‌ ]/g, '')).map(x => x.textContent.trim()).join(' ');
    if (!own || !vis(el)) return;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const mono = /Mono|Courier/.test(cs.fontFamily);
    if (size < 11) o.small.push(`${size}px «${own.slice(0, 30)}»`);
    else if (!mono && size < 12) o.under12.push(`${size}px «${own.slice(0, 30)}»`);
    const bg = bgOf(el);
    const l1 = lum(cs.color), l2 = lum(bg);
    const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = size >= 24 || (size >= 18.5 && parseInt(cs.fontWeight, 10) >= 700);
    o.minContrast = Math.min(o.minContrast, r);
    if (r < (large ? 3 : 4.5)) o.contrast.push(`${r.toFixed(2)}:1 ${hex(cs.color)} su ${hex(bg)} ${size}px «${own.slice(0, 30)}»`);
    const len = own.replace(/[\s‌ ]/g, '').length;
    const y = el.getBoundingClientRect().top + scrollY;
    const onDark = l2 < 0.18;
    o.chars += len; if (onDark) o.dark += len;
    if (y < 700) { o.top += len; if (onDark) o.topDark += len; }
  });
  document.querySelectorAll('a').forEach(a => {
    if (!vis(a)) return;
    const h = a.getBoundingClientRect().height;
    if (h < 43.5) o.taps.push(`${Math.round(h)}px «${a.textContent.trim().slice(0, 30)}»`);
  });
  const g = id => { const e = document.getElementById(id); return e ? { top: Math.round(e.getBoundingClientRect().top + scrollY), h: Math.round(e.getBoundingClientRect().height) } : null; };
  o.hdr = g('hdr'); o.s1 = g('s1'); o.s2 = g('s2'); o.s3 = g('s3'); o.ino = g('ino'); o.ftr = g('ftr');
  const motto = document.querySelector('.motto');
  o.mottoLines = motto ? Math.round(motto.getBoundingClientRect().height / 16) : null;
  const sumN = [...document.querySelectorAll('.sum-n')].map(e => parseFloat(getComputedStyle(e).fontSize));
  const kpiV = [...document.querySelectorAll('.kpi-v')].map(e => parseFloat(getComputedStyle(e).fontSize));
  const kpiTops = [...document.querySelectorAll('.kpi')].map(e => Math.round(e.getBoundingClientRect().top));
  o.sumNumbers = [...new Set(sumN)]; o.kpiValues = [...new Set(kpiV)];
  o.kpiOnePerRow = new Set(kpiTops).size === kpiTops.length;
  o.images = [...document.images].map(i => ({ w: i.width, h: i.height, nw: i.naturalWidth, nh: i.naturalHeight }));
  o.overflow = document.documentElement.scrollWidth > innerWidth + 1;
  o.height = document.documentElement.scrollHeight;
  return o;
}

(async () => {
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined });
  const report = { edition: n, renders: {}, weightKB: Math.round(Buffer.byteLength(html) / 102.4) / 10,
    styleBlocks: (html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '').match(/<style>/g) || []).length, msoStyle: /<!--\[if mso\]>[\s\S]*?<style>/.test(html), images: (html.match(/<img\b/g) || []).length,
    forbidden: (html.match(/display:\s*(flex|grid)|position:\s*(absolute|fixed|relative)|float:\s*(left|right)|background-image|<script|\bfont:/gi) || []) };
  for (const [name, w, scheme, h, fonts] of VARIANTS) {
    const file = path.join(dist, `_qa-${name}.html`);
    fs.writeFileSync(file, h);
    for (const dpr of [1, 2]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: dpr, colorScheme: scheme, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file:') || u.startsWith('data:') || (fonts && /fonts\.(googleapis|gstatic)\.com/.test(u))) return r.continue(); return r.abort(); });
      await page.goto('file://' + file, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.waitForTimeout(300);
      if (dpr === 1) report.renders[name] = { ...(await page.evaluate(inPage)) };
      await page.screenshot({ path: path.join(out, `${n}-${name}${dpr === 1 ? '-dpr1' : ''}.png`), fullPage: true });
      await ctx.close();
    }
    fs.unlinkSync(file);
    const r = report.renders[name];
    r.minContrast = +r.minContrast.toFixed(2);
    r.textOnDarkPct = +(100 * r.dark / r.chars).toFixed(1);
    r.textOnDarkTop700Pct = +(100 * r.topDark / r.top).toFixed(1);
  }
  await browser.close();

  // Quote colore con lo strumento del pacchetto (measure.py), sui render chiari DPR 1.
  if (tools && fs.existsSync(path.join(tools, 'measure.py'))) {
    report.colors = {};
    for (const name of ['375-light', '640-light']) {
      const img = path.join(out, `${n}-${name}-dpr1.png`);
      try {
        execFileSync('python3', [path.join(tools, 'measure.py'), img], { env: { ...process.env, PYTHONPATH: process.env.QA_PYTHONPATH || '' }, stdio: 'pipe' });
        const m = JSON.parse(fs.readFileSync(img.replace(/\.png$/, '-misure.json'), 'utf8'));
        const runs = m.tratti.filter(t => t[0] === 'blu' && t[2] >= 12).map(t => [t[1], t[2]]);
        report.colors[name] = { fondo: m['fondo_area_%'], primi700: m['prima_schermata_700'].fondo, trattiBlu: runs };
        fs.unlinkSync(img.replace(/\.png$/, '-misure.json'));
      } catch (e) { report.colors[name] = { errore: String(e.message).slice(0, 200) }; }
    }
  }
  fs.writeFileSync(path.join(out, 'qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 1).slice(0, 6000));
})().catch(e => { console.error(e); process.exit(1); });
