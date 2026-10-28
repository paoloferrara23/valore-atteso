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
  { loc: '/sponsor', changefreq: 'monthly', priority: '0.5' },
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

// Data in italiano ("27 ott 2026") dentro <time datetime>, come in /archivio (vaSetDate in va.js).
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function isoDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\s+([a-zà]+)\s+(\d{4})$/i.exec(s);
  const i = m ? MESI.indexOf(m[2].toLowerCase()) : -1;
  return i >= 0 ? `${m[3]}-${String(i + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : null;
}
function timeTag(v) {
  const iso = isoDate(v);
  if (!iso) return esc(v);
  const txt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(iso + 'T00:00:00Z')).replace(/\./g, '');
  return `<time datetime="${iso}">${esc(txt)}</time>`;
}

// Form di cattura email inline (un solo campo, nessun redirect). Il source
// per-edizione permette di sapere quale contenuto converte (es. edizione-020__fine).
function inlineForm(source, cta) {
  return `<form class="vaform" data-source="${esc(source)}" onsubmit="return vaSub(this)" novalidate>
    <div class="vaform-row">
      <input type="email" name="email" required placeholder="La tua email" autocomplete="email" aria-label="Email">
      <button type="submit" class="va-btn-primary">${esc(cta || 'Iscriviti gratis')}</button>
    </div>
    <div class="vaform-status" aria-live="polite"></div>
  </form>`;
}

// Barra fissa che compare a ~70% di scroll (una volta per visitatore).
function scrollBar(source) {
  return `<div id="va-scroll-cta" class="va-on-dark" role="region" aria-label="Iscrizione">
  <div class="sc-in">
    <div class="sc-t">Ti sta piacendo? Ricevila ogni martedì, con il caffè.</div>
    ${inlineForm(source, 'Iscriviti')}
    <button class="sc-close" aria-label="Chiudi" onclick="var e=document.getElementById('va-scroll-cta');if(e)e.style.display='none';">×</button>
  </div>
</div>`;
}

// vaSub(form) sta in /va.js, condiviso con /archivio.
const SUBSCRIBE_JS = `<script src="/va.js"></script>
<script>
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

// Edizioni escluse dall'immagine di condivisione dedicata (usano la generica /og.png).
const OG_EXCLUDED = ['018', '019'];
const ogFile = num => path.join(ROOT, 'og', slug(num) + '.png');
function ogImageFor(ed) {
  const n = String(ed.num).padStart(3, '0');
  if (OG_EXCLUDED.includes(n) || !fs.existsSync(ogFile(ed.num))) return null;
  return `${SITE}/og/${slug(ed.num)}.png`;
}

// Icona busta (SVG inline, monocromatica) per il bottone di condivisione via email.
const ICON_MAIL = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';

