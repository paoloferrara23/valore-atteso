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

// Corpo completo diviso in paragrafi <p> (preserva i doppi a-capo).
function bodyParas(body) {
  const paras = Array.isArray(body)
    ? body
    : String(body || '').split(/\n{2,}/);
  return paras.map(p => p.trim()).filter(Boolean)
    .map(p => `<p class="sec-body">${esc(p)}</p>`).join('');
}

// Form di cattura email inline (un solo campo, nessun redirect). Il source
// per-edizione permette di sapere quale contenuto converte (es. edizione-020__fine).
function inlineForm(source, cta) {
  return `<form class="vaform" data-source="${esc(source)}" onsubmit="return vaSub(this)" novalidate>
    <div class="vaform-row">
      <input type="email" name="email" required placeholder="La tua email" autocomplete="email" aria-label="Email">
      <button type="submit">${esc(cta || 'Iscriviti gratis')}</button>
    </div>
    <div class="vaform-status" aria-live="polite"></div>
  </form>`;
}

// Barra fissa che compare a ~70% di scroll (una volta per visitatore).
function scrollBar(source) {
  return `<div id="va-scroll-cta" role="region" aria-label="Iscrizione">
  <div class="sc-in">
    <div class="sc-t">Ti sta piacendo? Ricevila ogni martedì, con il caffè.</div>
    ${inlineForm(source, 'Iscriviti')}
    <button class="sc-close" aria-label="Chiudi" onclick="var e=document.getElementById('va-scroll-cta');if(e)e.style.display='none';">×</button>
  </div>
</div>`;
}

const SUBSCRIBE_JS = `<script>
function vaSub(form){
  var input=form.querySelector("input[type=email]");
  var btn=form.querySelector("button[type=submit]")||form.querySelector("button");
  var st=form.querySelector(".vaform-status");
  var email=(input.value||"").trim();
  if(!email||email.indexOf("@")<1){st.textContent="Inserisci un'email valida.";st.className="vaform-status err";return false;}
  var source=form.getAttribute("data-source")||"archivio";
  var old=btn.textContent;btn.disabled=true;btn.textContent="...";st.textContent="";st.className="vaform-status";
  fetch("/api/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email,source:source})})
    .then(function(r){return r.json().then(function(d){return {s:r.status,d:d};}).catch(function(){return {s:r.status,d:{}};});})
    .then(function(res){
      if(res.s===429){st.textContent="Troppi tentativi ravvicinati. Riprova tra qualche minuto.";st.className="vaform-status err";btn.disabled=false;btn.textContent=old;return;}
      if(res.d&&res.d.already){st.textContent="✓ Sei già iscritto. Sei a posto.";st.className="vaform-status ok";input.value="";btn.textContent="Fatto ✓";return;}
      if(res.d&&res.d.ok){st.textContent="✓ Controlla la tua inbox e conferma l'iscrizione (guarda anche in spam).";st.className="vaform-status ok";input.value="";btn.textContent="Fatto ✓";return;}
      st.textContent=(res.d&&res.d.error)||"Iscrizione non riuscita. Riprova.";st.className="vaform-status err";btn.disabled=false;btn.textContent=old;
    })
    .catch(function(){st.textContent="Errore di rete. Riprova.";st.className="vaform-status err";btn.disabled=false;btn.textContent=old;});
  return false;
}
(function(){
  try{if(localStorage.getItem("va_prompted")==="1")return;}catch(e){}
  var shown=false;
  function onScroll(){
    if(shown)return;
    var h=document.documentElement;
    var max=(h.scrollHeight-h.clientHeight)||1;
    var pct=(h.scrollTop||document.body.scrollTop)/max;
    if(pct<0.7)return;
    shown=true;
    try{localStorage.setItem("va_prompted","1");}catch(e){}
    var el=document.getElementById("va-scroll-cta");
    if(el)el.style.display="block";
    window.removeEventListener("scroll",onScroll);
  }
  window.addEventListener("scroll",onScroll,{passive:true});
})();
</script>`;

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

