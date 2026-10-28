// scripts/qa-fase-3-dati.js — Report dati e meta della fase 3, sui file statici generati (nessuna rete).
// Usato da qa-fase-3.js: module.exports(cartellaSito, edizioni, cartellaReport).
// report-dati.md: ogni valore mostrato (home, /iscriviti, Terminale ticker e tabella, card "In sintesi", OG) contro il
// campo kpis della fonte, che deve essere identico; le edizioni escluse non devono comparire nelle vetrine.
// meta.md: titoli, description, canonical, og:image (200 sul disco, 1200×630, ≤300 KB), JSON-LD e sitemap con date ISO.

const fs = require('fs');
const path = require('path');
const { isExcluded } = require('./edizioni-escluse.js');

const dec = s => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pad = n => String(n).padStart(3, '0');
const slug = n => 'edizione-' + parseInt(n, 10);
const ANCHOR = { bilancio: /bilancio/i, deal: /\bdeal\b/i, metrica: /metrica/i };
const sectionOf = (ed, id) => (ed.sections || []).find(s => ANCHOR[id].test(String(s.label || '')));
const k0 = s => ((s && Array.isArray(s.kpis) ? s.kpis : [])[0] || {}).value;

module.exports = function (root, editions, outDir) {
  const byNum = Object.fromEntries(editions.map(e => [pad(e.num), e]));
  const rows = [];
  const add = (num, where, shown, field, src) => rows.push({ num, where, shown, field, src, ok: shown === src });
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  // Home e /iscriviti: numero della settimana.
  for (const f of ['index.html', 'iscriviti.html']) {
    const html = read(f);
    const block = html.slice(html.indexOf('<!-- va:home-kpi:start -->'), html.indexOf('<!-- va:home-kpi:end -->'));
    const num = (block.match(/class="hk-ed">#(\d+)/) || [])[1];
    const vals = [...block.matchAll(/class="hk-v[^"]*">([^<]*)</g)].map(m => dec(m[1]));
    ['bilancio', 'deal', 'metrica'].forEach((id, i) => add(num, f === 'index.html' ? 'home · numero della settimana' : '/iscriviti · card', vals[i], `sections[${id}].kpis[0].value`, k0(sectionOf(byNum[num], id))));
  }
  // Terminale: ticker e tabella.
  const home = read('index.html');
  const term = home.slice(home.indexOf('<!-- va:terminale:start -->'), home.indexOf('<!-- va:terminale:end -->'));
  const run = (term.match(/<div class="tk-run">([\s\S]*?)<\/div>/) || [])[1] || '';
  const ID = { 'Il Bilancio': 'bilancio', 'Il Deal': 'deal', 'La Metrica': 'metrica' };
  for (const m of run.matchAll(/class="tk-n">#(\d+)<\/span> <span class="tk-s">([^<]*)<\/span> <span class="tk-v[^"]*">([^<]*)</g))
    add(m[1], 'Terminale · ticker', dec(m[3]), `sections[${ID[m[2]]}].kpis[0].value`, k0(sectionOf(byNum[m[1]], ID[m[2]])));
  const termNums = [];
  for (const tr of term.matchAll(/<tr><th scope="row"><a href="\/edizione-\d+"><span class="tm-n">#(\d+)<\/span>[\s\S]*?<\/tr>/g)) {
    termNums.push(tr[1]);
    const cells = [...tr[0].matchAll(/<td><a href="([^"]*)">(?:<span class="tm-v[^"]*">([^<]*)<\/span>)?/g)];
    ['bilancio', 'deal', 'metrica'].forEach((id, i) => {
      const c = cells[i] || [];
      add(tr[1], `Terminale · tabella (${c[1]})`, dec(c[2] || ''), `sections[${id}].kpis[0].value`, k0(sectionOf(byNum[tr[1]], id)) || '');
    });
  }
  // Card "In sintesi" di ogni pagina edizione e immagine di condivisione.
  const og = [];
  for (const ed of editions) {
    const html = read(slug(ed.num) + '.html');
    const card = (html.match(/<section class="sintesi"[\s\S]*?<\/section>/) || [''])[0];
    const vals = [...card.matchAll(/class="sk-v[^"]*">([^<]*)</g)].map(m => dec(m[1]));
    (ed.sections || []).forEach((s, i) => { if (k0(s)) add(pad(ed.num), '/edizione · In sintesi', vals[i], `sections[${i}].kpis[0].value`, k0(s)); });
    const img = (html.match(/property="og:image" content="([^"]*)"/) || [])[1];
    const file = img && img.includes('/og/') ? path.join(root, 'og', path.basename(img)) : path.join(root, 'og.png');
    let w = 0, h = 0, size = 0;
    if (fs.existsSync(file)) { const b = fs.readFileSync(file); size = b.length; w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    og.push({ num: pad(ed.num), img, excluded: isExcluded(ed.num), generic: !img.includes('/og/'), exists: fs.existsSync(file), w, h, kb: Math.round(size / 1024) });
  }
  const excludedShown = [...new Set(rows.filter(r => isExcluded(r.num) && !r.where.startsWith('/edizione')).map(r => r.num))];
  const ok = rows.filter(r => r.ok).length;
  const R = ['# Report dati · fase 3', '',
    `Valori controllati: **${rows.length}**, uguali alla fonte: **${ok}** (${(100 * ok / rows.length).toFixed(1)}%).`,
    `Edizioni escluse (${['018', '019', '024', '025'].join(', ')}) nelle vetrine (home, /iscriviti, Terminale): **${excludedShown.length ? excludedShown.join(', ') : 'nessuna'}**.`,
    `Righe del Terminale: ${termNums.join(', ')}.`, '',
    '| Edizione | Posizione | Valore mostrato | Campo sorgente | Valore sorgente | Uguale |', '|---|---|---|---|---|---|',
    ...rows.map(r => `| #${r.num} | ${r.where} | \`${r.shown}\` | ${r.field} | \`${r.src}\` | ${r.ok ? '✓' : '✗'} |`), '',
    '## Immagini di condivisione', '', '| Edizione | og:image | Esclusa | File | Dimensioni | Peso |', '|---|---|---|---|---|---|',
    ...og.map(o => `| #${o.num} | ${o.generic ? 'generica /og.png' : o.img.replace('https://www.valoreatteso.com', '')} | ${o.excluded ? 'sì' : 'no'} | ${o.exists ? '✓' : '✗'} | ${o.w}×${o.h} | ${o.kb} KB |`),
    '', 'Le immagini per edizione non contengono KPI (layout approvato in fase 2): solo numero, data e titolo.'];
  fs.writeFileSync(path.join(outDir, 'report-dati.md'), R.join('\n') + '\n');

  // Meta, JSON-LD, sitemap.
  const M = ['# Meta, JSON-LD e sitemap · fase 3', '', '| Edizione | title | canonical | og:image | og:image:alt | JSON-LD | datePublished |', '|---|---|---|---|---|---|---|'];
  const titles = new Set(); let dup = 0, bad = 0;
  for (const ed of editions) {
    const html = read(slug(ed.num) + '.html');
    const g = re => dec((html.match(re) || [])[1] || '');
    const title = g(/<title>([^<]*)<\/title>/); if (titles.has(title)) dup++; titles.add(title);
    let ld = {}; try { ld = JSON.parse((html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]); } catch (e) { bad++; }
    const isoOk = /^\d{4}-\d{2}-\d{2}$/.test(ld.datePublished || '');
    if (!isoOk || ld['@type'] !== 'NewsArticle') bad++;
    M.push(`| #${pad(ed.num)} | ${title.slice(0, 60)}${title.length > 60 ? '…' : ''} | ${g(/rel="canonical" href="([^"]*)"/).replace('https://www.valoreatteso.com', '')} | ${g(/property="og:image" content="([^"]*)"/).replace('https://www.valoreatteso.com', '')} | ${g(/property="og:image:alt" content="([^"]*)"/).slice(0, 50)} | ${ld['@type'] || '✗'}${ld.image ? ' + image' : ''} | ${ld.datePublished || '✗'} ${isoOk ? '✓' : '✗'} |`);
  }
  const sm = read('sitemap.xml');
  const lastmods = [...sm.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map(m => m[1]);
  const smBad = lastmods.filter(d => !/^\d{4}-\d{2}-\d{2}$/.test(d));
  M.splice(2, 0, `Titoli unici: ${dup ? '✗ ' + dup + ' duplicati' : '✓'} · JSON-LD NewsArticle con date ISO: ${bad ? '✗ ' + bad : '✓ tutte'} · sitemap: ${sm.match(/<url>/g).length} URL, lastmod non ISO ${smBad.length ? '✗ ' + smBad.join(', ') : '✓ nessuno'} · /iscriviti in sitemap: ${sm.includes('/iscriviti') ? '✗ sì' : '✓ no'}`, '');
  fs.writeFileSync(path.join(outDir, 'meta.md'), M.join('\n') + '\n');
  console.log(R.slice(0, 5).join('\n'));
  console.log(M[2]);
};
