// scripts/qa-fase-1.js — QA del restyling fase 1. Nessuna richiesta reale: Supabase e /api/* sono simulati.
// Uso: node scripts/qa-fase-1.js <cartella-del-sito> <etichetta>   (es. . dopo, oppure un worktree di main e "prima")
// Serve la cartella come Vercel (cleanUrls, 404.html con status 404, header CSP di vercel.json), apre le pagine
// a 1440×900 e 375×812 DPR 2, salva screenshot (pagina intera + fold) e misure in qa/fase-1/<etichetta>/.
// Con etichetta "dopo" esegue anche: stati del form (risposte simulate), tastiera, status degli asset.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const siteRoot = path.resolve(process.argv[2] || '.');
const label = process.argv[3] || 'dopo';
const repo = path.join(__dirname, '..');
const out = path.join(repo, 'qa', 'fase-1', label);
fs.mkdirSync(out, { recursive: true });
const data = f => JSON.parse(fs.readFileSync(path.join(repo, 'qa', 'fase-1', 'data', f), 'utf8'));
const LIST = data('editions-list.json');
const ED26 = data('edition-026.json');
const vercel = JSON.parse(fs.readFileSync(path.join(siteRoot, 'vercel.json'), 'utf8'));
const CSP = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };
function serve(port) {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      let p = decodeURIComponent(u.pathname);
      if (p.startsWith('/api/')) { rsp.writeHead(404); return rsp.end('api non servita in locale'); }
      const tries = p === '/' ? ['index.html'] : [p.slice(1), p.slice(1) + '.html', path.join(p.slice(1), 'index.html')];
      const hit = tries.map(t => path.join(siteRoot, t)).find(f => f.startsWith(siteRoot) && fs.existsSync(f) && fs.statSync(f).isFile());
      const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' };
      if (hit) { rsp.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(hit)] || 'application/octet-stream' }); return rsp.end(fs.readFileSync(hit)); }
      const nf = path.join(siteRoot, '404.html');
      rsp.writeHead(404, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      rsp.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
    });
    srv.listen(port, () => res(srv));
  });
}

const PAGES = [
  ['home', '/'], ['archivio', '/archivio'], ['lettore', '/archivio', 'reader'], ['about', '/about'],
  ['sponsor', '/sponsor'], ['404', '/pagina-che-non-esiste'], ['edizione-26', '/edizione-26'],
];
const VIEWS = [['1440', 1440, 900], ['375', 375, 812]];

// Misure nel browser: testo piccolo, target, overflow, contrasti, focus.
function measure() {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = c => { const [r, g, b] = rgb(c).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alpha = c => { const v = rgb(c); return v.length > 3 ? v[3] : 1; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage)) return { c: null, grad: true }; if (alpha(cs.backgroundColor) > 0.5) return { c: cs.backgroundColor }; } return { c: getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)' }; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05; };
  const o = { small: [], under12: [], contrast: [], minContrast: 99, taps: [], inlineLinks: 0, overflow: document.documentElement.scrollWidth > innerWidth + 1, scrollWidth: document.documentElement.scrollWidth };
  const hex = c => '#' + rgb(c).slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  document.querySelectorAll('body *').forEach(el => {
    if (!vis(el) || el.closest('[aria-hidden="true"]')) return;
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own) return;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const mono = /Mono|Courier|monospace/i.test(cs.fontFamily);
    const upper = cs.textTransform === 'uppercase' || own === own.toUpperCase();
    const t = own.slice(0, 40);
    if (size < 11) o.small.push(`${size}px «${t}»`);
    else if (size < 12 && !(mono && upper)) o.under12.push(`${size}px «${t}»`);
    const bg = bgOf(el);
    if (bg.grad) return;
    const fg = cs.color;
    const r = (Math.max(lum(fg), lum(bg.c)) + 0.05) / (Math.min(lum(fg), lum(bg.c)) + 0.05);
    const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    o.minContrast = Math.min(o.minContrast, r);
    if (r < (large ? 3 : 4.5)) o.contrast.push(`${r.toFixed(2)}:1 ${hex(fg)} su ${hex(bg.c)} ${size}px «${t}»`);
  });
  document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])').forEach(el => {
    if (!vis(el) || el.type === 'hidden') return;
    let box = el.getBoundingClientRect();
    if (el.type === 'checkbox' && el.closest('label')) box = el.closest('label').getBoundingClientRect();
    // Link dentro un paragrafo di testo: eccezione "inline" di WCAG, contati a parte.
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && !!el.closest('p, li, .legal-note, .va-ci, .secondary-cta, label') && !el.closest('nav, .nav, .footer-links');
    if (inline) { o.inlineLinks++; return; }
    if (box.height < 43.5 || box.width < 43.5) o.taps.push(`${Math.round(box.width)}×${Math.round(box.height)} ${el.tagName.toLowerCase()} «${(el.textContent || el.getAttribute('aria-label') || el.name || el.type || '').trim().slice(0, 30)}»`);
  });
  o.fonts = [...new Set([...document.querySelectorAll('body *')].filter(vis).map(e => getComputedStyle(e).fontFamily.split(',')[0].replace(/['"]/g, '').trim()))];
  o.title = document.title;
  o.h1 = [...document.querySelectorAll('h1')].map(h => h.textContent.trim().slice(0, 60));
  o.text = document.body.innerText;
  return o;
}

function mockRoutes(ctx, log, subscribe) {
  return ctx.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost')) {
      if (u.includes('/api/subscribe')) { log.subscribe.push(route.request().postData()); const s = subscribe(); return route.fulfill({ status: s.status, contentType: 'application/json', body: JSON.stringify(s.body) }); }
      if (u.includes('/api/get-edition-sponsors')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"sponsors":[]}' });
      if (u.includes('/api/')) { log.blocked.push(u); return route.fulfill({ status: 404, body: '{}' }); }
      return route.continue();
    }
    if (u.includes('.supabase.co/rest/v1/editions')) {
      log.supabase.push(decodeURIComponent(u.split('/rest/v1/')[1]));
      const q = new URL(u).searchParams;
      const pick = (row, sel) => (sel === '*' ? row : Object.fromEntries(sel.split(',').map(k => [k, row[k]])));
      const sel = q.get('select') || '*';
      let rows = q.get('num') ? [ED26] : q.get('limit') === '1' ? [ED26] : LIST;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.map(r => pick(r, sel))) });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.continue();
    log.blocked.push(u);
    return route.abort();
  });
}

