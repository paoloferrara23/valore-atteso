// scripts/email-send-test.js — invio di PROVA di un'edizione, a un solo indirizzo fisso.
// Uso (GitHub Actions "Test email edizione"): node scripts/email-send-test.js 026 [--from=supabase]
// Build in modalità "test": placeholder ammessi e visibili, immagini con URL assoluto.
// Destinatario scritto qui e non configurabile: nessuna lista, nessun iscritto.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_TO = 'info@valoreatteso.com';
const SENDER = { name: 'Valore Atteso', email: 'info@valoreatteso.com' };
const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  const key = process.env.BREVO_KEY;
  if (!key) throw new Error('BREVO_KEY mancante');
  const edition = String(process.argv[2] || '').trim();
  if (!/^\d{3}$/.test(edition)) throw new Error(`Numero edizione non valido: ${edition}`);
  const extra = process.argv.slice(3).filter(a => /^--from=(supabase|fixtures\/\d{3}\.json)$/.test(a));

  // Stesso build della redazione; se fallisce, non si invia nulla.
  execFileSync(process.execPath, [path.join(__dirname, 'email-build.js'), edition, '--mode=test', ...extra], { stdio: 'inherit' });
  const dir = path.join(__dirname, '..', 'dist', edition);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report-test.json'), 'utf8'));

  const fill = s => s.split('{{EMAIL}}').join(encodeURIComponent(TEST_TO)).split('{{EMAIL_TEXT}}').join(escHtml(TEST_TO));
  const htmlContent = fill(fs.readFileSync(path.join(dir, 'email.html'), 'utf8'));
  const textContent = fill(fs.readFileSync(path.join(dir, 'email.txt'), 'utf8')).split(escHtml(TEST_TO)).join(TEST_TO);
  const subject = `[TEST] ${report.subject}`;

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: SENDER, to: [{ email: TEST_TO }], subject, htmlContent, textContent, tags: ['test-template'] }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${body.slice(0, 300)}`);
  console.log(`Inviata a ${TEST_TO}: "${subject}" · HTML ${report.weightKB.html} KB · placeholder ${report.placeholders.length} · Brevo ${body.slice(0, 120)}`);
})().catch(e => { console.error(e.message); process.exit(1); });
