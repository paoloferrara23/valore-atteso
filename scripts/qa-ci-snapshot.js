// scripts/qa-ci-snapshot.js — Snapshot testuale di /club-intelligence per il confronto prima/dopo della Fase 4.
// Uso: node scripts/qa-ci-snapshot.js <cartella-sito> <uscita.txt> <dati.json> [--snapshot] [--porta=8794]
// <dati.json>: { clubs:[…], club_financials:[…], club_deals:[…] } esportati in sola lettura (stesse righe delle 3 GET).
// Le 3 GET a Supabase ricevono quei dati (stato "live" identico tra prima e dopo); con --snapshot vengono bloccate
// e resta lo snapshot incorporato. /api/subscribe e /api/admin-db sono bloccati; ogni richiesta è nel log di rete.
// Estrae: per ogni metrica la classifica (posizione, club, valore) con nota e "Come leggerla"; per ogni club e ogni
// vista il testo mostrato (valori, note, fonti, deal). Movimento ridotto: i contatori mostrano subito il valore finale.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const [root, outFile, dataFile] = process.argv.slice(2);
const snapshotOnly = process.argv.includes('--snapshot');
const port = +((process.argv.find(a => a.startsWith('--porta=')) || '--porta=8794').split('=')[1]);
const base = `http://localhost:${port}`;
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
// Testo normalizzato: spazi compattati, maiuscolo/minuscolo ignorato (il CSS text-transform cambia innerText).
const norm = s => String(s || '').replace(/ /g, ' ').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).map(l => l.toLowerCase());

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'qa-serve.js'), path.resolve(root), String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch();
  const net = [];
  const out = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/*', async r => {
      const req = r.request(), u = new URL(req.url());
      net.push(`${req.method()} ${u.host === `localhost:${port}` ? u.pathname : u.host + u.pathname + u.search}`);
      if (u.host === `localhost:${port}`) {
        if (u.pathname.startsWith('/api/')) return r.abort();
        return r.continue();
      }
      if (/supabase\.co$/.test(u.host) && req.method() === 'GET' && u.pathname.startsWith('/rest/v1/') && !snapshotOnly) {
        const table = u.pathname.split('/').pop();
        if (data[table]) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data[table]) });
      }
      return r.abort();
    });
    await page.goto(`${base}/club-intelligence`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const text = sel => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);

    out.push('## stato', ...norm(await text('#foot')), ...norm(await text('#head')));
    out.push('## club in navigazione', ...norm(await text('#nav')));
    out.push('## home: testata e insight', ...norm(await text('.hero')));

    const metrics = await page.$$eval('[data-metric]', els => els.map(e => e.dataset.metric));
    for (const m of metrics) {
      await page.click(`[data-metric="${m}"]`);
      await page.waitForTimeout(150);
      out.push(`## classifica ${m}`, ...norm(await text('#metricNote')), ...norm(await text('#metricVerdict')));
      const rows = await page.$$eval('#peersBody [data-row]', rs => rs.map(r => [r.querySelector('.prank'), r.querySelector('.pclub'), r.querySelector('.pval')].map(x => (x ? x.innerText : '').replace(/\s+/g, ' ').trim()).join(' | ')));
      out.push(...rows.map(r => r.toLowerCase()));
    }

    const clubs = await page.$$eval('#nav [data-club]', els => els.map(e => e.dataset.club));
    for (const c of clubs) {
      await page.click(`#nav [data-club="${c}"]`);
      await page.waitForTimeout(150);
      const tabs = await page.$$eval('#tabs [data-tab]', els => els.map(e => e.dataset.tab));
      for (const t of tabs) {
        await page.click(`#tabs [data-tab="${t}"]`);
        await page.waitForTimeout(150);
        out.push(`## club ${c} · ${t}`, ...norm(await text('#head')), ...norm(await text('#stage')));
      }
    }
    out.push('## errori console', ...errors);
    await ctx.close();
  } finally {
    await browser.close();
    srv.kill();
  }
  out.push('## rete', ...net.filter((x, i, a) => a.indexOf(x) === i));
  fs.writeFileSync(outFile, out.join('\n') + '\n');
  console.log(`${outFile}: ${out.length} righe; rete: ${net.filter(x => /supabase/.test(x)).length} richieste Supabase, ${net.filter(x => /\/api\//.test(x)).length} verso /api`);
})().catch(e => { console.error(e); process.exit(1); });
