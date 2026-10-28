// scripts/qa-fase-4.js — QA della Fase 4 (archivio card-dato, Confronto, Club Intelligence). Nessuna richiesta reale:
// /api/subscribe e /api/admin-db bloccati, le 3 GET di Club Intelligence ricevono i dati esportati in sola lettura.
// Uso: node scripts/qa-fase-4.js <cartella-sito> <prima|dopo> <editions.json> <ci-dati.json>   → qa/fase-4/<fase>/
// Larghezze 375, 640, 1280, 1440 (DPR 2), più 320 per le misure. Screenshot JPEG fold e pagina intera, misure.json
// (testi <12px, target <44px, overflow, errori console, rete, CLS); con "dopo" anche report-dati-archivio.md e
// report-confronto.md (valori mostrati contro la fonte) e tastiera.md (ordine del focus e frecce).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const [rootArg, fase = 'dopo', edFile, ciFile] = process.argv.slice(2);
const root = path.resolve(rootArg || '.');
const out = path.join(__dirname, '..', 'qa', 'fase-4', fase);
fs.mkdirSync(out, { recursive: true });
const port = fase === 'prima' ? 8795 : 8796;
const base = `http://localhost:${port}`;
const editions = JSON.parse(fs.readFileSync(edFile, 'utf8'));
const ciData = JSON.parse(fs.readFileSync(ciFile, 'utf8'));
const WIDTHS = [375, 640, 1280, 1440];

const PAGES = [
  ['archivio', '/archivio'],
  ['archivio-deal', '/archivio?sezione=deal'],
  ['archivio-metrica', '/archivio?sezione=metrica'],
  ['archivio-ricerca-milan', '/archivio', async p => { const q = await p.$('#arch-q'); if (q) { await q.click(); await p.keyboard.type('Milan'); await p.waitForTimeout(400); } }],
  ['archivio-ricerca-vuota', '/archivio', async p => { const q = await p.$('#arch-q'); if (q) { await q.click(); await p.keyboard.type('Real Sociedad'); await p.waitForTimeout(400); } }],
  ['confronto-real-barcellona', '/confronto'],
  ['confronto-milan-inter-2024-25', '/confronto?coppia=milan-inter-2024-25'],
  ['confronto-milan-inter-2025-26', '/confronto?coppia=milan-inter-2025-26'],
  ['ci-classifica', '/club-intelligence'],
  ['ci-inter', '/club-intelligence', async p => { await p.click('#nav [data-club="inter"]'); await p.waitForTimeout(500); }],
  ['ci-milan', '/club-intelligence', async p => { await p.click('#nav [data-club="milan"]'); await p.waitForTimeout(500); }],
  ['ci-atalanta', '/club-intelligence', async p => { await p.click('#nav [data-club="atalanta"]'); await p.waitForTimeout(500); }],
  ['about', '/about'],
  ['home', '/']
];

