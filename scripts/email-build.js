// scripts/email-build.js — Build dell'email di un'edizione dal contratto JSON (nessun invio).
//
//   npm run edition -- 027 --mode=preview                      (contratto da fixtures/027.json)
//   npm run edition -- 027 --mode=send --from=supabase         (riga editions + colonna email)
//   npm run edition -- 026 --mode=preview --from=fixtures/026.json
//
// Output in dist/{edition}/: preview.html (preview) oppure email.html (send/test), email.txt,
// report.json e report.md. Il build viene eseguito due volte: gli hash devono coincidere.
// Esce con codice 1 se ci sono errori bloccanti.

const fs = require('fs');
const path = require('path');
const { build, reportMarkdown } = require('../api/_lib/email/build');
const { contractFromRow } = require('../api/_lib/email/contract');

const args = process.argv.slice(2);
const edition = String(args.find(a => !a.startsWith('--')) || '').padStart(3, '0');
const opt = k => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const mode = opt('mode') || 'preview';
const from = opt('from') || `fixtures/${edition}.json`;
const root = path.join(__dirname, '..');

async function loadContract() {
  if (from !== 'supabase') return JSON.parse(fs.readFileSync(path.resolve(root, from), 'utf8'));
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!process.env.SUPABASE_URL || !key) throw new Error('SUPABASE_URL e chiave mancanti');
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/editions?num=eq.${edition}&select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const rows = await r.json();
  if (!rows.length) throw new Error(`Edizione ${edition} non trovata`);
  return contractFromRow(rows[0]);
}

(async () => {
  if (!/^\d{3}$/.test(edition)) throw new Error('Uso: node scripts/email-build.js 027 --mode=preview|test|send [--from=...]');
  if (!['preview', 'test', 'send'].includes(mode)) throw new Error(`Modalità non valida: ${mode}`);
  const contract = await loadContract();
  const opts = { mode, assetBase: '../../email/brand/' };
  const a = build(contract, opts);
  const b = build(contract, opts);
  const deterministic = a.ok ? a.report.sha256.html === b.report.sha256.html && a.report.sha256.text === b.report.sha256.text : null;
  a.report.deterministic = deterministic;

  const out = path.join(root, 'dist', edition);
  fs.mkdirSync(out, { recursive: true });
  if (a.ok) {
    fs.writeFileSync(path.join(out, mode === 'preview' ? 'preview.html' : 'email.html'), a.html);
    fs.writeFileSync(path.join(out, 'email.txt'), a.text);
  }
  const suffix = mode === 'preview' ? '' : `-${mode}`;
  fs.writeFileSync(path.join(out, `report${suffix}.json`), JSON.stringify(a.report, null, 2) + '\n');
  fs.writeFileSync(path.join(out, `report${suffix}.md`), reportMarkdown(a.report));

  const r = a.report;
  console.log(`#${edition} ${mode}: ${a.ok ? 'OK' : 'BLOCCATO'} · errori ${r.errors.length} · avvisi ${r.warnings.length} · placeholder ${r.placeholders.length}` +
    (r.weightKB ? ` · HTML ${r.weightKB.html} KB · text ${r.weightKB.text} KB · deterministico ${deterministic}` : ''));
  r.errors.slice(0, 40).forEach(e => console.log(`  ERRORE ${e.field}: ${e.rule}`));
  if (r.errors.length > 40) console.log(`  … altri ${r.errors.length - 40} errori in dist/${edition}/report${suffix}.md`);
  if (deterministic === false) { console.error('Build non deterministico'); process.exit(1); }
  process.exit(a.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
