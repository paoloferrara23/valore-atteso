// scripts/qa-fase-2-b.js — QA del blocco B (hero, modulo, striscia KPI della home). Nessuna richiesta reale.
// Uso: node scripts/qa-fase-2-b.js [cartella-del-sito]   → qa/fase-2-b/b/ (screenshot e misure.json)
// Richiede Pillow (QA_PYTHONPATH se non è nel Python di sistema).
// Per ogni variante (navy, crema) e larghezza (320, 375, 640, 1280, 1440): screenshot della prima schermata e
// della pagina intera, posizione di campo, bottone e consenso a 375×812, contrasti campionati sui pixel reali
// (la hero ha un gradiente: il colore di fondo si legge dallo screenshot, non dal CSS), header dopo lo scroll,
// stati del modulo su scuro (/api/subscribe simulata) e reduced-motion.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(process.argv[2] || '.');
const out = path.join(__dirname, '..', 'qa', 'fase-2-b', 'b');
fs.mkdirSync(out, { recursive: true });
const port = 8790;

// Testi da controllare: header, hero, striscia KPI e blocco finale. Restituisce bbox e colore del testo.
function textBoxes() {
  const sel = '.va-hdr a, .va-hdr button, .hero *, .final-cta *';
  const res = [];
  document.querySelectorAll(sel).forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own || el.closest('[aria-hidden="true"]')) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    res.push({ text: own.slice(0, 40), color: cs.color, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10),
      x: r.left, y: r.top + scrollY, w: r.width, h: r.height });
  });
  return res;
}

// Fondo = colore più frequente nel riquadro del testo (quantizzato), contrasto WCAG con il colore calcolato.
const PY = `
import sys, json, warnings
warnings.simplefilter("ignore")
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB'); boxes = json.load(open(sys.argv[2])); dpr = float(sys.argv[3])
def lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = c
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
out = []
for b in boxes:
    x0, y0 = int(b['x'] * dpr), int(b['y'] * dpr); x1, y1 = int((b['x'] + b['w']) * dpr), int((b['y'] + b['h']) * dpr)
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(img.width, x1), min(img.height, y1)
    if x1 <= x0 or y1 <= y0: continue
    crop = img.crop((x0, y0, x1, y1)).resize((max(1, (x1 - x0) // 2), max(1, (y1 - y0) // 2)))
    fg = tuple(int(float(v)) for v in b['color'].replace('rgba(', '').replace('rgb(', '').replace(')', '').split(',')[:3])
    # Il fondo è il colore più frequente tra i pixel lontani dal colore del testo (i titoli grandi riempiono il riquadro).
    counts = {}
    for p in crop.getdata():
        if sum(abs(p[i] - fg[i]) for i in range(3)) < 90: continue
        q = (p[0] // 6 * 6, p[1] // 6 * 6, p[2] // 6 * 6)
        counts[q] = counts.get(q, 0) + 1
    if not counts: continue
    bg = max(counts, key=counts.get)
    l1, l2 = lum(fg), lum(bg)
    ratio = (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    large = b['size'] >= 24 or (b['size'] >= 18.66 and b['weight'] >= 700)
    need = 3 if large else 4.5
    out.append({'text': b['text'], 'fg': '#%02X%02X%02X' % fg, 'bg': '#%02X%02X%02X' % bg, 'size': b['size'], 'ratio': round(ratio, 2), 'ok': ratio >= need})
print(json.dumps(out))
`;