function measure(opts) {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity !== 0; };
  const o = { small: [], taps: [] };
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own || !vis(el) || el.closest('.va-sr')) return;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) o.small.push(`${size}px «${own.slice(0, 30)}»`);
  });
  document.querySelectorAll('a, button, input, select, [role="tab"]').forEach(el => {
    if (!vis(el) || el.classList.contains('va-skip') || el.type === 'checkbox') return;
    const r = el.getBoundingClientRect();
    const inline = el.tagName === 'A' && el.closest('p, li, label, .legal-note, .cf-src, .cf-note, figcaption') && getComputedStyle(el).display === 'inline';
    if (r.height < 43.5 && !inline) o.taps.push(`${Math.round(r.width)}×${Math.round(r.height)} ${el.tagName.toLowerCase()}.${el.className || ''} «${(el.textContent || el.placeholder || '').trim().slice(0, 24)}»`);
  });
  const sw = document.documentElement.scrollWidth;
  o.overflow = sw > innerWidth + 1;
  // Unico overflow voluto: lo scroller dei club di Club Intelligence (dentro .side, che taglia).
  o.overflowOutside = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.side, .tabs, .va-sr, .tk')).slice(0, 5).map(e => e.tagName + '.' + (typeof e.className === 'string' ? e.className : ''));
  o.h = [...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(h => h.tagName).join(' ');
  return o;
}

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'qa-serve.js'), root, String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch();
  const report = { pages: {}, net: { supabaseNonGet: 0, apiReal: 0, external: [] } };
  const routeAll = async (page, log) => {
    await page.route('**/*', r => {
      const req = r.request(), u = new URL(req.url());
      if (u.host === `localhost:${port}`) {
        if (u.pathname.startsWith('/api/')) { log.push(`BLOCCATA ${req.method()} ${u.pathname}`); return r.abort(); }
        return r.continue();
      }
      if (/supabase\.co$/.test(u.host)) {
        log.push(`${req.method()} supabase ${u.pathname}${u.search}`);
        if (req.method() !== 'GET') { report.net.supabaseNonGet++; return r.abort(); }
        const t = u.pathname.split('/').pop();
        if (ciData[t]) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ciData[t]) });
        return r.abort();
      }
      report.net.external.push(u.host); return r.abort();
    });
  };
  try {
    for (const [name, url, act] of PAGES) {
      report.pages[name] = {};
      for (const w of [320].concat(WIDTHS)) {
        const ctx = await browser.newContext({ viewport: { width: w, height: w < 640 ? 812 : 900 }, deviceScaleFactor: w === 320 ? 1 : 2 });
        const page = await ctx.newPage();
        const errors = [], log = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push(String(e)));
        await routeAll(page, log);
        await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
        const resp = await page.goto(base + url, { waitUntil: 'networkidle' });
        if (!resp || resp.status() >= 400) { report.pages[name][w] = { status: resp && resp.status() }; await ctx.close(); continue; }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(700);
        if (act) await act(page);
        await page.waitForTimeout(300);
        const m = await page.evaluate(measure);
        m.cls = +(await page.evaluate(() => window.__cls)).toFixed(3);
        m.errors = errors.filter(e => !/ERR_FAILED|ERR_BLOCKED/.test(e));
        m.net = log;
        report.pages[name][w] = m;
        if (w !== 320) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(out, `${name}-${w}-fold.jpg`), type: 'jpeg', quality: 60 });
          if (w === 375 || w === 1440) await page.screenshot({ path: path.join(out, `${name}-${w}.jpg`), type: 'jpeg', quality: 50, fullPage: true });
        }
        await ctx.close();
      }
    }
    // Archivio senza JS: tutta la griglia visibile, KPI del Bilancio nell'HTML.
    {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, javaScriptEnabled: false });
      const page = await ctx.newPage(); await routeAll(page, []);
      await page.goto(base + '/archivio', { waitUntil: 'networkidle' });
      report.nojs = await page.evaluate(() => ({ cards: document.querySelectorAll('.ed-card').length, visibili: [...document.querySelectorAll('.ed-card')].filter(c => c.getBoundingClientRect().height > 0).length, kpi: document.querySelectorAll('.ed-kv:not(:empty)').length, tools: getComputedStyle(document.querySelector('.arch-tools') || document.body).display }));
      await page.screenshot({ path: path.join(out, 'archivio-senza-js-375-fold.jpg'), type: 'jpeg', quality: 60 });
      await ctx.close();
    }

    if (fase === 'dopo') {
      // Report dati dell'archivio: valore mostrato per sezione contro il primo KPI della fonte.
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage(); await routeAll(page, []);
      const { isExcluded } = require('./edizioni-escluse.js');
      const lines = ['# Report dati · archivio card-dato', '', 'Per ogni edizione e sezione: valore, etichetta e nota mostrati sulla card (filtro attivo) contro il primo KPI della sezione nella fonte (`editions.sections[].kpis[0]`). Le edizioni escluse non mostrano numeri. Le note con nomi di testate non si mostrano.', '', '| Edizione | Sezione | Mostrato | Fonte (value · label · sub) | Link | Uguale |', '|---|---|---|---|---|:-:|'];
      let ok = 0, ko = 0;
      for (const sez of ['bilancio', 'deal', 'metrica']) {
        await page.goto(`${base}/archivio${sez === 'bilancio' ? '' : '?sezione=' + sez}`, { waitUntil: 'networkidle' });
        const shown = await page.$$eval('.ed-card', cs => cs.map(c => ({ n: c.querySelector('.ed-meta').textContent.split('·')[0].trim(), v: (c.querySelector('.ed-kv') || {}).textContent || '', l: (c.querySelector('.ed-kl') || {}).textContent || '', s: (c.querySelector('.ed-ks') || {}).textContent || '', na: !!c.querySelector('.ed-kna'), href: c.getAttribute('href') })));
        for (const c of shown) {
          const ed = editions.find(e => '#' + String(e.num).padStart(3, '0') === c.n);
          const secs = ed.sections || [];
          const re = { bilancio: /bilancio/i, deal: /\bdeal\b/i, metrica: /metrica/i }[sez];
          const s = secs.find(x => re.test(x.label || ''));
          const k = s && Array.isArray(s.kpis) ? s.kpis[0] || {} : {};
          let equal;
          if (isExcluded(ed.num)) equal = c.na && !c.v;
          else equal = c.v === (k.value || '') && c.l === (k.label || '') && (c.s === (k.sub || '') || (c.s === '' && k.sub)) && c.href === `/edizione-${parseInt(ed.num, 10)}#${sez}`;
          equal ? ok++ : ko++;
          const omitted = !isExcluded(ed.num) && c.s === '' && k.sub ? ' (nota omessa: nome di testata)' : '';
          lines.push(`| ${c.n} | ${sez} | ${isExcluded(ed.num) ? 'Numeri in revisione' : `${c.v} · ${c.l} · ${c.s}`} | ${isExcluded(ed.num) ? '(esclusa)' : `${k.value} · ${k.label} · ${k.sub || ''}${omitted}`} | ${c.href} | ${equal ? '✓' : '✗'} |`);
        }
      }
      lines.splice(4, 0, `Risultato: **${ok} ✓, ${ko} ✗** su ${ok + ko} celle (26 edizioni × 3 sezioni).`, '');
      fs.writeFileSync(path.join(out, '..', 'report-dati-archivio.md'), lines.join('\n') + '\n');
      report.archivio = { ok, ko };

      // Report del Confronto: valori mostrati, citazioni, differenze ricalcolate.
      const g = require('./generate-edition-pages.js');
      const cfg = require('./confronto-config.js');
      const { pairs, problems } = g.validateConfronto(editions, cfg);
      await page.goto(`${base}/confronto`, { waitUntil: 'networkidle' });
      const dom = await page.$$eval('.cf-pair', ps => ps.map(p => ({ id: p.id, rows: [...p.querySelectorAll('.cf-row')].map(r => ({ m: r.querySelector('.cf-m').textContent, a: r.querySelector('.cf-a .cf-v').textContent, b: r.querySelector('.cf-b .cf-v').textContent, diff: (r.querySelector('.cf-diff') || {}).textContent || '', note: (r.querySelector('.cf-note') || {}).textContent || '' })) })));
      const L = ['# Report dati · Confronto vs', '', 'Ogni valore è ricontrollato al build: la citazione deve comparire identica nel testo della sezione, il numero mostrato deve stare nella citazione. La differenza si mostra solo per valori esatti, stessa unità, stagione e fonte, ed è ricalcolata qui con aritmetica intera.', '', `Problemi del controllo al build: ${problems.length ? problems.join('; ') : 'nessuno'}.`, ''];
      let cfOk = 0, cfKo = 0;
      for (const p of pairs) {
        const d = dom.find(x => x.id === 'cf-' + p.id);
        L.push(`## ${p.a} vs ${p.b} · ${p.stagione}`, '', '| Metrica | ' + p.a + ' (citazione) | ' + p.b + ' (citazione) | Differenza mostrata | Ricalcolo | Regola |', '|---|---|---|---|---|---|');
        p.righe.forEach((r, i) => {
          const row = d.rows[i];
          const dec = Math.max(...[r.a.testo, r.b.testo].map(t => (String(t).split(',')[1] || '').length));
          const re = r.differenza ? Math.abs(Math.round(r.a.valore * 10 ** dec) - Math.round(r.b.valore * 10 ** dec)) / 10 ** dec : null;
          const shownA = row.a.replace(/^.*?: /, ''), shownB = row.b.replace(/^.*?: /, '');
          const good = shownA === r.a.testo && shownB === r.b.testo && (r.differenza ? row.diff.includes('+' + re.toFixed(dec).replace('.', ',')) : row.diff === '');
          good ? cfOk++ : cfKo++;
          L.push(`| ${r.metrica} | ${shownA} «${r.a.cit}» (#${String(r.a.ed).padStart(3, '0')} · ${r.a.sez}) | ${shownB} «${r.b.cit}» (#${String(r.b.ed).padStart(3, '0')} · ${r.b.sez}) | ${row.diff || '(nessuna)'} | ${re === null ? '-' : re.toFixed(dec).replace('.', ',')} | ${r.differenza ? 'ammessa: valori esatti, stessa edizione e fonte' : 'non ammessa: ' + (r.motivo || '«' + (r.nota && r.nota.cit) + '»')} ${good ? '✓' : '✗'} |`);
        });
        L.push('', p.lettura ? `Lettura citata: «${p.lettura.cit}» (#${String(p.lettura.ed).padStart(3, '0')} · ${p.lettura.sez})` : 'Lettura: nessun testo pubblicato, non mostrata.', '');
      }
      L.splice(6, 0, `Risultato: **${cfOk} ✓, ${cfKo} ✗** su ${cfOk + cfKo} righe.`, '');
      fs.writeFileSync(path.join(out, '..', 'report-confronto.md'), L.join('\n') + '\n');
      report.confronto = { ok: cfOk, ko: cfKo, problems };
      await ctx.close();

      // Tastiera: ordine del focus e frecce, con 3 screenshot del focus per pagina.
      const T = ['# Tastiera', ''];
      const kctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
      const kp = await kctx.newPage(); await routeAll(kp, []);
      const desc = () => kp.evaluate(() => { const a = document.activeElement; return `${a.tagName.toLowerCase()}${a.getAttribute('role') ? '[' + a.getAttribute('role') + ']' : ''} «${(a.getAttribute('aria-label') || a.textContent || a.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 28)}»`; });
      for (const [nm, url, n] of [['archivio', '/archivio', 15], ['confronto', '/confronto', 13], ['club-intelligence', '/club-intelligence', 14]]) {
        await kp.goto(base + url, { waitUntil: 'networkidle' }); await kp.waitForTimeout(600);
        const seq = [];
        for (let i = 0; i < n; i++) { await kp.keyboard.press('Tab'); seq.push(await desc()); if (i === n - 3 || i === n - 2 || i === n - 1) await kp.screenshot({ path: path.join(out, `focus-${nm}-${i + 1}.jpg`), type: 'jpeg', quality: 60 }); }
        T.push(`## ${nm}`, '', seq.map((x, i) => `${i + 1}. ${x}`).join('\n'), '');
      }
      await kp.goto(base + '/confronto', { waitUntil: 'networkidle' });
      await kp.focus('.cf-tabs [role="tab"]'); await kp.keyboard.press('ArrowRight'); const r1 = await desc(); await kp.keyboard.press('End'); const r2 = await desc(); await kp.keyboard.press('Home'); const r3 = await desc();
      T.push('## Frecce nel Confronto', '', `ArrowRight → ${r1}; End → ${r2}; Home → ${r3}. URL: ${kp.url().replace(base, '')}`, '');
      await kp.goto(base + '/club-intelligence', { waitUntil: 'networkidle' }); await kp.waitForTimeout(500);
      await kp.focus('[data-metric="revenue_total"]'); await kp.keyboard.press('ArrowRight'); const c1 = await desc(); const sel = await kp.$eval('[data-metric][aria-selected="true"]', e => e.dataset.metric);
      await kp.click('#nav [data-club="inter"]'); await kp.waitForTimeout(300); await kp.focus('#tabs [data-tab="panoramica"]'); await kp.keyboard.press('ArrowRight'); const c2 = await desc(); await kp.keyboard.press('End'); const c3 = await desc();
      T.push('## Frecce in Club Intelligence', '', `Metriche: ArrowRight → ${c1} (selezionata: ${sel}). Scheda Inter: ArrowRight → ${c2}; End → ${c3}.`, '');
      await kp.goto(base + '/archivio', { waitUntil: 'networkidle' });
      await kp.focus('#arch-q'); await kp.keyboard.type('zzz'); await kp.waitForTimeout(400); await kp.keyboard.press('Tab'); const z = await desc(); await kp.keyboard.press('Enter'); await kp.waitForTimeout(300); const z2 = await desc();
      T.push('## Archivio: stato vuoto', '', `Dopo «zzz», Tab → ${z}; Invio → focus su ${z2}, ${await kp.textContent('#arch-count')}.`, '');
      fs.writeFileSync(path.join(out, '..', 'tastiera.md'), T.join('\n') + '\n');
      await kctx.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
  fs.writeFileSync(path.join(out, 'misure.json'), JSON.stringify(report, null, 1) + '\n');
  for (const [name, ws] of Object.entries(report.pages)) {
    for (const [w, m] of Object.entries(ws)) {
      if (!m.small) { console.log(name, w, 'HTTP', m.status); continue; }
      const flag = m.small.length || m.taps.length || m.overflow || m.overflowOutside.length || m.errors.length || m.cls > 0.1;
      console.log(`${flag ? '!' : ' '} ${name} ${w}: <12px ${m.small.length} · target<44 ${m.taps.length} · overflow ${m.overflow}${m.overflowOutside.length ? ' ' + m.overflowOutside.join(',') : ''} · errori ${m.errors.length} · CLS ${m.cls} · ${m.h}`);
      if (flag && w === '375') [...m.small.slice(0, 4), ...m.taps.slice(0, 4), ...m.errors.slice(0, 3)].forEach(x => console.log('     ', x));
    }
  }
  console.log('senza JS', JSON.stringify(report.nojs), '· rete', JSON.stringify(report.net), report.archivio ? '· archivio ' + JSON.stringify(report.archivio) : '', report.confronto ? '· confronto ' + JSON.stringify(report.confronto) : '');
})().catch(e => { console.error(e); process.exit(1); });
