// scripts/edition-pages-needed.js
// Controllo leggero per il workflow edition-pages, usato dal cron ogni 30 minuti:
// serve rigenerare solo se un'edizione pubblicata non ha ancora la sua pagina /edizione-N
// o non compare in /archivio. Scrive run=true|false in $GITHUB_OUTPUT (e lo stampa).
// Rete di sicurezza per quando l'avvio dalla Control Room (token GitHub) non funziona.
const fs = require('fs');
const path = require('path');
const { fetchEditions, slug } = require('./generate-edition-pages.js');

const ROOT = path.join(__dirname, '..');

async function needed() {
  const editions = (await fetchEditions()).filter(e => e && e.num && e.title);
  if (!editions.length) return { run: false, why: 'nessuna edizione pubblicata' };
  const missing = editions.filter(e => !fs.existsSync(path.join(ROOT, slug(e.num) + '.html')));
  if (missing.length) return { run: true, why: 'pagina mancante: ' + missing.map(e => '#' + e.num).join(', ') };
  const latest = editions.reduce((a, b) => (parseInt(b.num, 10) > parseInt(a.num, 10) ? b : a));
  let archivio = '';
  try { archivio = fs.readFileSync(path.join(ROOT, 'archivio.html'), 'utf8'); } catch (_) {}
  if (!archivio.includes('/' + slug(latest.num))) return { run: true, why: 'archivio senza #' + latest.num };
  return { run: false, why: 'pagine e archivio già aggiornati' };
}

needed().then(r => {
  console.log('[edition-pages-needed] ' + r.run + ' — ' + r.why);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'run=' + r.run + '\n');
}).catch(e => {
  // Se il controllo non riesce, meglio rigenerare (idempotente) che restare fermi.
  console.error('[edition-pages-needed] controllo fallito, si rigenera:', e.message);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'run=true\n');
});
