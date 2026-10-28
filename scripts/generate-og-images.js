// scripts/generate-og-images.js — Immagine di condivisione (Open Graph) 1200×630 per ogni edizione pubblicata.
// Uso in CI (workflow edition-pages, prima di generate-edition-pages.js): env SUPABASE_URL + SUPABASE_KEY.
// Uso in test: env EDITIONS_FIXTURE=path.json. Richiede Playwright con Chromium.
//
// Layout (fase 2 D, §3.8): fondo #0039A4 pieno, margini 64px, lockup orizzontale crema alto 60px,
// riga "#026 · 27 OTT 2026" in Plex Mono 600 24px, titolo in Playfair 800 crema 60px (56px se serve) su
// massimo 3 righe. Nessun KPI, nessun nome di testata. PNG in og/edizione-N.png, stesso URL a ogni rebuild.
// Rigenera solo se cambiano numero, data, titolo o versione del layout (og/manifest.json).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { fetchEditions, slug } = require('./generate-edition-pages.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'og');
const LAYOUT = 'og-v1';
const EXCLUDED = ['018', '019'];
const MAX_BYTES = 300 * 1024;

// Font incorporati come data URI: la pagina è caricata con setContent e non può leggere file:// dal disco.
const fontUrl = f => 'data:font/woff2;base64,' + fs.readFileSync(path.join(ROOT, 'fonts', f)).toString('base64');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function dateLabel(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return String(v || '').toUpperCase();
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)).replace(/\./g, '').toUpperCase();
}

function page(ed, logo) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><style>
@font-face{font-family:'Playfair Display';font-weight:800;src:url(${fontUrl('playfair-display-800-latin.woff2')}) format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-weight:600;src:url(${fontUrl('ibm-plex-mono-600-latin.woff2')}) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;background:#0039A4;overflow:hidden}
.c{position:absolute;inset:64px;display:flex;flex-direction:column}
.logo{height:60px;width:auto;align-self:flex-start}
.meta{margin-top:auto;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:24px;letter-spacing:.08em;color:#F3EFE6}
.t{margin-top:20px;font-family:'Playfair Display',serif;font-weight:800;font-size:60px;line-height:1.08;color:#F3EFE6;font-variant-numeric:lining-nums;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.t.s{font-size:56px}
</style></head><body><div class="c">
<img class="logo" src="${logo}" alt="">
<div class="meta">#${esc(String(ed.num).padStart(3, '0'))} · ${esc(dateLabel(ed.date))}</div>
<div class="t" id="t">${esc(ed.title)}</div>
</div></body></html>`;
}

async function main() {
  const editions = (await fetchEditions()).filter(e => e && e.num && e.title && !EXCLUDED.includes(String(e.num).padStart(3, '0')));
  fs.mkdirSync(OUT, { recursive: true });
  const manFile = path.join(OUT, 'manifest.json');
  const manifest = fs.existsSync(manFile) ? JSON.parse(fs.readFileSync(manFile, 'utf8')) : {};
  const logo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, 'brand', 'svg', 'orizzontale-crema.svg')).toString('base64');
  const todo = editions.filter(ed => {
    const h = crypto.createHash('sha1').update([LAYOUT, ed.num, ed.date, ed.title].join('|')).digest('hex').slice(0, 12);
    ed._hash = h;
    return manifest[slug(ed.num)] !== h || !fs.existsSync(path.join(OUT, slug(ed.num) + '.png'));
  });
  if (!todo.length) { console.log('[generate-og-images] nessuna immagine da rigenerare'); return; }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  for (const ed of todo) {
    await pg.setContent(page(ed, logo), { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready);
    const fontsOk = await pg.evaluate(() => document.fonts.check("800 60px 'Playfair Display'") && document.fonts.check("600 24px 'IBM Plex Mono'"));
    if (!fontsOk) throw new Error('font non caricati per ' + slug(ed.num));
    // Titoli lunghi: 56px se a 60px servono più di 3 righe (poi l'ellissi del line-clamp).
    await pg.evaluate(() => { const t = document.getElementById('t'); if (t.scrollHeight > t.clientHeight + 1) t.classList.add('s'); });
    const file = path.join(OUT, slug(ed.num) + '.png');
    await pg.screenshot({ path: file, type: 'png' });
    const size = fs.statSync(file).size;
    if (size > MAX_BYTES) throw new Error(`${path.basename(file)}: ${size} byte, oltre ${MAX_BYTES}`);
    manifest[slug(ed.num)] = ed._hash;
  }
  await browser.close();
  fs.writeFileSync(manFile, JSON.stringify(manifest, null, 1) + '\n');
  console.log(`[generate-og-images] ${todo.length} immagini in og/`);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
