// scripts/qa-fase-2-c.js — QA della landing /iscriviti (fase 2 C). Nessuna richiesta reale: /api/subscribe è simulata.
// Uso: node scripts/qa-fase-2-c.js [cartella-del-sito]   → qa/fase-2-c/ (screenshot e misure.json)
// Larghezze 320, 375, 640, 1280: screenshot, posizione di campo, bottone e consenso, contrasti, aree di tocco,
// overflow, richieste e peso totale; stati del modulo con e senza UTM (il source inviato deve contenerli).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(process.argv[2] || '.');
const out = path.join(__dirname, '..', 'qa', 'fase-2-c');
fs.mkdirSync(out, { recursive: true });
const port = 8792;
const base = `http://localhost:${port}`;

function measure() {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = c => { const [r, g, b] = rgb(c).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alpha = c => { const v = rgb(c); return v.length > 3 ? v[3] : 1; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (alpha(bg) > 0.5) return bg; } return 'rgb(255, 255, 255)'; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const o = { contrast: [], minContrast: 99, small: [], taps: [] };
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own || !vis(el)) return;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const upperMono = /mono|Menlo|Consolas/i.test(cs.fontFamily) && cs.textTransform === 'uppercase';
    if (size < 11 || (size < 12 && !upperMono)) o.small.push(`${size}px «${own.slice(0, 30)}»`);
    const l1 = lum(cs.color), l2 = lum(bgOf(el));
    const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    o.minContrast = Math.min(o.minContrast, +r.toFixed(2));
    if (r < (large ? 3 : 4.5)) o.contrast.push(`${r.toFixed(2)}:1 «${own.slice(0, 30)}»`);
  });
  document.querySelectorAll('a, button, input, label.va-consent').forEach(el => {
    if (!vis(el) || el.classList.contains('va-skip')) return;
    const r = el.getBoundingClientRect();
    if (el.type === 'checkbox') return;
    if (r.height < 43.5 && !el.closest('label, p')) o.taps.push(`${Math.round(r.width)}×${Math.round(r.height)} «${(el.textContent || el.placeholder || '').trim().slice(0, 24)}»`);
  });
  const g = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), h: Math.round(r.height) }; };
  o.email = g('#form-email'); o.button = g('#form-btn'); o.consent = g('.va-consent'); o.card = g('.card');
  o.kpi = [...document.querySelectorAll('.hk-v')].map(e => ({ v: e.textContent, fits: e.scrollWidth <= e.clientWidth + 1 }));
  o.overflow = document.documentElement.scrollWidth > innerWidth + 1;
  o.h1 = document.querySelectorAll('h1').length;
  o.robots = (document.querySelector('meta[name=robots]') || {}).content;
  o.inlineBytes = new Blob([document.documentElement.outerHTML]).size;
  return o;
}

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'qa-serve.js'), root, String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch();
  const report = { views: {}, form: {}, external: [] };
  try {
    for (const w of [320, 375, 640, 1280]) {
      const h = w < 640 ? 812 : 900;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      const errors = [], requests = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(String(e)));
      page.on('response', async r => { try { const b = await r.body(); requests.push({ url: r.url().replace(base, ''), bytes: b.length }); } catch (e) { requests.push({ url: r.url().replace(base, ''), bytes: 0 }); } });
      await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith(base)) return r.continue(); report.external.push(u); return r.abort(); });
      await page.goto(`${base}/iscriviti`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `iscriviti-${w}-fold.png`) });
      await page.screenshot({ path: path.join(out, `iscriviti-${w}.png`), fullPage: true });
      const m = await page.evaluate(measure);
      report.views[w] = { ...m, errors, requests, totalBytes: requests.reduce((a, r) => a + r.bytes, 0) };
      await ctx.close();
    }
    // Modulo: consenso mancante, successo con UTM del link in bio, errore server.
    const states = [['consenso', '', false, 'test@example.com', 200], ['successo-utm', '?utm_source=instagram&utm_medium=bio&utm_campaign=autunno', true, 'test@example.com', 200], ['errore-server', '', true, 'test@example.com', 500]];
    for (const [name, qs, check, email, status] of states) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      let payload = null;
      await page.route('**/api/subscribe', r => { payload = r.request().postDataJSON(); r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: status === 200 }) }); });
      await page.goto(`${base}/iscriviti${qs}`, { waitUntil: 'networkidle' });
      if (check) await page.check('#form-check');
      await page.fill('#form-email', email);
      await page.press('#form-email', 'Enter');
      await page.waitForTimeout(400);
      report.form[name] = await page.evaluate(() => ({ url: location.pathname + location.search, err: [...document.querySelectorAll('.va-err-msg.on')].map(e => e.textContent),
        msg: getComputedStyle(document.getElementById('form-ok')).display !== 'none' ? document.getElementById('form-ok').textContent : null, btn: document.getElementById('form-btn').textContent }));
      report.form[name].source = payload && payload.source;
      report.form[name].payloadKeys = payload && Object.keys(payload);
      await page.locator('#signup').screenshot({ path: path.join(out, `form-${name}.png`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
  fs.writeFileSync(path.join(out, 'misure.json'), JSON.stringify(report, null, 1) + '\n');
  for (const [w, v] of Object.entries(report.views)) {
    console.log(`${w}: overflow ${v.overflow} · h1 ${v.h1} · robots "${v.robots}" · email ${v.email.top}-${v.email.bottom} · bottone ${v.button.top}-${v.button.bottom} (${v.button.h}px) · consenso fino a ${v.consent.bottom} · card ${v.card.top} · KPI ${v.kpi.map(k => k.v + (k.fits ? '' : ' NON ENTRA')).join(', ')} · contrasti min ${v.minContrast}:1 sotto soglia ${v.contrast.length} · testo piccolo ${v.small.length} · target <44 ${v.taps.length} · errori ${v.errors.length} · ${v.requests.length} richieste, ${Math.round(v.totalBytes / 1024)} KB`);
    [...v.contrast, ...v.small, ...v.taps, ...v.errors].forEach(x => console.log('   ', x));
  }
  console.log('richieste a 375:', report.views[375].requests.map(r => `${r.url} ${Math.round(r.bytes / 1024)}KB`).join(' · '));
  console.log('modulo', JSON.stringify(report.form));
  console.log('esterne bloccate', report.external.length);
})().catch(e => { console.error(e); process.exit(1); });
