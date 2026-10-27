// scripts/newsletter-a2-preview.js — anteprima offline del template A2 (nessun invio).
// Uso: node scripts/newsletter-a2-preview.js [num]   (default 026)
// Legge docs/newsletter-a2/<num>-edition.json e <num>-layout.json, scrive
// preview-<num>.html e preview-<num>.txt nella stessa cartella. {{EMAIL}} resta
// nel file come segnaposto (lo sostituisce send-newsletter all'invio).

const fs = require('fs');
const path = require('path');
const { editionToA2, validateA2, renderA2Html, renderA2Text } = require('../api/_lib/newsletter-a2');

const num = String(process.argv[2] || '026').padStart(3, '0');
const dir = path.join(__dirname, '..', 'docs', 'newsletter-a2');
const edition = JSON.parse(fs.readFileSync(path.join(dir, `${num}-edition.json`), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(dir, `${num}-layout.json`), 'utf8'));

const model = editionToA2(edition, layout);
const errors = validateA2(model);
if (errors.length) {
  console.error('Dati non validi per il template A2:\n- ' + errors.join('\n- '));
  process.exit(1);
}
const html = renderA2Html(model);
const text = renderA2Text(model);
fs.writeFileSync(path.join(dir, `preview-${num}.html`), html);
fs.writeFileSync(path.join(dir, `preview-${num}.txt`), text);
console.log(`preview-${num}.html ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB · preview-${num}.txt ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
