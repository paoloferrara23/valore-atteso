// api/_lib/content-hash.js
// Impronta del testo di un'edizione (titolo, sottotitolo, apertura, sezioni con KPI, verdetti e fonti).
// Il fact-check la scrive in editions.factcheck.content_hash; la Control Room e la barriera pre-invio la
// confrontano con quella del testo attuale: così il fact-check parte UNA volta, quando si preme «Invia»,
// solo se il testo è cambiato dall'ultimo controllo, e un testo modificato dopo il controllo non esce.
const crypto = require('crypto');

const t = x => String(x == null ? '' : x).trim();

function sectionText(s) {
  const body = Array.isArray(s.body) ? s.body.join('\n\n') : s.body;
  return {
    label: t(s.label), title: t(s.title), body: t(body), verdict: t(s.verdict),
    kpis: (s.kpis || s.kpi_rows || []).map(k => [t(k.label), t(k.value), t(k.sub)]),
    sources: (s.sources || []).map(t),
  };
}

function contentHash(edition) {
  const e = edition || {};
  const payload = JSON.stringify([t(e.title), t(e.subtitle), t(e.opener), (Array.isArray(e.sections) ? e.sections : []).map(sectionText)]);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// Impronta di una sola sezione: il fact-check non rifà le sezioni invariate dall'ultimo controllo.
function sectionHash(section) {
  return crypto.createHash('sha256').update(JSON.stringify(sectionText(section || {}))).digest('hex').slice(0, 16);
}

module.exports = { contentHash, sectionHash };