// nav = { prev, next }: edizione precedente (più vecchia) e successiva (più recente), se esistono.
function buildEditionHtml(ed, nav = {}) {
  const url = SITE + '/' + slug(ed.num);
  const desc = metaDescription(ed);
  const sections = Array.isArray(ed.sections) ? ed.sections : [];
  const og = ogImageFor(ed);
  const ogUrl = og || `${SITE}/og.png`;
  const ogAlt = og ? `Valore Atteso #${ed.num}. ${ed.title}` : 'Valore Atteso. Il calcio dei numeri, non dei goal.';

  // Card "In sintesi": il primo KPI di ogni sezione, con il salto alla sezione (sub con nomi di testate omesso).
  const kpiCells = sections.map((s, i) => {
    const k = (Array.isArray(s.kpis) ? s.kpis : [])[0] || {};
    if (!k.value && !k.label) return '';
    const neg = /^\s*[-−]/.test(k.value || '');
    return `<li class="sk">
      ${s.label ? `<span class="sk-sez">${esc(s.label)}</span>` : ''}
      <span class="sk-v${neg ? ' neg' : ''}">${esc(k.value || '')}</span>
      <span class="sk-l">${esc(k.label || k.key || '')}</span>
      ${k.sub && !hasBlockedName(k.sub) ? `<span class="sk-s">${esc(k.sub)}</span>` : ''}
      <a class="sk-a" href="#s${i + 1}">Leggi ↓</a>
    </li>`;
  }).filter(Boolean).join('');

  // Barra sticky delle sezioni (Il Bilancio · Il Deal · La Metrica).
  const secNav = sections.map((s, i) => s.label ? `<a href="#s${i + 1}">${esc(s.label)}</a>` : '').filter(Boolean).join('');

  const secFull = (s, n) => {
    const srcs = Array.isArray(s.sources) ? s.sources.filter(Boolean) : [];
    return `<section class="sec" id="s${n}">
      <div class="sec-head"><span class="sec-num">${n}</span><span class="sec-tag">${esc(s.label || '')}</span></div>
      <h2 class="sec-title">${esc(s.title || '')}</h2>
      ${bodyParas(s.body)}
      ${srcs.length ? `<div class="sec-src">Fonti: ${srcs.map(esc).join(' · ')}</div>` : ''}
    </section>`;
  };

  // Nessun gate: tutte le edizioni, inclusa l'ultima, si leggono per intero.
  const secHtml = sections.map((s, i) => secFull(s, i + 1)).join('');

  // Condivisione: solo email (mailto), nessuno script o servizio esterno.
  const mailHref = 'mailto:?subject=' + encodeURIComponent(`Valore Atteso #${ed.num}: ${ed.title}`) + '&body=' + encodeURIComponent(url);
  const share = `<div class="share"><a class="share-btn" href="${esc(mailHref)}" aria-label="Condividi via email">${ICON_MAIL}<span>Email</span></a></div>`;

  // Edizione precedente e successiva.
  const navLink = (e, rel, arrowFirst) => e ? `<a class="ednav-a ednav-${rel}" href="/${slug(e.num)}" rel="${rel}">
      <span class="ednav-n">${arrowFirst ? '← ' : ''}#${esc(e.num)}${arrowFirst ? '' : ' →'}</span>
      <span class="ednav-t">${esc(e.title)}</span>
    </a>` : '<span></span>';
  const edNav = (nav.prev || nav.next) ? `<nav class="ednav" aria-label="Altre edizioni">${navLink(nav.prev, 'prev', true)}${navLink(nav.next, 'next', false)}</nav>` : '';

  // Blocco finale: invito a ricevere il prossimo numero, uguale su tutte le edizioni.
  const bottomSource = 'edizione-' + ed.num + '__fine';
  const bottom = `<div class="gate va-on-dark" id="iscriviti">
    <div class="gate-k">Newsletter</div>
    <h3>Ricevila ogni martedì</h3>
    <p>Analisi, non rumore. Iscriviti gratis e ricevi anche il prossimo numero, prima di una riunione.</p>
    ${inlineForm(bottomSource, 'Iscriviti gratis')}
    <p class="gate-fine">Una email a settimana. Niente spam, disiscrizione in un clic.</p>
  </div>`;

  // Ponte verso la monetizzazione: dati completi dei bilanci.
  const ciCta = `<div class="secondary-cta">Ti servono i bilanci completi dei club? Esplora la <a href="/club-intelligence">Club Intelligence →</a></div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: ed.title || '',
    description: desc,
    image: og || undefined,
    datePublished: ed.date || undefined,
    dateModified: ed.date || undefined,
    inLanguage: 'it',
    isAccessibleForFree: true,
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
<link rel="preload" href="/fonts/playfair-display-800-latin.woff2" as="font" type="font/woff2" crossorigin>
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
<meta property="og:image" content="${ogUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ogAlt)}">
<meta property="og:locale" content="it_IT">
<meta name="twitter:image" content="${ogUrl}">
<meta name="twitter:image:alt" content="${esc(ogAlt)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/va.css">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
/* Pagina edizione (fase 2 D): testata navy, card "In sintesi" sovrapposta, barra delle sezioni, colonna 760. */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--cream:#F3EFE6;--cream2:#E7DFD2;--ink:#1C1914;--ink2:#2B2824;--muted:#4F545F;--rule:#DDD3C2;--gold:#E5962E;--deepgold:#7A5C1E;--sf:var(--va-font-text);--mn:var(--va-font-mono);--max:760px;--hdr-h:60px;--bar-h:48px;--pad:20px}
@media(min-width:640px){:root{--hdr-h:64px;--pad:24px}}
@media(min-width:1280px){:root{--hdr-h:72px}}
html{scroll-padding-top:calc(var(--hdr-h) + var(--bar-h) + 16px)}
body{background:var(--cream);color:var(--ink);font-family:var(--sf);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}

.ehdr{position:sticky;top:0;z-index:100;background:rgba(243,239,230,.96);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--rule)}
.ehdr .nav{max-width:1200px;margin:0 auto;padding:0 var(--pad);height:var(--hdr-h);display:flex;align-items:center;justify-content:space-between;gap:16px}
.ehdr .va-logo img{height:28px}
@media(min-width:1280px){.ehdr .va-logo img{height:34px}}
.nav-links{display:flex;gap:24px;align-items:center}
.nav-a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;font-family:var(--mn);font-size:12px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.nav-a:hover{color:var(--ink)}
.nav-cta{min-height:44px;padding:0 18px;font-family:var(--mn);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;border-radius:999px;display:flex;align-items:center}
@media(max-width:639px){.nav-links .nav-a{display:none}}

/* Testata navy con gradiente: kicker, H1 50/32, sottotitolo (testi invariati). */
.mast{background-color:#00266E;background-image:radial-gradient(90% 90% at 88% 0%,#0039A4 0%,#002C80 32%,#00266E 58%,#001D57 100%);color:#F3EFE6;padding:40px 0 70px}
.mast-in{max-width:var(--max);margin:0 auto;padding:0 var(--pad)}
.kicker{font-family:var(--mn);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#E5962E;font-weight:600;margin-bottom:16px}
h1{font-family:var(--va-font-display);font-weight:800;font-size:clamp(32px,calc(2vw + 24.5px),50px);line-height:1.06;letter-spacing:-.01em;color:#F3EFE6;margin-bottom:16px}
.sub{font-size:clamp(16px,calc(.45vw + 14.3px),19px);color:#D7D3CB;line-height:1.55;max-width:40em}
@media(min-width:1280px){.mast{padding:64px 0 86px}}

.wrap{max-width:var(--max);margin:0 auto;padding:0 var(--pad) 64px}

/* Card "In sintesi": sovrapposta di 30px alla testata, 3 righe su mobile, 3 colonne da 640. */
.sintesi{position:relative;margin-top:-30px;padding:20px 18px 8px;background:#FFFFFF;border:1px solid rgba(28,25,20,.14);border-top:3px solid #D67F0D;border-radius:12px;box-shadow:0 24px 50px -30px rgba(0,38,110,.45)}
.sintesi-k{font-family:var(--mn);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7A5C1E}
.sk-list{list-style:none;display:grid;grid-template-columns:minmax(0,1fr)}
.sk{display:flex;flex-direction:column;padding:14px 0 6px;border-top:1px solid var(--rule);margin-top:12px}
.sk:first-child{border-top:0;margin-top:4px}
.sk-sez{font-family:var(--mn);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7A5C1E}
.sk-v{font-family:var(--va-font-display);font-weight:800;font-size:34px;line-height:1.1;font-variant-numeric:lining-nums;color:#0039A4;margin:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-v.neg{color:#9A3A2F}
.sk-l{font-size:14px;line-height:1.4;color:#2B2824}
.sk-s{font-size:14px;line-height:1.4;color:#4F545F}
.sk-a{align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;font-family:var(--mn);font-size:12px;font-weight:600;letter-spacing:.06em;color:#0039A4}
@media(min-width:640px){
  .sintesi{padding:24px 24px 8px}
  .sk-list{grid-template-columns:repeat(3,minmax(0,1fr));column-gap:20px}
  .sk,.sk:first-child{border-top:0;margin-top:8px;padding-top:4px}
  .sk+.sk{border-left:1px solid var(--rule);padding-left:20px}
  .sk-v{font-size:clamp(28px,3.4vw,40px)}
}

/* Barra sticky delle sezioni: link alti 44px, etichette 12px. */
.secbar{position:sticky;top:var(--hdr-h);z-index:90;margin:24px calc(-1 * var(--pad)) 0;padding:0 var(--pad);background:rgba(243,239,230,.96);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--rule)}
.secbar-in{display:flex;gap:4px 20px;overflow-x:auto;scrollbar-width:none;min-height:var(--bar-h);align-items:center}
.secbar-in::-webkit-scrollbar{display:none}
.secbar a{display:inline-flex;align-items:center;min-height:44px;white-space:nowrap;font-family:var(--mn);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);border-bottom:2px solid transparent}
.secbar a:hover{color:#0039A4;border-bottom-color:#D67F0D}

.opener{font-size:17px;color:var(--ink2);margin:28px 0 8px;line-height:1.6}
.sec{margin-top:48px}
.sec-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.sec-head::after{content:'';flex:1;height:1px;background:var(--rule)}
.sec-num{width:30px;height:30px;border-radius:50%;background:var(--ink);color:var(--cream);display:flex;align-items:center;justify-content:center;font-family:var(--mn);font-size:13px;font-weight:600;flex-shrink:0}
.sec-tag{font-family:var(--mn);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7A5C1E;font-weight:600}
.sec-title{font-family:var(--va-font-display);font-weight:800;font-size:clamp(25px,calc(.8vw + 22px),32px);line-height:1.15;margin-bottom:16px}
.sec-body{color:var(--ink2);font-size:17px;line-height:1.6;margin-bottom:14px;max-width:70ch}
@media(max-width:639px){.sec-body{font-size:16px}}
.sec-src{font-family:var(--mn);font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5}

/* Condivisione: bottone ghost su chiaro, solo mailto. */
.share{margin-top:40px;display:flex;gap:12px}
.share-btn{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 20px;border:1.5px solid #0039A4;border-radius:999px;color:#0039A4;font-family:var(--mn);font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.share-btn:hover{background:#0039A4;color:#F3EFE6}

/* Edizione precedente e successiva. */
.ednav{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:40px;padding-top:24px;border-top:1px solid var(--rule)}
.ednav-a{display:flex;flex-direction:column;gap:4px;min-height:44px;padding:4px 0}
.ednav-next{text-align:right;align-items:flex-end}
.ednav-n{font-family:var(--mn);font-size:12px;font-weight:600;letter-spacing:.08em;color:#0039A4}
.ednav-t{font-family:var(--va-font-display);font-weight:800;font-size:17px;line-height:1.25;color:var(--ink)}
.ednav-a:hover .ednav-t{color:#0039A4}

/* Blocco iscrizione finale su navy, CTA oro. */
.gate{margin-top:48px;padding:40px 24px;text-align:center;background-color:#00266E;background-image:radial-gradient(90% 120% at 50% 0%,#002C80 0%,#00266E 55%,#001D57 100%);color:var(--cream);border-radius:12px;scroll-margin-top:calc(var(--hdr-h) + 16px)}
.gate-k{font-family:var(--mn);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);font-weight:600;margin-bottom:12px}
.gate h3{font-size:clamp(24px,3vw,28px);margin-bottom:10px;letter-spacing:-.01em;font-family:var(--va-font-display);font-weight:800}
.gate p{color:#D7D3CB;font-size:15px;line-height:1.6;max-width:440px;margin:0 auto 22px}
.gate-fine{font-family:var(--mn);font-size:12px;letter-spacing:.02em;color:#A9B1CC;margin-top:14px;line-height:1.5}
.gate :focus-visible{outline-color:#E5962E}
.vaform-row{display:flex;gap:8px;flex-wrap:wrap;max-width:480px;margin:0 auto}
.vaform input{flex:1;min-width:190px;height:48px;padding:0 18px;border:1.5px solid var(--va-field);border-radius:999px;font-family:var(--sf);font-size:16px;background:#fff;color:var(--ink)}
.vaform button{height:48px;padding:0 22px;font-family:var(--mn);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;border-radius:999px;cursor:pointer}
.vaform-status{font-family:var(--mn);font-size:12px;margin-top:10px;min-height:14px}
.vaform-status.ok{color:#2F6B3F}.vaform-status.err{color:#9A3A2F}
.gate .vaform input{background:rgba(243,239,230,.06);border-color:rgba(243,239,230,.6);color:#F3EFE6}
.gate .vaform input::placeholder{color:#A9B1CC}
.gate .vaform button.va-btn-primary.va-btn-primary{background:#E5962E;border-color:#E5962E;color:#1C1914}
.gate .vaform button.va-btn-primary.va-btn-primary:hover{background:#F3EFE6;border-color:#F3EFE6;color:#1C1914}
.gate .vaform-status.ok{color:#86C29A}.gate .vaform-status.err{color:#E9A08A}
.gate .vaform-row{margin-top:6px}
@media(max-width:639px){.vaform-row{flex-direction:column}.vaform input,.vaform button{flex:none;width:100%}}

.secondary-cta{max-width:var(--max);margin:26px auto 0;padding:0 var(--pad);text-align:center;font-family:var(--mn);font-size:12px;color:var(--muted)}
.secondary-cta a{color:var(--deepgold);font-weight:600;border-bottom:1px solid var(--va-gold-graphic)}
#va-scroll-cta{display:none;position:fixed;left:0;right:0;bottom:0;z-index:200;background:var(--ink);color:var(--cream);padding:12px 20px;box-shadow:0 -6px 24px rgba(0,0,0,.22)}
#va-scroll-cta .sc-in{max-width:var(--max);margin:0 auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
#va-scroll-cta .sc-t{font-family:var(--sf);font-size:15px;font-weight:600;flex:1;min-width:170px}
#va-scroll-cta .vaform-row{margin:0;flex-direction:row}
#va-scroll-cta input{height:44px;width:auto}#va-scroll-cta button{height:44px;width:auto}
#va-scroll-cta .sc-close{cursor:pointer;color:var(--gold);font-family:var(--mn);font-size:20px;line-height:1;background:none;border:0;min-width:44px;min-height:44px}
#va-scroll-cta .vaform-status{color:#86C29A}
.foot{max-width:var(--max);margin:0 auto;padding:32px var(--pad) 60px;border-top:1px solid var(--rule);margin-top:56px;font-family:var(--mn);font-size:12px;color:var(--muted);display:flex;gap:20px;flex-wrap:wrap;justify-content:center;align-items:center}
.foot a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px}
.foot a:hover{color:var(--ink)}
</style>
</head>
<body>
<a class="va-skip" href="#contenuto">Vai al contenuto</a>
<header class="ehdr"><div class="nav">
  <a href="/" class="nav-logo va-logo"><img src="/brand/svg/orizzontale-ink.svg" alt="Valore Atteso" width="96" height="32"></a>
  <div class="nav-links">
    <a href="/archivio" class="nav-a">Archivio</a>
    <a href="/club-intelligence" class="nav-a">Club Intelligence</a>
    <a href="#iscriviti" class="nav-cta va-btn-primary">Iscriviti</a>
  </div>
</div></header>

<div class="mast va-on-dark"><div class="mast-in">
  <div class="kicker">Edizione #${esc(ed.num)} · ${timeTag(ed.date)}</div>
  <h1>${esc(ed.title)}</h1>
  ${ed.subtitle ? `<p class="sub">${esc(ed.subtitle)}</p>` : ''}
</div></div>

<article class="wrap" id="contenuto">
  ${kpiCells ? `<section class="sintesi" aria-labelledby="sintesi-k"><h2 class="sintesi-k" id="sintesi-k">In sintesi · 3 numeri</h2><ol class="sk-list">${kpiCells}</ol></section>` : ''}
  ${secNav ? `<nav class="secbar" aria-label="Sezioni dell'edizione"><div class="secbar-in">${secNav}</div></nav>` : ''}
  ${ed.opener ? `<p class="opener">${esc(teaser(ed.opener, 420))}</p>` : ''}
  ${secHtml}
  ${share}
  ${edNav}
  ${bottom}
</article>
${ciCta}
${scrollBar('edizione-' + ed.num + '__scroll')}

<footer class="foot">
  <a href="/" class="va-mono"><img src="/brand/svg/monogramma-ink.svg" alt="Valore Atteso" width="64" height="44" loading="lazy"></a>
  <a href="/">Home</a>
  <a href="/archivio">Archivio</a>
  <a href="/club-intelligence">Club Intelligence</a>
  <a href="/glossario">Glossario</a>
  <a href="/privacy">Privacy</a>
</footer>
<p style="max-width:760px;margin:0 auto;padding:4px 24px 40px;font-family:var(--mn);font-size:12px;color:var(--muted);line-height:1.6;text-align:center">Contenuti prodotti con l'assistenza di sistemi di intelligenza artificiale, sotto supervisione e responsabilità editoriale umana. Fonti verificabili citate in ogni sezione.</p>
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

// ---------- home e /iscriviti: striscia "In sintesi · 3 numeri" ----------
// Il primo KPI di ogni sezione dell'ultima edizione pubblicata non esclusa, scritto statico in index.html e
// iscriviti.html tra i marcatori: si aggiorna insieme alle pagine edizione, quindi il link punta sempre a una
// pagina esistente.

const HOME_KPI_EXCLUDED = ['018', '019'];
const HOME_START = '<!-- va:home-kpi:start -->';
const HOME_END = '<!-- va:home-kpi:end -->';
const HOME_TARGETS = [
  { file: 'index.html', linkText: 'Leggi →' },
  { file: 'iscriviti.html', linkText: "Leggi l'ultima edizione →" },
];
const { blockedNames } = require('../api/_lib/email/config.js');
// Oltre ai nomi vietati dell'email, testate citate per esteso nei KPI di alcune edizioni.
const HOME_BLOCKED = blockedNames.concat(['Times', 'AFP', 'Agence France-Presse', 'Sportico', 'Gulf News']);
const hasBlockedName = s => HOME_BLOCKED.some(n => new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(String(s || '')));

function homeKpis(ed) {
  const sections = Array.isArray(ed.sections) ? ed.sections : [];
  const kpis = sections.slice(0, 3).map(s => ({ section: s.label || '', k: (Array.isArray(s.kpis) ? s.kpis : [])[0] || {} }));
  if (kpis.length !== 3 || kpis.some(x => !x.k.value || !x.k.label)) return null;
  if (kpis.some(x => hasBlockedName(x.k.value) || hasBlockedName(x.k.label) || hasBlockedName(x.section))) return null;
  return kpis;
}

function buildHomeKpi(ed, kpis, linkText = 'Leggi →') {
  const items = kpis.map(({ section, k }) => {
    const neg = /^\s*[-−]/.test(k.value);
    const sub = k.sub && !hasBlockedName(k.sub) ? `<span class="hk-s">${esc(k.sub)}</span>` : '';
    return `<li class="hk"><span class="hk-sez">${esc(section)}</span><span class="hk-v${neg ? ' neg' : ''}">${esc(k.value)}</span><span class="hk-l">${esc(k.label)}</span>${sub}</li>`;
  }).join('');
  const n = String(ed.num).padStart(3, '0');
  return `${HOME_START}<div class="hk-head"><span class="hk-kicker" id="hk-title">In sintesi · 3 numeri</span><span class="hk-ed">#${esc(n)} · ${timeTag(ed.date)}</span></div>`
    + `<p class="hk-t" id="hk-ed-title">${esc(ed.title)}</p><ol class="hk-list">${items}</ol>`
    + `<a class="hk-link" href="/${slug(ed.num)}" aria-describedby="hk-ed-title">${esc(linkText)}</a>${HOME_END}`;
}

