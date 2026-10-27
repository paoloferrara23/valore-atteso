// api/_lib/email/validate.js — Validazione del contratto dati dell'edizione (§4.3 del prompt ed. 27).
//
// Due livelli:
//   1. schema.json (JSON Schema 2020-12), applicato da un validatore interno minimo per
//      non aggiungere dipendenze (copre le parole chiave usate nello schema);
//   2. regole editoriali e tecniche, con esito diverso per modalità:
//      preview = anteprima per Paolo (placeholder ammessi ed elencati),
//      send    = HTML per Brevo (ogni placeholder, fonte di stampa o approvazione mancante blocca).
// Ogni problema è {level, field, rule, value}: errori leggibili, mai una mail rotta.

const cfg = require('./config');
const schema = require('./schema.json');

const PLACEHOLDER = /\[\[[^\]]*\]\]|\[Fonte|\[dato da verificare\]|\bESEMPIO\b|\bTODO\b|lorem ipsum|\bipotetico\b|testo accorciato/i;
const isPh = v => typeof v === 'string' && PLACEHOLDER.test(v);
const SUBSCRIBERS = /\d[\d.,]*\s*(iscritti|lettori|subscriber)/i;
const GENERIC_LINK = /^(link|qui|clicca qui|leggi|fonte|url)$/i;

// ── Validatore JSON Schema (sottoinsieme usato da schema.json) ───────────────
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}
function typeOk(v, t) {
  const actual = typeOf(v);
  return [].concat(t).some(x => x === actual || (x === 'number' && actual === 'integer'));
}
function schemaErrors(s, v, path = '', out = []) {
  if (s.oneOf) {
    const ok = s.oneOf.filter(sub => schemaErrors(sub, v, path, []).length === 0).length;
    if (ok !== 1) out.push({ field: path || '(radice)', rule: 'schema: oneOf', value: v });
    return out;
  }
  if (s.type && !typeOk(v, s.type)) { out.push({ field: path || '(radice)', rule: `schema: tipo ${[].concat(s.type).join('|')}`, value: v }); return out; }
  if (s.enum && !s.enum.includes(v)) out.push({ field: path, rule: `schema: uno tra ${s.enum.join(', ')}`, value: v });
  if (typeof v === 'string') {
    if (s.minLength && v.length < s.minLength) out.push({ field: path, rule: 'schema: campo vuoto', value: v });
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push({ field: path, rule: `schema: formato ${s.pattern}`, value: v });
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push({ field: path, rule: `schema: minimo ${s.minimum}`, value: v });
    if (s.maximum !== undefined && v > s.maximum) out.push({ field: path, rule: `schema: massimo ${s.maximum}`, value: v });
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push({ field: path, rule: `schema: almeno ${s.minItems} elementi`, value: v.length });
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push({ field: path, rule: `schema: al massimo ${s.maxItems} elementi`, value: v.length });
    if (s.items) v.forEach((x, i) => schemaErrors(s.items, x, `${path}[${i}]`, out));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    (s.required || []).forEach(k => { if (!(k in v)) out.push({ field: path ? `${path}.${k}` : k, rule: 'schema: campo obbligatorio mancante', value: undefined }); });
    Object.keys(v).forEach(k => {
      const sub = s.properties && s.properties[k];
      if (sub) schemaErrors(sub, v[k], path ? `${path}.${k}` : k, out);
      else if (s.additionalProperties === false) out.push({ field: path ? `${path}.${k}` : k, rule: 'schema: campo non previsto', value: v[k] });
    });
  }
  return out;
}

// ── Numeri ──────────────────────────────────────────────────────────────────
// "-€24M" → ["24m"], "€1,25 mld (≈ $1,4 mld)" → ["1,25mld","1,4mld"], "1,25 miliardi" → ["1,25mld"].
function numKeys(s) {
  const out = [];
  const re = /(\d+(?:[.,]\d+)*)\s*(mld|miliardi|miliardo|mln|milioni|milione|m\b|%)?/gi;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const u = (m[2] || '').toLowerCase();
    const unit = /^(mld|miliard)/.test(u) ? 'mld' : /^(m|mln|milion)/.test(u) ? 'm' : u === '%' ? '%' : '';
    out.push(m[1] + unit);
  }
  return [...new Set(out)];
}
const hasDigit = v => /\d/.test(String(v == null ? '' : v));

function moduleValues(mod) {
  if (!mod) return [];
  if (mod.type === 'bars') return (mod.rows || []).map(r => r.display);
  if (mod.type === 'deal') return (mod.rows || []).map(r => r.value);
  if (mod.type === 'vs') return (mod.rows || []).flatMap(r => [r.a, r.b]);
  return [];
}

