// scripts/generate-edition-pages.js
// Genera una pagina statica indicizzabile per ogni edizione pubblicata
// (anteprima SEO + gate iscrizione) e rigenera sitemap.xml.
// Nessuna dipendenza esterna: usa fetch nativo (Node 20+).
//
// Uso in CI: env SUPABASE_URL + SUPABASE_KEY -> legge le edizioni live.
// Uso in test: env EDITIONS_FIXTURE=path.json -> legge da file locale.

const fs = require('fs');
const path = require('path');

const SITE = 'https://www.valoreatteso.com';
const ROOT = path.resolve(__dirname, '..');
const PREVIEW_CHARS = 320;

// Pagine statiche del sito (URL puliti, senza estensione) per il sitemap.
const STATIC_PAGES = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/archivio', changefreq: 'weekly', priority: '0.9' },
  { loc: '/club-intelligence', changefreq: 'weekly', priority: '0.9' },
  { loc: '/about', changefreq: 'monthly', priority: '0.7' },
  { loc: '/glossario', changefreq: 'monthly', priority: '0.6' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { loc: '/cookie-policy', changefreq: 'yearly', priority: '0.2' },
  { loc: '/disclaimer', changefreq: 'yearly', priority: '0.2' }
];

// ---------- helpers ----------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bodyToText(body) {
  if (Array.isArray(body)) return body.join('\n\n');
  return body || '';
}