(async () => {
  const port = 4100 + Math.floor(Math.random() * 500);
  const srv = await serve(port);
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined });
  const report = { label, pages: {}, network: {}, extra: {} };
  const log = { subscribe: [], supabase: [], blocked: [] };
  let subResp = { status: 200, body: { ok: true } };

  for (const [name, url, mode] of PAGES) {
    for (const [vw, w, h] of VIEWS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
      await mockRoutes(ctx, log, () => subResp);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
      page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 160)));
      const resp = await page.goto(base + url, { waitUntil: 'networkidle' });
      if (mode === 'reader') { await page.click('.ed-row'); await page.waitForTimeout(800); }
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.waitForTimeout(300);
      const m = await page.evaluate(measure);
      await page.screenshot({ path: path.join(out, `${name}-${vw}-fold.png`) });
      await page.screenshot({ path: path.join(out, `${name}-${vw}.png`), fullPage: true });
      delete m.text;
      report.pages[`${name}-${vw}`] = { status: resp.status(), consoleErrors: errors, ...m, minContrast: +m.minContrast.toFixed(2) };
      await ctx.close();
    }
  }

  if (label === 'dopo') {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
    await mockRoutes(ctx, log, () => subResp);
    const page = await ctx.newPage();
    // Asset e status.
    const st = {};
    for (const p of ['/og.png', '/favicon.ico', '/favicon.svg', '/apple-touch-icon-180x180.png', '/icon-512x512.png', '/site.webmanifest', '/brand/svg/orizzontale-ink.svg', '/brand/svg/monogramma-ink.svg', '/brand/svg/monogramma-crema.svg', '/pagina-che-non-esiste']) {
      const r = await page.request.get(base + p); st[p] = r.status();
    }
    report.extra.status = st;
    // Meta di condivisione per pagina.
    const metas = {};
    for (const [name, url] of PAGES.filter(p => !p[2])) {
      await page.goto(base + url);
      metas[name] = await page.evaluate(() => Object.fromEntries(['og:image', 'og:image:width', 'og:image:height', 'og:image:alt', 'og:title', 'og:description', 'og:url', 'og:type', 'twitter:card', 'twitter:image'].map(k => [k, (document.querySelector(`meta[property="${k}"],meta[name="${k}"]`) || {}).content || null]).concat([['icon', !!document.querySelector('link[rel="icon"][href="/favicon.svg"]')], ['apple', !!document.querySelector('link[rel="apple-touch-icon"]')]])));
    }
    report.extra.meta = metas;

    // Stati del form (home, form in alto): risposte simulate, nessuna richiesta reale.
    const shot = n => page.screenshot({ path: path.join(out, `form-${n}.png`), clip: { x: 0, y: 0, width: 375, height: 812 } });
    const states = {};
    await page.goto(base + '/');
    const form = '#signup-top';
    await page.locator(form).scrollIntoViewIfNeeded();
    await page.click(`${form} button[type="submit"], ${form} .submit`);
    states.consenso = await page.evaluate(f => { const c = document.querySelector(f + ' input[type=checkbox]'); return { invalid: c.getAttribute('aria-invalid'), describedby: c.getAttribute('aria-describedby'), msg: (document.getElementById(c.getAttribute('aria-describedby')) || {}).textContent || null, focus: document.activeElement === c }; }, form);
    await page.locator(form).screenshot({ path: path.join(out, 'form-errore-consenso.png') });
    await page.check(`${form} input[type=checkbox]`);
    await page.fill(`${form} input[type=email]`, 'non-una-email');
    await page.click(`${form} .submit`);
    states.email = await page.evaluate(f => { const e = document.querySelector(f + ' input[type=email]'); return { invalid: e.getAttribute('aria-invalid'), msg: (document.getElementById((e.getAttribute('aria-describedby') || '').split(' ')[0]) || {}).textContent || null, focus: document.activeElement === e }; }, form);
    await page.locator(form).screenshot({ path: path.join(out, 'form-email-non-valida.png') });
    subResp = { status: 200, body: { ok: true } };
    await page.fill(`${form} input[type=email]`, 'test@example.org');
    await page.click(`${form} .submit`);
    await page.waitForTimeout(400);
    states.successo = await page.evaluate(f => document.querySelector(f).innerText.slice(0, 160), form);
    await page.locator(form).screenshot({ path: path.join(out, 'form-successo.png') });
    await page.reload();
    subResp = { status: 500, body: { error: 'Errore simulato' } };
    await page.check(`${form} input[type=checkbox]`);
    await page.fill(`${form} input[type=email]`, 'test@example.org');
    await page.click(`${form} .submit`);
    await page.waitForTimeout(400);
    states.erroreServer = await page.evaluate(f => document.querySelector(f).innerText.slice(0, 200), form);
    await page.locator(form).screenshot({ path: path.join(out, 'form-errore-server.png') });
    report.extra.form = states;

    // Tastiera: Tab dall'inizio della home, 3 screenshot di focus, verifica anello visibile.
    const kctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
    await mockRoutes(kctx, log, () => subResp);
    const kp = await kctx.newPage();
    await kp.goto(base + '/');
    const seq = [];
    for (let i = 0; i < 60; i++) {
      await kp.keyboard.press('Tab');
      const f = await kp.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), text: (e.textContent || e.getAttribute('aria-label') || e.type || '').trim().slice(0, 30), ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none', y: Math.round(r.top + scrollY) }; });
      if (!f) break;
      seq.push(f);
      if ([1, 4, 9].includes(i)) await kp.screenshot({ path: path.join(out, `focus-${seq.length}.png`) });
    }
    report.extra.keyboard = { steps: seq.length, withoutRing: seq.filter(s => !s.ring), first: seq.slice(0, 12) };
    // Favicon nella scheda e anteprima OG renderizzata.
    await kp.setContent(`<body style="margin:0;background:#E7E4DE;font:14px Inter,Arial"><div style="display:flex;align-items:center;gap:8px;background:#fff;width:260px;padding:10px 12px;border-radius:10px 10px 0 0;margin:24px"><img src="${base}/favicon.svg" width="16" height="16"><span>Valore Atteso | Il calcio dei numeri…</span></div><div style="margin:24px;width:520px;border:1px solid #ccc;background:#fff"><img src="${base}/og.png" style="width:520px;display:block"><div style="padding:10px 12px"><div style="color:#666;font-size:12px">valoreatteso.com</div><div style="font-weight:600">Valore Atteso | Il calcio dei numeri, non dei goal</div></div></div></body>`);
    await kp.waitForTimeout(300);
    await kp.screenshot({ path: path.join(out, 'favicon-e-og.png'), clip: { x: 0, y: 0, width: 600, height: 420 } });
    await kctx.close();
    await ctx.close();
  }
  report.network = { subscribeRequests: log.subscribe.length, subscribePayloads: log.subscribe.slice(0, 3), supabaseQueries: [...new Set(log.supabase)], blockedExternal: [...new Set(log.blocked)] };
  await browser.close();
  srv.close();
  fs.writeFileSync(path.join(out, 'misure.json'), JSON.stringify(report, null, 2) + '\n');
  const L = [`# QA fase 1: ${label}`, ''];
  Object.entries(report.pages).forEach(([k, v]) => L.push(`- **${k}** (${v.status}): overflow ${v.overflow} · <11px ${v.small.length} · <12px non mono maiuscolo ${v.under12.length} · target <44px ${v.taps.length} · contrasti sotto soglia ${v.contrast.length} (min ${v.minContrast}:1) · errori console ${v.consoleErrors.length}`));
  L.push('', `Rete: richieste a /api/subscribe ${report.network.subscribeRequests} (tutte simulate) · esterne bloccate ${report.network.blockedExternal.length}`);
  fs.writeFileSync(path.join(out, 'misure.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
