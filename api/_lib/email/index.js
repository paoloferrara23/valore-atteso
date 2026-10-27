// api/_lib/email/index.js — Email di un'edizione dalla riga Supabase, per send-test e send-newsletter.
// Controlla che la pagina web dell'edizione esista (altrimenti "Leggi online" e l'inoltro
// puntano all'archivio), costruisce il contratto e fa il build nella modalità richiesta.

const cfg = require('./config');
const { contractFromRow } = require('./contract');
const { build } = require('./build');

async function editionPageExists(num) {
  const url = `${cfg.site}/edizione-${parseInt(num, 10)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    return r.status === 200;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// mode: 'test' (placeholder e nomi di stampa solo segnalati) oppure 'send' (bloccano).
async function buildEditionEmail(row, mode) {
  const editionPage = await editionPageExists(row.num);
  const contract = contractFromRow(row, { editionPage });
  const out = build(contract, { mode });
  out.report.editionPage = editionPage;
  return out;
}

// Sostituisce il merge tag con l'indirizzo del singolo destinatario (link di disiscrizione).
const personalize = (s, email) => s.split('{{EMAIL}}').join(encodeURIComponent(email));

// Dalla #027 gli invii usano questo template; le edizioni precedenti restano sul vecchio.
const usesNewTemplate = num => parseInt(num, 10) >= 27;

module.exports = { buildEditionEmail, editionPageExists, personalize, usesNewTemplate };
