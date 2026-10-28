// scripts/qa-fase-3.js — QA della fase 3 (pagine edizione, archivio statico, Terminale in home). Nessuna richiesta reale.
// Uso: node scripts/qa-fase-3.js <cartella-del-sito> <etichetta> [editions.json]   (QA_ONLY=home,archivio per un sottoinsieme)
//   etichetta "prima" o "dopo" → qa/fase-3/<etichetta>/ (screenshot, misure.json, misure.md)
//   editions.json (export delle edizioni pubblicate) → con "dopo" scrive anche report-dati.md e meta.md in qa/fase-3/.
// /api/subscribe è simulata, /api/admin-db e ogni dominio esterno sono bloccati e contati.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(process.argv[2] || '.');
const label = process.argv[3] || 'dopo';
const dataFile = process.argv[4];
const repo = path.join(__dirname, '..');
const base3 = path.join(repo, 'qa', 'fase-3');
const out = path.join(base3, label);
fs.mkdirSync(out, { recursive: true });
const port = 8793;
const host = `http://localhost:${port}`;

const PAGES = [['home', '/'], ['archivio', '/archivio'], ['edizione-26', '/edizione-26'], ['edizione-25', '/edizione-25'],
  ['edizione-17', '/edizione-17'], ['edizione-1', '/edizione-1'], ['edizione-18', '/edizione-18'], ['edizione-27', '/edizione-27']]
  .filter(p => !process.env.QA_ONLY || process.env.QA_ONLY.split(',').includes(p[0]));
const VIEWS = [375, 640, 1280, 1440];

// Misure nel browser. Il fondo si legge dal CSS; dove c'è un gradiente l'elemento va campionato sui pixel (grad).
function measure() {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = c => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage)) return null; const v = rgb(cs.backgroundColor); if ((v.length < 4 || v[3] > 0.5) && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') return v; } return [243, 239, 230]; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05; };
  const o = { contrast: [], minContrast: 99, small: [], taps: [], grad: [], overflow: document.documentElement.scrollWidth > innerWidth + 1, h1: document.querySelectorAll('h1').length };
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own || !vis(el) || el.closest('[aria-hidden="true"]') || el.closest('.va-hdr.hdr-over:not(.solid)')) return;
    const cs = getComputedStyle(el); const size = parseFloat(cs.fontSize);
    const monoUpper = /Mono|mono/.test(cs.fontFamily) && cs.textTransform === 'uppercase';
    if (size < 11 || (size < 12 && !monoUpper)) o.small.push(`${size}px «${own.slice(0, 30)}»`);
    const bg = bgOf(el); const fg = rgb(cs.color);
    const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    const r = el.getBoundingClientRect();
    if (!bg) { o.grad.push({ t: own.slice(0, 30), fg, need: large ? 3 : 4.5, x: r.left, y: r.top + scrollY, w: r.width, h: r.height }); return; }
    const l1 = lum(fg), l2 = lum(bg); const c = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    o.minContrast = Math.min(o.minContrast, +c.toFixed(2));
    if (c < (large ? 3 : 4.5)) o.contrast.push(`${c.toFixed(2)}:1 «${own.slice(0, 30)}»`);
  });
  document.querySelectorAll('a, button, input, select, textarea').forEach(el => {
    if (!vis(el) || el.classList.contains('va-skip') || el.type === 'checkbox' || el.closest('[aria-hidden="true"]')) return;
    const inline = el.tagName === 'A' && el.closest('p, li, .legal-note, .va-consent, caption, .sec-src, .secondary-cta');
    const r = el.getBoundingClientRect();
    if (!inline && r.height < 43.5) o.taps.push(`${Math.round(r.width)}×${Math.round(r.height)} ${el.tagName.toLowerCase()} «${(el.textContent || el.placeholder || '').trim().slice(0, 24)}»`);
  });
  const g = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY) }; };
  o.form = { email: g('#form-email'), button: g('#form-btn'), consent: g('.hero .va-consent') };
  o.kpiFit = [...document.querySelectorAll('.sk-v, .hk-v')].map(e => e.scrollWidth <= e.clientWidth + 1);
  return o;
}