// Riscrive solo il blocco tra i marcatori; se mancano o nessuna edizione è adatta, lascia il file com'è.
function updateHome(editions, file = path.join(ROOT, 'index.html'), linkText = 'Leggi →') {
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf(HOME_START), b = html.indexOf(HOME_END);
  if (a < 0 || b < a) { console.warn(`[generate-edition-pages] marcatori KPI assenti in ${path.basename(file)}: non aggiornato`); return false; }
  const ed = editions.find(e => !HOME_KPI_EXCLUDED.includes(String(e.num).padStart(3, '0')) && homeKpis(e));
  if (!ed) { console.warn('[generate-edition-pages] nessuna edizione adatta per la striscia KPI della home'); return false; }
  const next = html.slice(0, a) + buildHomeKpi(ed, homeKpis(ed), linkText) + html.slice(b + HOME_END.length);
  if (next !== html) fs.writeFileSync(file, next);
  return ed.num;
}

// ---------- data ----------

async function fetchEditions() {
  if (process.env.EDITIONS_FIXTURE) {
    return JSON.parse(fs.readFileSync(process.env.EDITIONS_FIXTURE, 'utf8'));
  }
  const base = process.env.SUPABASE_URL;
  const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
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
  valid.forEach((ed, i) => {
    const file = path.join(ROOT, slug(ed.num) + '.html');
    // valid è in ordine decrescente: la successiva (più recente) sta prima, la precedente dopo.
    fs.writeFileSync(file, buildEditionHtml(ed, { next: valid[i - 1], prev: valid[i + 1] }));
    written++;
  });
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), buildSitemap(valid));
  let home = false;
  for (const t of HOME_TARGETS) home = updateHome(valid, path.join(ROOT, t.file), t.linkText) || home;

  console.log(`[generate-edition-pages] ${written} pagine edizione + sitemap.xml (${valid.length} URL edizioni)` + (home ? ` + KPI home dalla #${home}` : ''));
}

module.exports = { buildEditionHtml, buildSitemap, teaser, metaDescription, slug, buildHomeKpi, homeKpis, updateHome, fetchEditions, isoDate };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