// Tutti i testi del contratto, con il loro percorso (per placeholder e nomi di stampa).
function walkStrings(v, path, out) {
  if (typeof v === 'string') out.push({ path, value: v });
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (k !== '$comment') walkStrings(v[k], path ? `${path}.${k}` : k, out); });
  return out;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}
const blockedHost = h => cfg.blockedDomains.some(d => h === d || h.endsWith('.' + d));
const NAME_RE = new RegExp(`(^|[^\\p{L}\\p{N}])(${cfg.blockedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');

// Normalizza i campi con alias storici (sources[].label → testo) senza toccare i contenuti.
function normalize(c) {
  const out = JSON.parse(JSON.stringify(c));
  (out.sections || []).forEach(s => {
    s.sources = (s.sources || []).map(x => (typeof x === 'string'
      ? { testo: x, url: '' }
      : { testo: x.testo !== undefined ? x.testo : (x.label || ''), url: x.url || '' }));
  });
  return out;
}

// ── Regole (§4.3) ───────────────────────────────────────────────────────────
function validate(contract, mode = 'preview') {
  const send = mode === 'send';
  const c = normalize(contract);
  const issues = [];
  const add = (level, field, rule, value) => issues.push({ level, field, rule, value });
  const errOrWarn = (field, rule, value) => add(send ? 'error' : 'warning', field, rule, value);

  schemaErrors(schema, c).forEach(e => add('error', e.field, e.rule, e.value));
  if (issues.length) return { contract: c, issues, placeholders: [] };

  const placeholders = walkStrings(c, '', []).filter(x => isPh(x.value));
  placeholders.forEach(p => { if (send) add('error', p.path, 'placeholder rimasto', p.value); });
  const ph = path => placeholders.some(p => p.path === path || p.path.startsWith(path + '.') || p.path.startsWith(path + '['));

  // Forma
  const d = new Date(c.date + 'T12:00:00Z');
  if (isNaN(d)) add('error', 'date', 'data non valida', c.date);
  else if (d.getUTCDay() !== 2) add('warning', 'date', 'la data non cade di martedì', c.date);
  if (!ph('preheader')) {
    if (/…|\.\.\.$/.test(c.preheader)) add('error', 'preheader', 'preheader troncato con "…": serve un testo dedicato', c.preheader);
    if (c.preheader.length < 85 || c.preheader.length > 100) add('warning', 'preheader', `preheader di ${c.preheader.length} caratteri (atteso 85-100)`, c.preheader);
  }
  if (!ph('title') && c.title.length > 90) add('warning', 'title', `titolo di ${c.title.length} caratteri (max 90)`, c.title);
  if (!ph('dek') && c.dek.length > 200) add('warning', 'dek', `dek di ${c.dek.length} caratteri (max 200)`, c.dek);

  c.summary.forEach((r, i) => {
    if (r.section_n !== i + 1 || r.label !== cfg.sectionLabels[i]) add('error', `summary[${i}]`, `atteso section_n ${i + 1} "${cfg.sectionLabels[i]}"`, `${r.section_n} ${r.label}`);
    if (!ph(`summary[${i}].thesis`) && r.thesis.length > 110) add('warning', `summary[${i}].thesis`, `tesi di ${r.thesis.length} caratteri (max 110)`, r.thesis);
    if (!ph(`summary[${i}].number`) && !hasDigit(r.number)) add('error', `summary[${i}].number`, 'numero mancante', r.number);
  });

  c.sections.forEach((s, i) => {
    const P = `sections[${i}]`;
    if (s.n !== i + 1 || s.label !== cfg.sectionLabels[i]) add('error', P, `attesa sezione ${i + 1} "${cfg.sectionLabels[i]}"`, `${s.n} ${s.label}`);
    s.kpi.forEach((k, j) => {
      if (ph(`${P}.kpi[${j}].value`)) return;
      if (!hasDigit(k.value)) add('error', `${P}.kpi[${j}].value`, 'numero mancante', k.value);
      if (k.value.length > 9) add('warning', `${P}.kpi[${j}].value`, `valore di ${k.value.length} caratteri (max 9): sposta la parte descrittiva nell'etichetta`, k.value);
    });

    const m = s.module;
    const rows = Array.isArray(m.rows) ? m.rows : [];
    if (m.type === 'bars') {
      if (rows.length < 2 || rows.length > 4) add('error', `${P}.module.rows`, 'bars: da 2 a 4 righe', rows.length);
      rows.forEach((r, j) => {
        const F = `${P}.module.rows[${j}]`;
        if (!r || !r.label) add('error', `${F}.label`, 'etichetta mancante', r && r.label);
        if (!ph(`${F}.value`) && !(typeof r.value === 'number' && r.value > 0)) add('error', `${F}.value`, 'numero mancante o non positivo', r.value);
        if (!ph(`${F}.display`) && !hasDigit(r.display)) add('error', `${F}.display`, 'numero mancante', r.display);
      });
    } else if (m.type === 'deal') {
      if (rows.length < 4 || rows.length > 6) add('error', `${P}.module.rows`, 'deal: da 4 a 6 righe', rows.length);
      rows.forEach((r, j) => { if (!r || !r.key || !r.value) add('error', `${P}.module.rows[${j}]`, 'riga deal incompleta (key, value)', r); });
    } else if (m.type === 'vs') {
      if (!Array.isArray(m.columns) || m.columns.length !== 2) add('error', `${P}.module.columns`, 'vs: servono 2 colonne', m.columns);
      if (!rows.length) add('error', `${P}.module.rows`, 'vs: almeno una riga', 0);
      rows.forEach((r, j) => {
        ['label', 'a', 'b'].forEach(k => { if (!r || r[k] === undefined || r[k] === null || String(r[k]).trim() === '') add('error', `${P}.module.rows[${j}].${k}`, 'cella vuota', r && r[k]); });
        ['a', 'b'].forEach(k => { if (r && /^[-–—]$/.test(String(r[k]).trim())) add('error', `${P}.module.rows[${j}].${k}`, 'valore assente reso con un trattino: il dato va scritto esplicito', r[k]); });
      });
    }

    // Non ripetizione fra KPI e modulo (i placeholder non contano).
    const counts = {};
    [...s.kpi.map(k => k.value), ...moduleValues(m)].filter(v => !isPh(v)).forEach(v => numKeys(v).forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
    const dup = Object.keys(counts).filter(k => counts[k] > 1);
    if (dup.length) add('error', P, `numero ripetuto nella sezione (${dup.join(', ')})`, dup);

    // Fonti
    s.sources.forEach((src, j) => {
      const F = `${P}.sources[${j}]`;
      if (!ph(`${F}.url`)) {
        if (!/^https:\/\/[^\s]+$/.test(src.url)) add('error', `${F}.url`, 'URL vuoto o non https://', src.url);
        else {
          if (blockedHost(hostOf(src.url))) errOrWarn(`${F}.url`, 'fonte di stampa o social non ammessa', src.url);
          if (/[?&]utm_/i.test(src.url)) add('error', `${F}.url`, 'niente UTM sulle fonti esterne', src.url);
        }
      }
      if (!ph(`${F}.testo`) && (src.testo === src.url || GENERIC_LINK.test(src.testo.trim()))) add('error', `${F}.testo`, 'il testo del link deve essere il nome del documento', src.testo);
    });
  });

  // Sintesi: il numero deve ricomparire nella sua sezione.
  c.summary.forEach((r, i) => {
    if (ph(`summary[${i}].number`)) return;
    const s = c.sections[r.section_n - 1];
    if (!s) return;
    const pool = new Set([...s.kpi.map(k => k.value), ...moduleValues(s.module), ...s.body].flatMap(numKeys));
    const miss = numKeys(r.number).filter(k => !pool.has(k));
    if (miss.length) add('error', `summary[${i}].number`, `il numero non compare nella sezione ${r.section_n}`, r.number);
  });

  // Testi: nomi di stampa e numeri di iscritti in qualunque campo.
  walkStrings(c, '', []).forEach(x => {
    if (NAME_RE.test(x.value)) errOrWarn(x.path, 'nome di testata o social', x.value.match(NAME_RE)[2]);
    if (SUBSCRIBERS.test(x.value)) add('error', x.path, 'numero di iscritti', x.value);
  });

  if (c.sponsor && c.sponsor.approved !== true) errOrWarn('sponsor.approved', 'sponsor attivo senza approvazione', c.sponsor.approved);
  ['copy', 'factcheck', 'paolo'].forEach(k => { if (c.approvals[k] !== true) errOrWarn(`approvals.${k}`, 'approvazione mancante', c.approvals[k]); });

  return { contract: c, issues, placeholders };
}

module.exports = { validate, schemaErrors, numKeys, isPh, PLACEHOLDER, SUBSCRIBERS, moduleValues, hostOf, blockedHost };