// Teaser: primi ~PREVIEW_CHARS caratteri, tagliati a fine frase quando possibile.
function teaser(body, maxChars = PREVIEW_CHARS) {
  const t = bodyToText(body).replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (lastStop > maxChars * 0.55) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function metaDescription(ed) {
  const base = ed.subtitle || bodyToText(ed.opener) || ed.title || '';
  const clean = String(base).replace(/\s+/g, ' ').trim();
  return clean.length > 155 ? clean.slice(0, 152).trim() + '…' : clean;
}

function slug(num) {
  const n = parseInt(num, 10);
  return 'edizione-' + (Number.isFinite(n) ? n : String(num));
}

// ---------- template pagina ----------

function buildEditionHtml(ed) {
  const url = SITE + '/' + slug(ed.num);
  const desc = metaDescription(ed);
  const sections = Array.isArray(ed.sections) ? ed.sections : [];

  // KPI bar: il primo KPI di ogni sezione
  const kpiCells = sections.map(s => {
    const k = (Array.isArray(s.kpis) ? s.kpis : [])[0] || {};
    if (!k.value && !k.label) return '';
    return `<div class="kpi-cell">
      ${s.label ? `<div class="kpi-sez">${esc(s.label)}</div>` : ''}
      <div class="kpi-lbl">${esc(k.label || k.key || '')}</div>
      <div class="kpi-val">${esc(k.value || '')}</div>
      ${k.sub ? `<div class="kpi-sub">${esc(k.sub)}</div>` : ''}
    </div>`;
  }).filter(Boolean).join('');

  const secHtml = sections.map((s, i) => {
    const srcs = Array.isArray(s.sources) ? s.sources.filter(Boolean) : [];
    return `<section class="sec">
      <div class="sec-head"><span class="sec-num">${i + 1}</span><span class="sec-tag">${esc(s.label || '')}</span></div>
      <h2 class="sec-title">${esc(s.title || '')}</h2>
      <p class="sec-body">${esc(teaser(s.body))}</p>
      ${srcs.length ? `<div class="sec-src">Fonti: ${srcs.map(esc).join(' · ')}</div>` : ''}
    </section>`;
  }).join('');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: ed.title || '',
    description: desc,
    datePublished: ed.date || undefined,
    dateModified: ed.date || undefined,
    inLanguage: 'it',
    isAccessibleForFree: false,
    author: { '@type': 'Organization', name: 'Valore Atteso' },
    publisher: {
      '@type': 'Organization', name: 'Valore Atteso',
      url: SITE
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    articleSection: (ed.tags || []).join(', ') || undefined
  };

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(ed.title)} — Valore Atteso #${esc(ed.num)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(ed.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Valore Atteso">
<meta property="article:published_time" content="${esc(ed.date)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ed.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,300;8..60,400;8..60,600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--cream:#F0EBE1;--ink:#1C1914;--ink2:#4C453D;--muted:#777066;--rule:#CEC3B2;--gold:#C8A97A;--deepgold:#8E6B33;--sf:'Source Serif 4',Georgia,serif;--mn:'JetBrains Mono',monospace;--max:760px}
body{background:var(--cream);color:var(--ink);font-family:var(--sf);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
nav{position:sticky;top:0;z-index:100;background:rgba(240,235,225,.94);backdrop-filter:blur(14px);border-bottom:1px solid var(--rule)}
.nav{max-width:1120px;margin:0 auto;padding:0 24px;height:64px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.nav-logo{font-family:var(--sf);font-size:1.9rem;font-weight:600;letter-spacing:-.8px}
.nav-links{display:flex;gap:24px;align-items:center}
.nav-a{font-family:var(--mn);font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.nav-a:hover{color:var(--ink)}
.nav-cta{height:38px;padding:0 18px;border:1px solid var(--ink);background:var(--ink);color:var(--cream);font-family:var(--mn);font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;border-radius:999px;display:flex;align-items:center}
.wrap{max-width:var(--max);margin:0 auto;padding:56px 24px 88px}
.kicker{font-family:var(--mn);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--deepgold);font-weight:600;margin-bottom:16px}
h1{font-size:clamp(2rem,5vw,3rem);font-weight:600;letter-spacing:-.8px;line-height:1.06;margin-bottom:18px}
.sub{font-size:19px;color:var(--ink2);font-weight:300;line-height:1.7;padding:20px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.opener{font-size:18px;color:var(--ink2);margin:28px 0 8px;line-height:1.7}
.kpi-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule);margin:32px 0}
.kpi-cell{background:var(--cream);padding:16px 14px}
.kpi-sez{font-family:var(--mn);font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--deepgold);margin-bottom:8px;font-weight:600}
.kpi-lbl{font-family:var(--mn);font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.kpi-val{font-size:20px;font-weight:600;letter-spacing:-.4px}
.kpi-sub{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.35}
.sec{margin-top:44px}
.sec-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.sec-num{width:26px;height:26px;border:1px solid var(--ink);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--mn);font-size:12px;font-weight:600;flex-shrink:0}
.sec-tag{font-family:var(--mn);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--deepgold);font-weight:600}
.sec-title{font-size:clamp(1.4rem,3.5vw,1.9rem);font-weight:600;letter-spacing:-.4px;line-height:1.14;margin-bottom:14px}
.sec-body{color:var(--ink2);line-height:1.72}
.sec-src{font-family:var(--mn);font-size:11px;color:var(--muted);margin-top:12px;line-height:1.5}
.gate{position:relative;margin-top:48px;padding:40px 28px;text-align:center;background:var(--ink);color:var(--cream);border-radius:8px}
.gate::before{content:'';position:absolute;left:0;right:0;top:-64px;height:64px;background:linear-gradient(to bottom,transparent,var(--cream))}
.gate-k{font-family:var(--mn);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);font-weight:600;margin-bottom:12px}
.gate h3{font-size:1.5rem;font-weight:600;margin-bottom:10px;letter-spacing:-.4px}
.gate p{color:#D8CCB9;font-size:15px;line-height:1.6;max-width:440px;margin:0 auto 22px}
.gate-cta{display:inline-flex;align-items:center;height:46px;padding:0 28px;background:var(--gold);color:var(--ink);font-family:var(--mn);font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;border-radius:999px}
.foot{max-width:var(--max);margin:0 auto;padding:32px 24px 60px;border-top:1px solid var(--rule);margin-top:56px;font-family:var(--mn);font-size:11px;color:var(--muted);display:flex;gap:20px;flex-wrap:wrap;justify-content:center}
.foot a:hover{color:var(--ink)}
@media(max-width:560px){.kpi-bar{grid-template-columns:1fr}.nav-links .nav-a{display:none}}
</style>
</head>
<body>
<nav><div class="nav">
  <a href="/" class="nav-logo">Valore Atteso</a>
  <div class="nav-links">
    <a href="/archivio" class="nav-a">Archivio</a>
    <a href="/club-intelligence" class="nav-a">Club Intelligence</a>
    <a href="/" class="nav-cta">Iscriviti</a>
  </div>
</div></nav>

<article class="wrap">
  <div class="kicker">Edizione #${esc(ed.num)} · ${esc(ed.date)}</div>
  <h1>${esc(ed.title)}</h1>
  ${ed.subtitle ? `<div class="sub">${esc(ed.subtitle)}</div>` : ''}
  ${ed.opener ? `<p class="opener">${esc(teaser(ed.opener, 420))}</p>` : ''}
  ${kpiCells ? `<div class="kpi-bar">${kpiCells}</div>` : ''}
  ${secHtml}
  <div class="gate">
    <div class="gate-k">Anteprima</div>
    <h3>Continua a leggere l'edizione completa</h3>
    <p>Analisi, non rumore. Ogni martedì in 8 minuti, con il caffè, prima di una riunione. Iscriviti gratis per ricevere ogni edizione e accedere all'archivio completo.</p>
    <a href="/" class="gate-cta">Iscriviti gratis →</a>
  </div>
</article>

<footer class="foot">
  <a href="/">Home</a>
  <a href="/archivio">Archivio</a>
  <a href="/club-intelligence">Club Intelligence</a>
  <a href="/glossario">Glossario</a>
  <a href="/privacy">Privacy</a>
</footer>
</body>
</html>
`;
}

function buildSitemap(editions) {
  const today = new Date().toISOString().slice(0, 10);
  const staticUrls = STATIC_PAGES.map(p =>
    `  <url>\n    <loc>${SITE}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  );
  const edUrls = editions.map(ed =>
    `  <url>\n    <loc>${SITE}/${slug(ed.num)}</loc>\n    <lastmod>${ed.date || today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticUrls.concat(edUrls).join('\n')}\n</urlset>\n`;
}

// ---------- data ----------

async function fetchEditions() {
  if (process.env.EDITIONS_FIXTURE) {
    return JSON.parse(fs.readFileSync(process.env.EDITIONS_FIXTURE, 'utf8'));
  }
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!base || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY mancanti');
  const url = base + '/rest/v1/editions?published=eq.true&order=num.desc'
    + '&select=num,title,subtitle,date,tags,opener,sections';
  const r = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function main() {
  const editions = await fetchEditions();
  const valid = editions.filter(e => e && e.num && e.title);
  valid.sort((a, b) => parseInt(b.num, 10) - parseInt(a.num, 10));

  let written = 0;
  for (const ed of valid) {
    const file = path.join(ROOT, slug(ed.num) + '.html');
    fs.writeFileSync(file, buildEditionHtml(ed));
    written++;
  }
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), buildSitemap(valid));

  console.log(`[generate-edition-pages] ${written} pagine edizione + sitemap.xml (${valid.length} URL edizioni)`);
}

module.exports = { buildEditionHtml, buildSitemap, teaser, metaDescription, slug };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