function buildEditionHtml(ed, isLatest) {
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

  const secFull = (s, n) => {
    const srcs = Array.isArray(s.sources) ? s.sources.filter(Boolean) : [];
    return `<section class="sec">
      <div class="sec-head"><span class="sec-num">${n}</span><span class="sec-tag">${esc(s.label || '')}</span></div>
      <h2 class="sec-title">${esc(s.title || '')}</h2>
      ${bodyParas(s.body)}
      ${srcs.length ? `<div class="sec-src">Fonti: ${srcs.map(esc).join(' · ')}</div>` : ''}
    </section>`;
  };

  let secHtml;
  if (isLatest) {
    // Soft-gate sull'ultima edizione: prima sezione aperta, le altre in anteprima.
    const first = sections[0] ? secFull(sections[0], 1) : '';
    const rest = sections.slice(1).map((s, i) => `<section class="sec">
      <div class="sec-head"><span class="sec-num">${i + 2}</span><span class="sec-tag">${esc(s.label || '')}</span></div>
      <h2 class="sec-title">${esc(s.title || '')}</h2>
      <p class="sec-body">${esc(teaser(s.body, 180))}</p>
      <p class="sec-locked">Continua nell'edizione completa ↓</p>
    </section>`).join('');
    secHtml = first + rest;
  } else {
    // Edizioni non più recenti: testo completo aperto (SEO + fiducia).
    secHtml = sections.map((s, i) => secFull(s, i + 1)).join('');
  }

  // Blocco finale: su ultima edizione è il gate, sulle altre un invito a ricevere il prossimo numero.
  const bottomSource = 'edizione-' + ed.num + (isLatest ? '__gate' : '__fine');
  const bottom = `<div class="gate">
    <div class="gate-k">${isLatest ? 'Anteprima' : 'Newsletter'}</div>
    <h3>${isLatest ? 'Leggi Il Deal e La Metrica' : 'Ricevila ogni martedì'}</h3>
    <p>${isLatest
      ? 'Il resto di questa edizione — e ogni nuova analisi — arriva via email. Gratis, ogni martedì in 8 minuti, con il caffè.'
      : 'Analisi, non rumore. Iscriviti gratis e ricevi anche il prossimo numero, prima di una riunione.'}</p>
    ${inlineForm(bottomSource, 'Iscriviti gratis')}
  </div>`;

  // Ponte verso la monetizzazione: dati completi dei bilanci.
  const ciCta = `<div class="secondary-cta">Ti servono i bilanci completi dei club? Esplora la <a href="/club-intelligence">Club Intelligence →</a></div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: ed.title || '',
    description: desc,
    datePublished: ed.date || undefined,
    dateModified: ed.date || undefined,
    inLanguage: 'it',
    isAccessibleForFree: !isLatest,
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
:root{--cream:#F0EBE1;--cream2:#E7DFD2;--ink:#1C1914;--ink2:#4C453D;--muted:#777066;--rule:#CEC3B2;--gold:#C8A97A;--deepgold:#8E6B33;--sf:'Source Serif 4',Georgia,serif;--mn:'JetBrains Mono',monospace;--max:760px}
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
.sec-locked{color:var(--muted);font-style:italic;margin-top:8px}
.vaform-h{font-size:1.35rem;font-weight:600;margin-bottom:6px;letter-spacing:-.3px}
.vaform-p{color:var(--ink2);font-size:14px;line-height:1.55;margin:0 auto 14px;max-width:460px}
.vaform-row{display:flex;gap:8px;flex-wrap:wrap;max-width:480px;margin:0 auto}
.vaform input{flex:1;min-width:190px;height:46px;padding:0 16px;border:1px solid var(--rule);border-radius:999px;font-family:var(--sf);font-size:15px;background:#fff;color:var(--ink)}
.vaform button{height:46px;padding:0 22px;border:0;background:var(--gold);color:var(--ink);font-family:var(--mn);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;border-radius:999px;cursor:pointer}
.vaform button:disabled{opacity:.6;cursor:default}
.vaform-status{font-family:var(--mn);font-size:11px;margin-top:10px;min-height:14px}
.vaform-status.ok{color:#2F6B3F}.vaform-status.err{color:#B3402F}
.midcta{margin:40px 0;padding:24px 26px;border:1px solid var(--rule);border-radius:14px;background:var(--cream2);text-align:center}
.midcta .vaform-h{font-size:1.1rem}
.gate .vaform-status.ok{color:#9BE3B0}.gate .vaform-status.err{color:#F0A79A}
.gate .vaform-row{margin-top:6px}
.secondary-cta{max-width:var(--max);margin:26px auto 0;text-align:center;font-family:var(--mn);font-size:12px;color:var(--muted)}
.secondary-cta a{color:var(--deepgold);font-weight:600;border-bottom:1px solid var(--gold)}
#va-scroll-cta{display:none;position:fixed;left:0;right:0;bottom:0;z-index:200;background:var(--ink);color:var(--cream);padding:12px 20px;box-shadow:0 -6px 24px rgba(0,0,0,.22)}
#va-scroll-cta .sc-in{max-width:var(--max);margin:0 auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
#va-scroll-cta .sc-t{font-family:var(--sf);font-size:15px;font-weight:600;flex:1;min-width:170px}
#va-scroll-cta .vaform-row{margin:0}
#va-scroll-cta input{height:40px}#va-scroll-cta button{height:40px}
#va-scroll-cta .sc-close{cursor:pointer;color:var(--gold);font-family:var(--mn);font-size:20px;line-height:1;background:none;border:0;padding:4px 8px}
#va-scroll-cta .vaform-status{color:#9BE3B0}
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
  ${bottom}
</article>
${ciCta}
${isLatest ? '' : scrollBar('edizione-' + ed.num + '__scroll')}

<footer class="foot">
  <a href="/">Home</a>
  <a href="/archivio">Archivio</a>
  <a href="/club-intelligence">Club Intelligence</a>
  <a href="/glossario">Glossario</a>
  <a href="/privacy">Privacy</a>
</footer>
<p style="max-width:760px;margin:0 auto;padding:4px 24px 40px;font-family:var(--mn);font-size:10px;color:var(--muted);line-height:1.6;text-align:center">Contenuti prodotti con l'assistenza di sistemi di intelligenza artificiale, sotto supervisione e responsabilità editoriale umana. Fonti verificabili citate in ogni sezione.</p>
${SUBSCRIBE_JS}
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

  // L'edizione con num più alto è l'ultima: soft-gate. Tutte le altre: aperte.
  const latestNum = valid.length ? Math.max(...valid.map(e => parseInt(e.num, 10) || 0)) : -1;

  let written = 0;
  for (const ed of valid) {
    const isLatest = (parseInt(ed.num, 10) || 0) === latestNum;
    const file = path.join(ROOT, slug(ed.num) + '.html');
    fs.writeFileSync(file, buildEditionHtml(ed, isLatest));
    written++;
  }
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), buildSitemap(valid));

  console.log(`[generate-edition-pages] ${written} pagine edizione + sitemap.xml (${valid.length} URL edizioni)`);
}

module.exports = { buildEditionHtml, buildSitemap, teaser, metaDescription, slug };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