// Contrasti sugli elementi con fondo a gradiente: campiona i pixel attorno al riquadro del testo nello screenshot.
async function sampleGrad(browser, png, grad) {
  if (!grad.length) return [];
  const p = await browser.newPage();
  await p.setContent('<canvas id="c"></canvas>');
  const res = await p.evaluate(async ([data, boxes]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.getElementById('c'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const lum = a => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]); };
    return boxes.map(b => {
      // Solo i punti di fondo: i gradienti del sito sono blu/navy (B nettamente sopra R e G); un punto che cade
      // su un testo vicino (crema, oro) si scarta invece di contarlo come fondo.
      let worst = 99;
      for (const [px, py] of [[b.x - 4, b.y + b.h / 2], [b.x + b.w + 4, b.y + b.h / 2], [b.x + b.w / 2, b.y - 3], [b.x + b.w / 2, b.y + b.h + 3], [b.x - 4, b.y - 3], [b.x + b.w + 4, b.y + b.h + 3]]) {
        const X = Math.max(0, Math.min(img.width - 1, Math.round(px * 2))), Y = Math.max(0, Math.min(img.height - 1, Math.round(py * 2)));
        const d = x.getImageData(X, Y, 1, 1).data;
        if (!(d[2] > d[0] + 30 && d[2] > d[1])) continue;
        const l1 = lum(b.fg), l2 = lum(d);
        worst = Math.min(worst, (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
      }
      return { t: b.t, c: +worst.toFixed(2), ok: worst >= b.need };
    });
  }, [png.toString('base64'), grad]);
  await p.close();
  return res;
}

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'qa-serve.js'), root, String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch();
  const report = { label, pages: {}, network: { subscribe: 0, adminDb: 0, external: [] }, keyboard: {} };
  try {
    for (const [name, url] of PAGES) {
      for (const w of VIEWS.concat(name === 'home' ? [320] : [])) {
        for (const rm of [false, true]) {
          if (rm && !(w === 375 || w === 1440)) continue;
          const ctx = await browser.newContext({ viewport: { width: w, height: w < 640 ? 812 : 900 }, deviceScaleFactor: 2, reducedMotion: rm ? 'reduce' : 'no-preference' });
          const page = await ctx.newPage();
          const errors = [];
          let status = 0;
          page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(m.text()); });
          page.on('pageerror', e => errors.push(String(e)));
          await page.route('**/*', r => {
            const u = r.request().url();
            if (u.includes('/api/subscribe')) { report.network.subscribe++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
            if (u.includes('/api/admin-db')) { report.network.adminDb++; return r.abort(); }
            if (u.startsWith(host)) return r.continue();
            report.network.external.push(u.split('?')[0]); return r.abort();
          });
          const resp = await page.goto(host + url, { waitUntil: 'networkidle' });
          status = resp ? resp.status() : 0;
          await page.evaluate(() => document.fonts.ready);
          // Fa entrare le righe del Terminale e attiva le animazioni a comparsa, poi torna in cima.
          // behavior 'instant': la home ha scroll-behavior:smooth e uno scrollTo normale non arriverebbe in fondo.
          await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 60)); } scrollTo({ top: 0, behavior: 'instant' }); });
          await page.waitForTimeout(700);
          const tag = `${name}-${w}${rm ? '-reduced-motion' : ''}`;
          if (!rm || w === 375) await page.screenshot({ path: path.join(out, `${tag}-fold.png`) });
          const full = await page.screenshot({ path: path.join(out, `${tag}.png`), fullPage: true });
          const m = await page.evaluate(measure);
          m.gradSampled = await sampleGrad(browser, full, m.grad); delete m.grad;
          report.pages[tag] = { status, errors, ...m };
          await ctx.close();
        }
      }
    }
    if (label === 'dopo') {
      // Tastiera: barra delle sezioni sull'edizione, pausa e celle del Terminale in home.
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.route('**/*', r => r.request().url().startsWith(host) ? r.continue() : r.abort());
      await page.goto(host + '/edizione-26', { waitUntil: 'networkidle' });
      await page.focus('.secbar a'); await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, 'focus-barra-sezioni.png') });
      report.keyboard.secbar = await page.evaluate(() => { const a = document.activeElement; return a.textContent + ' outline ' + getComputedStyle(a).outlineStyle; });
      await page.keyboard.press('Enter'); await page.waitForTimeout(600);
      report.keyboard.anchor = await page.evaluate(() => location.hash + ' attiva: ' + ([...document.querySelectorAll('.secbar a[aria-current="true"]')].map(a => a.textContent).join(',') || 'nessuna'));
      await page.screenshot({ path: path.join(out, 'barra-sezioni-attiva.png') });
      await page.goto(host + '/', { waitUntil: 'networkidle' });
      await page.focus('.tm-pause'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      report.keyboard.pause = await page.evaluate(() => document.querySelector('.term').classList.contains('paused') + ' ' + document.querySelector('.tm-pause').getAttribute('aria-pressed'));
      await page.locator('.term').screenshot({ path: path.join(out, 'focus-pausa-terminale.png') });
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(250);
      report.keyboard.cell = await page.evaluate(() => document.activeElement.getAttribute('href'));
      await page.locator('.term').screenshot({ path: path.join(out, 'focus-cella-terminale.png') });
      await ctx.close();
    }
  } finally {
    await browser.close(); srv.kill();
  }
  fs.writeFileSync(path.join(out, 'misure.json'), JSON.stringify(report, null, 1) + '\n');
  const L = [`# QA fase 3: ${label}`, ''];
  for (const [k, v] of Object.entries(report.pages)) {
    const gfail = (v.gradSampled || []).filter(x => !x.ok);
    const f = v.form && v.form.email ? ` · email ${v.form.email.top}-${v.form.email.bottom}, bottone fino a ${v.form.button.bottom}, consenso fino a ${v.form.consent && v.form.consent.bottom}` : '';
    L.push(`- **${k}** (${v.status}): h1 ${v.h1} · overflow ${v.overflow} · testo piccolo ${v.small.length} · target <44px ${v.taps.length} · contrasti sotto soglia ${v.contrast.length} (min ${v.minContrast}:1) · su gradiente ${gfail.length} su ${(v.gradSampled || []).length} (min ${Math.min(...(v.gradSampled || []).map(x => x.c), 99)}:1) · KPI troncati ${v.kpiFit.filter(x => !x).length} · errori console ${v.errors.length}${f}`);
    [...v.small, ...v.taps, ...v.contrast, ...gfail.map(x => `${x.c}:1 «${x.t}»`), ...v.errors].forEach(x => L.push(`  - ${x}`));
  }
  L.push('', `Rete: /api/subscribe ${report.network.subscribe} (tutte simulate) · /api/admin-db ${report.network.adminDb} (bloccate) · esterne bloccate ${report.network.external.length} ${[...new Set(report.network.external)].slice(0, 5).join(' ')}`);
  if (label === 'dopo') L.push('', 'Tastiera: ' + JSON.stringify(report.keyboard));
  fs.writeFileSync(path.join(out, 'misure.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
  if (label === 'dopo' && dataFile) require('./qa-fase-3-dati.js')(root, JSON.parse(fs.readFileSync(dataFile, 'utf8')), base3);
})().catch(e => { console.error(e); process.exit(1); });