(async () => {
  const srv = require('child_process').spawn('node', [path.join(__dirname, 'qa-serve.js'), root, String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch();
  const report = { variants: {}, form: {}, network: [] };
  const pyFile = path.join(out, '_contrast.py');
  fs.writeFileSync(pyFile, PY);
  try {
    for (const variant of ['navy', 'crema']) {
      report.variants[variant] = {};
      for (const w of [320, 375, 640, 1280, 1440]) {
        const h = w < 640 ? 812 : 900;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push(String(e)));
        await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith(`http://localhost:${port}`)) return r.continue(); report.network.push(u); return r.abort(); });
        await page.goto(`http://localhost:${port}/${variant === 'crema' ? '?hero=crema' : ''}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const tag = `${variant}-${w}`;
        await page.screenshot({ path: path.join(out, `home-${tag}-fold.png`) });
        await page.screenshot({ path: path.join(out, `home-${tag}.png`), fullPage: true });
        const geo = await page.evaluate(() => {
          const g = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; };
          const kpi = [...document.querySelectorAll('.hk-v')].map(e => ({ v: e.textContent, size: parseFloat(getComputedStyle(e).fontSize), fits: e.scrollWidth <= e.clientWidth + 1 }));
          return { header: g('.va-hdr .nav'), email: g('#form-email'), button: g('#form-btn'), consent: g('#form-check'), consentLabel: g('.hero .va-consent'), kpi: g('.h-kpi'), kpiValues: kpi,
            overflow: document.documentElement.scrollWidth > innerWidth + 1, h1s: document.querySelectorAll('h1').length };
        });
        const boxes = await page.evaluate(textBoxes);
        const bf = path.join(out, '_boxes.json');
        fs.writeFileSync(bf, JSON.stringify(boxes));
        const contrast = JSON.parse(execFileSync('python3', [pyFile, path.join(out, `home-${tag}.png`), bf, '2'], { env: { ...process.env, PYTHONPATH: process.env.QA_PYTHONPATH || '' } }).toString());
        fs.unlinkSync(bf);
        // Header dopo lo scroll (oltre la hero) e con il menu aperto.
        await page.evaluate(() => window.scrollTo(0, document.querySelector('.hero').offsetHeight + 200));
        await page.waitForTimeout(400);
        const solid = await page.evaluate(() => getComputedStyle(document.querySelector('.va-hdr')).backgroundColor);
        await page.screenshot({ path: path.join(out, `home-${tag}-scroll.png`) });
        report.variants[variant][w] = { geo, solidHeaderBg: solid, errors,
          contrastFails: contrast.filter(c => !c.ok), contrastMin: Math.min(...contrast.map(c => c.ratio)), contrastSample: contrast.slice(0, 60) };
        await ctx.close();
      }
    }
    // Stati del modulo della hero su scuro (375): consenso mancante, email non valida, successo, errore server.
    const states = [['consenso', false, 'mario@', null], ['email', true, 'mario@', null], ['successo', true, 'test@example.com', { status: 200, body: { ok: true } }], ['errore-server', true, 'test@example.com', { status: 500, body: { ok: false } }]];
    for (const [name, check, email, resp] of states) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      let payload = null;
      await page.route('**/api/subscribe', r => { payload = r.request().postDataJSON(); r.fulfill({ status: resp.status, contentType: 'application/json', body: JSON.stringify(resp.body) }); });
      await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
      if (check) await page.check('#form-check');
      await page.fill('#form-email', email);
      await page.press('#form-email', 'Enter');
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => ({ url: location.href, err: [...document.querySelectorAll('.hero .va-err-msg.on')].map(e => ({ text: e.textContent, color: getComputedStyle(e).color, live: e.getAttribute('aria-live') })),
        ok: getComputedStyle(document.getElementById('form-ok')).display !== 'none' ? document.getElementById('form-ok').textContent : null, btn: document.getElementById('form-btn').textContent,
        invalid: document.getElementById('form-email').getAttribute('aria-invalid') }));
      report.form[name] = { ...st, payloadKeys: payload ? Object.keys(payload) : null, source: payload && payload.source };
      await page.locator('.h-form').screenshot({ path: path.join(out, `form-${name}.png`) });
      await ctx.close();
    }
    // Reduced motion e tastiera (primi 8 Tab).
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(out, 'home-navy-1280-reduced-motion.png') });
    const tabs = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(250); // i link dell'header hanno una transizione di 150ms anche sul colore del bordo di focus
      tabs.push(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return `${e.tagName.toLowerCase()} «${(e.textContent || e.getAttribute('aria-label') || e.placeholder || '').trim().slice(0, 24)}» outline ${cs.outlineStyle} ${cs.outlineColor}`; }));
      if (i === 8) await page.screenshot({ path: path.join(out, 'focus-tab-9.png') });
    }
    report.keyboard = tabs;
    await ctx.close();
  } finally {
    await browser.close();
    srv.kill();
    fs.unlinkSync(pyFile);
  }
  fs.writeFileSync(path.join(out, 'misure.json'), JSON.stringify(report, null, 1) + '\n');
  for (const [v, ws] of Object.entries(report.variants)) for (const [w, r] of Object.entries(ws)) {
    const g = r.geo;
    console.log(`${v}-${w}: overflow ${g.overflow} · h1 ${g.h1s} · header ${g.header.h}px · email ${g.email.top}-${g.email.bottom} · bottone ${g.button.top}-${g.button.bottom} (${g.button.h}px) · consenso ${g.consentLabel.bottom} · KPI ${g.kpiValues.map(k => k.v + ' ' + k.size + 'px' + (k.fits ? '' : ' NON ENTRA')).join(', ')} · contrasti min ${r.contrastMin}:1, sotto soglia ${r.contrastFails.length} · header dopo scroll ${r.solidHeaderBg} · errori ${r.errors.length}`);
    r.contrastFails.forEach(c => console.log('   ', JSON.stringify(c)));
  }
  console.log('modulo', JSON.stringify(report.form, null, 1));
  console.log('tastiera', report.keyboard.join(' | '));
  console.log('richieste esterne bloccate', report.network.length);
})().catch(e => { console.error(e); process.exit(1); });
