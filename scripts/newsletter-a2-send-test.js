// scripts/newsletter-a2-send-test.js — invio di PROVA del template A2, a un solo indirizzo fisso.
// Uso (GitHub Actions "Test newsletter A2"): node scripts/newsletter-a2-send-test.js [num]
// Destinatario scritto qui e non configurabile: nessuna lista, nessun iscritto.
// Contenuti da docs/newsletter-a2/<num>-edition.json e <num>-layout.json.

const fs = require('fs');
const path = require('path');
const { editionToA2, validateA2, renderA2Html, renderA2Text } = require('../api/_lib/newsletter-a2');

const TEST_TO = 'info@valoreatteso.com';
const SENDER = { name: 'Valore Atteso', email: 'info@valoreatteso.com' };

(async () => {
  const key = process.env.BREVO_KEY;
  if (!key) throw new Error('BREVO_KEY mancante');
  const arg = String(process.argv[2] || '026').trim();
  if (!/^\d{1,3}$/.test(arg)) throw new Error(`Numero edizione non valido: ${arg}`);
  const num = arg.padStart(3, '0');
  const dir = path.join(__dirname, '..', 'docs', 'newsletter-a2');
  const edition = JSON.parse(fs.readFileSync(path.join(dir, `${num}-edition.json`), 'utf8'));
  const layout = JSON.parse(fs.readFileSync(path.join(dir, `${num}-layout.json`), 'utf8'));

  const model = editionToA2(edition, layout);
  const errors = validateA2(model);
  if (errors.length) throw new Error('Dati non validi:\n- ' + errors.join('\n- '));

  const email = encodeURIComponent(TEST_TO);
  const htmlContent = renderA2Html(model).replace('{{EMAIL}}', email);
  const textContent = renderA2Text(model).replace('{{EMAIL}}', email);
  const subject = `[TEST A2] ${model.subject}`;

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: SENDER, to: [{ email: TEST_TO }], subject, htmlContent, textContent, tags: ['test-a2'] }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${body.slice(0, 300)}`);
  console.log(`Inviata a ${TEST_TO}: "${subject}" · HTML ${(Buffer.byteLength(htmlContent) / 1024).toFixed(1)} KB · Brevo ${body.slice(0, 120)}`);
})().catch(e => { console.error(e.message); process.exit(1); });
