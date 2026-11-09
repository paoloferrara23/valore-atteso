// api/_lib/editorial-checks.js
// Controlli editoriali BLOCCANTI dell'agente redazione (Parte B, dalla #027).
// Funzioni pure: nessuna rete, nessun accesso al database, nessun dato degli iscritti.
//
//   editorialChecks(edition)        -> controlli sui campi della riga `editions` (testi, KPI, fact-check)
//   emailRenderChecks(html, text)   -> controlli sull'HTML dell'anteprima (footer, titolare, link)
//
// Ogni controllo ha la forma {type:'error'|'warning', code, message, section?}: stessa forma di
// api/_lib/preflight.js, che li integra (gli 'error' diventano blocker). Si applicano dalla
// #027 in poi (appliesTo): le edizioni precedenti non vengono toccate.
//
// Cosa NON fa, di proposito: non legge ne' scrive nel database, non invia, non pubblica,
// non approva. I permessi dell'agente stanno in api/_lib/redazione-guard.js.

const LABELS = ['Il Bilancio', 'Il Deal', 'La Metrica'];
// Il testo del footer è unico: sta in api/_lib/email/config.js (copy.legalData) e qui si controlla che l'HTML lo riporti uguale.
const FOOTER_TEXT = require('./email/config').copy.legalData;
const FIRST_EDITION = 27;

const appliesTo = num => parseInt(num, 10) >= FIRST_EDITION;

// ── Liste editoriali ─────────────────────────────────────────────────────────
// Testate, agenzie e social: mai nel testo (la fonte sta solo nel campo interno `sources`).
const OUTLETS = [
  'Bloomberg', 'Financial Times', 'Reuters', 'Associated Press', 'Sole 24 Ore', 'The Athletic', 'ESPN',
  'Sky Sports', 'Sky Sport', 'SportBusiness', 'SportsPro', 'Sportico', 'Adnkronos', 'ANSA', 'Forbes',
  'Inside World Football', 'SVG Europe', 'The Stadium Business', 'Calcio e Finanza', 'Transfermarkt',
  'Gazzetta dello Sport', 'Corriere dello Sport', 'Corriere della Sera', 'Tuttosport', 'La Repubblica',
  'Il Post', 'Marca', 'Mundo Deportivo', "L'Equipe", "L'Équipe", 'Les Echos', 'Le Parisien', 'The Times',
  'Irish Times', 'Guardian', 'Telegraph', 'BBC', 'CNBC', 'EFE', 'Lapresse', 'Advanced Television',
  'Telecompaper', 'Instagram', 'Twitter', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube',
];
const OUTLET_RE = new RegExp(
  '(?<![\\p{L}\\d])(' + OUTLETS.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\d])', 'u');
const OUTLET_AP = /(?<![\p{L}\d])AP(?![\p{L}\d])/u;

// Anglicismi: soglia 0 in titoli, sottotitolo, apertura, titoli sezione e etichette KPI;
// al massimo 2 termini diversi nel corpo di una sezione.
const ANGLICISMS = [
  ['deal', /\bdeals?\b/i], ['co-owned', /\bco-?owned\b/i], ['mandate', /\bmandates?\b/i],
  ['exit', /\bexit\b/i], ['D2C', /\bd2c\b/i], ['break-even', /\bbreak-?even\b/i],
  ['split', /\bsplit\b/i], ['naming rights', /\bnaming rights\b/i], ['asset', /\bassets?\b/i],
  ['benchmark', /\bbenchmark(?:ing)?\b/i], ['stakeholder', /\bstakeholders?\b/i],
];
const BODY_ANGLICISM_MAX = 2;

// Sensazionalismo: blocca. Cliché: avvisa.
const SENSATIONAL = [
  /basta un infortunio/i, /\bcrollo\b/i, /\bcrolla(?:no|re|to)?\b/i, /\bdisastr\w*/i, /\bbruciat[aoie]\b/i,
  /\bbrucia(?:no)?\b/i, /\btracollo\b/i, /\bcatastrof\w*/i, /\bterremoto\b/i, /\bshock\b/i, /\bchoc\b/i,
  /\bscandalo\b/i, /\bclamoros\w*/i, /\bda brividi\b/i, /\bincredibile\b/i, /\besplosiv\w*/i,
  /record d['’]Europa/i, /più ricco d['’]Europa/i, /naming più ricco/i, /negozio di quartiere/i,
];
const CLICHES = [/racconta un['’]altra storia/i, /la vera storia/i, /cambia tutto/i, /gioco da ragazzi/i];

// Cautela per i dati di "Stampa autorevole" non confermati: senza nominare la testata.
const CAUTION = /secondo quanto (?:riportato|dichiarato|riferito|indicato|comunicato)|stando a quanto|(?:è|sono|risulta|risultano) (?:riportat|dichiarat|indicat|stimat|riferit)\w*|riportat[aoie]|dichiarat[aoie]|non (?:è|sono) (?:stat[aoi] )?(?:ancora )?(?:ufficial|pubblicat|resa|resi)\w*|sarebbe|circa/i;

// Temi per il controllo "Deal e Metrica su temi diversi".
const THEMES = {
  contratto: /struttura contrattual|clausol|durata del contratto|\bpenale\b|contratt/gi,
  diritti_tv: /diritti (?:tv|televisiv)|emittent|broadcaster|\bgara\b/gi,
  stadio: /\bstadio\b|naming|capienza|\bposti\b|impianto/gi,
  abbonati: /abbonat|canale (?:della|di) lega|\bparco\b/gi,
  conti: /\bricavi\b|\butile\b|perdita|bilancio|ebitda|\bmargine\b/gi,
  debito: /\bdebit\w*|prestit|\bbond\b|obbligazion/gi,
  proprieta: /\bfond[oi]\b|proprietà|cessione|\bquote?\b|private equity|acquisizione/gi,
  mercato: /trasferiment|cartellin|ingaggi|calciomercato/gi,
};
const STOPWORDS = new Set(('della delle degli dello dagli dalla dalle sono sulla sulle nella nelle negli come anche questo questa quanto quale '
  + 'quali perché dopo prima ogni solo ancora stato stati essere tra fra cosa cosi così più meno molto poco tutti tutto nostra nostro '
  + 'numero numeri conta cifra valore edizione').split(' '));

// ── Utilità ──────────────────────────────────────────────────────────────────
const bodyOf = s => (Array.isArray(s && s.body) ? s.body.join('\n\n') : String((s && s.body) || ''));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = s => norm(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const num = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));

// Stagioni "2025/26" o "2025-26": sempre consecutive quando scritte con la barra.
const SEASON_RE = /\b(20\d{2})\s*([/-])\s*(\d{2})\b/g;
// Numero con eventuale unità: "€1,06 miliardi", "-€18 mln", "71.500", "97,7%", "3,75 milioni".
// L'unità non può essere seguita da una lettera: «M» di «Milan» non è un milione.
const AMOUNT_RE = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*(miliardi|miliardo|mld|milioni|milione|mln|%|M(?![\p{L}\d])|bn(?![\p{L}\d]))?/gu;

function stripSeasonsAndDates(text) {
  return String(text)
    .replace(SEASON_RE, ' ')
    .replace(/\b\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+\d{4})?/gi, ' ')
    .replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
}

// Numeri del testo come {value, unit, raw}; value in milioni (mld x1000), percentuali a parte.
function amountsIn(text) {
  const out = [];
  const t = stripSeasonsAndDates(text);
  let m;
  const re = new RegExp(AMOUNT_RE.source, 'gu');
  while ((m = re.exec(t))) {
    const u = (m[2] || '').toLowerCase();
    const n = num(m[1]);
    if (!isFinite(n)) continue;
    if (u === '%') out.push({ value: n, unit: '%', raw: m[0].trim() });
    else if (/^(miliard|mld|bn)/.test(u)) out.push({ value: n * 1000, unit: 'M', raw: m[0].trim() });
    else if (/^(milion|mln|m$)/.test(u)) out.push({ value: n, unit: 'M', raw: m[0].trim() });
    else out.push({ value: n, unit: '', raw: m[0].trim() });
  }
  return out;
}
const isYear = a => a.unit === '' && Number.isInteger(a.value) && a.value >= 1900 && a.value <= 2100;
// Importi "significativi": con unità (M, %), oppure con migliaia (71.500) o decimali non banali.
const significant = a => !isYear(a) && (a.unit !== '' || a.value >= 1000 || /,\d{2}/.test(a.raw));
const tolFor = v => Math.max(0.05, Math.abs(v) * 0.005);
const same = (a, b) => a.unit === b.unit && Math.abs(Math.abs(a.value) - Math.abs(b.value)) <= Math.max(tolFor(a.value), tolFor(b.value));
// Numero senza unità che coincide con un valore in M (es. "3,75" vs "3,75 milioni"): ammesso solo per KPI.
const sameLoose = (a, b) => Math.abs(Math.abs(a.value) - Math.abs(b.value)) <= Math.max(tolFor(a.value), tolFor(b.value))
  && (a.unit === b.unit || !a.unit || !b.unit);

// Valutatore aritmetico sicuro: solo cifre, + - * / ( ) e punto decimale.
function evalFormula(f) {
  const s = String(f || '').replace(/\s+/g, '').replace(/,/g, '.').replace(/[x×]/g, '*').replace(/[÷:]/g, '/');
  if (!s || /[^0-9+\-*/().]/.test(s)) return NaN;
  let i = 0;
  const peek = () => s[i];
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  function term() { let v = factor(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const r = factor(); v = o === '*' ? v * r : v / r; } return v; }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') return NaN; i++; return v; }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  const v = expr();
  return i === s.length ? v : NaN;
}

// Gruppi di n parole consecutive; quelli con cifre sono esclusi (un numero ripetuto nel verdetto è normale).
function shingles(text, n) {
  const w = words(String(text).replace(new RegExp(AMOUNT_RE.source, 'gu'), ' zznumzz '));
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) {
    const g = w.slice(i, i + n);
    if (!g.includes('zznumzz')) out.add(g.join(' '));
  }
  return out;
}

function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

// Stagioni di riferimento a partire dalla data di uscita (YYYY-MM-DD).
function seasonsFor(dateIso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(dateIso || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  const startOfCurrent = mo >= 7 ? y : y - 1; // la stagione 2026/27 comincia a luglio-agosto 2026
  return { lastClosed: startOfCurrent - 1, current: startOfCurrent, next: startOfCurrent + 1 };
}

// ── Raccolta dei campi ───────────────────────────────────────────────────────
// Testo "pubblicabile": tutto quello che arriva al lettore (esclude sources e factcheck).
function collect(edition) {
  const sections = Array.isArray(edition.sections) ? edition.sections : [];
  const head = [
    { where: 'titolo', text: String(edition.title || '') },
    { where: 'sottotitolo', text: String(edition.subtitle || '') },
    { where: 'apertura', text: String(edition.opener || '') },
  ];
  const perSection = sections.map((s, i) => {
    const kpis = (s && (s.kpis || s.kpi_rows)) || [];
    return {
      i, label: (s && s.label) || LABELS[i] || `Sezione ${i + 1}`,
      title: String((s && s.title) || ''), body: bodyOf(s), verdict: String((s && s.verdict) || ''),
      kpis, kpiText: kpis.map(k => [k && k.label, k && k.value, k && k.sub].filter(Boolean).join(' ')).join(' | '),
    };
  });
  return { head, perSection };
}

// ── Controlli ────────────────────────────────────────────────────────────────
function editorialChecks(edition, opts = {}) {
  const checks = [];
  const push = (type, code, message, section) => checks.push({ type, code, message, ...(section !== undefined ? { section } : {}) });
  if (!edition || !appliesTo(edition.num)) return checks;
  const { head, perSection } = collect(edition);
  const fc = edition.factcheck;
  const allText = [...head.map(h => h.text), ...perSection.flatMap(s => [s.title, s.body, s.verdict, s.kpiText])].join('\n');

  // 0. STRUTTURA: 3 sezioni nell'ordine fisso, 3 KPI ciascuna, tag
  if (perSection.length !== 3) push('error', 'ed_struttura', `Servono esattamente 3 sezioni (ora ${perSection.length})`);
  perSection.forEach(s => {
    if (LABELS[s.i] && s.label !== LABELS[s.i]) push('error', 'ed_struttura', `${s.label}: la sezione ${s.i + 1} deve chiamarsi «${LABELS[s.i]}»`, s.i);
    if (s.kpis.length !== 3) push('error', 'ed_kpi_tre', `${s.label}: servono esattamente 3 KPI (ora ${s.kpis.length})`, s.i);
    s.kpis.forEach((k, j) => {
      if (!k || !k.label || !k.value || !k.sub) push('error', 'ed_kpi_campi', `${s.label}: KPI ${j + 1} senza etichetta, valore o sottotitolo`, s.i);
    });
  });
  const tags = Array.isArray(edition.tags) ? edition.tags : [];
  if (tags.length && LABELS.some((l, i) => tags[i] !== l)) push('warning', 'ed_tags', 'I tag dovrebbero essere ["Il Bilancio","Il Deal","La Metrica"]');

  // 1. TITOLO / SOTTOTITOLO
  const title = head[0].text.trim();
  if (title.length > 70) push('error', 'ed_titolo_lungo', `Titolo di ${title.length} caratteri: il massimo è 70`);
  const titleNums = amountsIn(title).filter(a => !isYear(a));
  // Al massimo UN numero (verificato): il titolo deve invogliare, non elencare cifre. Zero numeri è ammesso (avviso).
  if (titleNums.length > 1) push('error', 'ed_titolo_numero', `Il titolo contiene ${titleNums.length} numeri (${titleNums.map(a => a.raw).join(', ')}): al massimo uno`);
  else if (!titleNums.length) push('warning', 'ed_titolo_senza_numero', 'Il titolo non contiene numeri: ammesso se invoglia a leggere e copre le tre sezioni');
  const sub = head[1].text.trim();
  if (sub.length > 140) push('error', 'ed_sottotitolo_lungo', `Sottotitolo/preheader di ${sub.length} caratteri: il massimo è 140`);

  // 2. DATA E STAGIONI
  const date = String(edition.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    push('error', 'ed_data_formato', `Data «${date}» non valida: serve il formato YYYY-MM-DD`);
  } else if (new Date(date + 'T00:00:00Z').getUTCDay() !== 2) {
    push('error', 'ed_data_martedi', `La data ${date} non è un martedì: la newsletter esce di martedì`);
  }
  const seasons = seasonsFor(date);
  const seasonCue = /(rispetto|\bsul\b|\bsullo\b|contro|precedent|confront|prima d|\bdal\b|\bda\b|ciclo|storic|anno fa|anno prima|dopo il|stagione scors)/i;
  const scanSeasons = (label, text, section) => {
    let m;
    const re = new RegExp(SEASON_RE.source, 'g');
    while ((m = re.exec(text))) {
      const a = +m[1], b = +m[3];
      if (m[2] === '/' && b !== (a + 1) % 100) {
        push('error', 'ed_stagione_non_consecutiva', `${label}: stagione «${m[0]}» non consecutiva`, section);
        continue;
      }
      if (seasons && m[2] === '/' && a < seasons.lastClosed) {
        const around = text.slice(Math.max(0, m.index - 60), m.index + 5);
        if (!seasonCue.test(around)) {
          push('error', 'ed_stagione_incoerente', `${label}: stagione ${m[0]} non coerente con la data di uscita (riferimento ${seasons.lastClosed}/${String(seasons.lastClosed + 1).slice(2)}); se è un confronto scrivilo ("rispetto al ${m[0]}")`, section);
        }
      }
    }
  };
  head.forEach(h => scanSeasons(h.where[0].toUpperCase() + h.where.slice(1), h.text));
  perSection.forEach(s => scanSeasons(s.label, [s.title, s.body, s.verdict, s.kpiText].join('\n'), s.i));

  // 3. COERENZA DEI NUMERI TRA I CAMPI (titolo, sottotitolo, apertura -> sezioni e KPI)
  const sectionAmounts = perSection.flatMap(s => amountsIn([s.title, s.body, s.verdict, s.kpiText].join('\n')));
  head.forEach(h => {
    amountsIn(h.text).filter(a => significant(a) && a.unit !== '').forEach(a => {
      if (!sectionAmounts.some(b => same(a, b) || sameLoose(a, b))) {
        push('error', 'ed_numero_incoerente', `${h.where[0].toUpperCase() + h.where.slice(1)}: «${a.raw}» non compare con lo stesso valore nelle sezioni o nei KPI`);
      }
    });
  });
  // KPI: il numero deve comparire nel corpo, nel verdetto o nel titolo della sua sezione (stesso valore).
  perSection.forEach(s => {
    const own = amountsIn([s.title, s.body, s.verdict].join('\n'));
    s.kpis.forEach(k => {
      if (!k || !k.value) return;
      amountsIn(String(k.value)).filter(a => !isYear(a)).forEach(a => {
        if (!own.some(b => sameLoose(a, b))) push('error', 'ed_kpi_valore', `${s.label}: il KPI «${k.value}» non compare con lo stesso valore nel testo`, s.i);
      });
    });
  });

  // 4. ARITMETICA
  // 4a. il salto tra utile ordinario e risultato netto non può essere "spiegato" da un'altra cifra.
  perSection.forEach(s => {
    const t = [s.title, s.body, s.verdict, s.kpiText].join('\n') + '\n' + head.map(h => h.text).join('\n');
    const ord = /utile ordinario[^.\n]{0,40}?(\d+(?:,\d+)?)\s*(?:milioni|mln|M\b)/i.exec(t);
    const net = /(?:perdita netta|risultato netto|utile netto)[^.\n]{0,40}?(\d+(?:,\d+)?)\s*(?:milioni|mln|M\b)/i.exec(t);
    if (!ord || !net) return;
    const o = num(ord[1]);
    const n = /perdita netta/i.test(net[0]) || /(?:-|−)\s*€?\s*\d/.test(net[0]) ? -num(net[1]) : num(net[1]);
    const gap = Math.abs(o - n);
    sentences(t).forEach(sent => {
      if (!/trasform|trascin|spiega|\bporta|portano|fa passare|bastano|azzera|determina/i.test(sent) || /lord|in parte/i.test(sent)) return;
      amountsIn(sent).filter(a => a.unit === 'M' && a.value >= 10).forEach(a => {
        if (Math.abs(a.value - gap) > tolFor(gap) && Math.abs(a.value - Math.abs(n)) > tolFor(n) && Math.abs(a.value - o) > tolFor(o)) {
          push('error', 'ed_aritmetica_salto', `${s.label}: tra utile ordinario (${String(o).replace('.', ',')}) e risultato netto (${String(n).replace('.', ',')}) il salto è ${String(Math.round(gap * 100) / 100).replace('.', ',')} milioni; «${a.raw}» non lo spiega. Scrivi il salto corretto o spiega che sono oneri lordi`, s.i);
        }
      });
    });
  });
  // 4b. quote annue / per club: totale / anni (/ club) deve tornare con la cifra scritta.
  perSection.forEach(s => {
    const t = [s.title, s.body, s.verdict, s.kpiText].join('\n');
    const yearsSet = [...new Set([...t.matchAll(/\b(\d{1,2})\s+anni\b/g)].map(m => +m[1]))];
    if (yearsSet.length > 1 && !/\btra\b[^.]{0,30}\b\d{1,2}\b[^.]{0,10}\be\b|\bvaria\b|oppure|\bo\b/i.test(t)) {
      push('error', 'ed_aritmetica_durata', `${s.label}: durate diverse nello stesso testo (${yearsSet.join(' e ')} anni): usa una sola durata o dichiara che le fonti divergono`, s.i);
    }
    if (yearsSet.length !== 1) return;
    const years = yearsSet[0];
    const amts = amountsIn(t).filter(a => a.unit === 'M');
    const total = Math.max(0, ...amts.map(a => a.value));
    if (!total) return;
    sentences(t).forEach(sent => {
      // La quota si controlla solo dove il testo la lega davvero al totale: frasi «a club / per club / ciascuno», oppure
      // frasi annue che nominano anche il totale. Confronti con altri contratti o bilanci («Puma tra €12 e €14 milioni a
      // stagione») non sono quote del totale e non si verificano.
      const perClub = /a club|per club|ciascun|ogni club/i.test(sent);
      const annual = /all['’]anno|l['’]anno|a stagione|annu|ogni anno/i.test(sent);
      const hasTotal = amountsIn(sent).some(a => a.unit === 'M' && Math.abs(a.value - total) <= tolFor(total));
      if (!(perClub || (annual && hasTotal))) return;
      amountsIn(sent).filter(a => a.unit === 'M' && a.value < total).forEach(a => {
        const ok = [total / years, total / years / 2, total / 2].some(x => Math.abs(a.value - x) <= Math.max(0.6, x * 0.03));
        if (!ok) push('error', 'ed_aritmetica_quota', `${s.label}: «${a.raw}» non torna: ${String(total).replace('.', ',')} / ${years} anni = ${(Math.round(total / years * 100) / 100).toString().replace('.', ',')} all'anno, ${(Math.round(total / years / 2 * 100) / 100).toString().replace('.', ',')} a club`, s.i);
      });
    });
  });
  // 4c. calcoli dichiarati nel fact-check: {classe:'Calcolo', formula:'900/(19.99*12)', risultato:3.752}
  const claimsOf = f => (f && Array.isArray(f.sections) ? f.sections.flatMap(sec => (sec.claims || []).map(c => ({ ...c, section: sec.label }))) : []);
  const claims = claimsOf(fc);
  claims.filter(c => c.classe === 'Calcolo').forEach(c => {
    if (!c.formula) { push('warning', 'ed_calcolo_senza_formula', `Fact-check: calcolo «${String(c.claim).slice(0, 60)}» senza formula, non ricalcolabile`); return; }
    const v = evalFormula(c.formula);
    const r = parseFloat(String(c.risultato).replace(',', '.'));
    if (!isFinite(v) || !isFinite(r)) { push('error', 'ed_calcolo_formula', `Fact-check: formula non valida «${c.formula}»`); return; }
    const tol = c.tolleranza != null ? +c.tolleranza : Math.max(0.05, Math.abs(r) * 0.005);
    if (Math.abs(v - r) > tol) push('error', 'ed_calcolo_errato', `Fact-check: ${c.formula} = ${Math.round(v * 1000) / 1000}, non ${c.risultato} (tolleranza ±${tol})`);
  });

  // 5. FACT-CHECK: copertura, classi, cautela
  if (opts.factcheck !== false) {
    if (!fc || !fc.checked_at || !claims.length) {
      push('error', 'ed_factcheck_assente', 'Fact-check assente o senza affermazioni: ogni numero deve avere una voce');
    } else {
      claims.forEach(c => {
        if (!c.classe) push('error', 'ed_factcheck_classe', `Fact-check: «${String(c.claim).slice(0, 60)}» senza classe (Ufficiale, Report autorevole, Stampa autorevole, Calcolo)`);
        else if (/non verificat/i.test(c.classe) || c.status === 'UNVERIFIABLE') push('error', 'ed_factcheck_non_verificato', `Fact-check: «${String(c.claim).slice(0, 70)}» non verificato: non può uscire`);
        if (c.status === 'CONTRADICTED') push('error', 'ed_factcheck_contraddetto', `Fact-check: «${String(c.claim).slice(0, 70)}» contraddetto da fonti autorevoli`);
      });
      // Stampa autorevole senza seconda conferma: ammessa solo con formula di cautela nella sezione.
      claims.filter(c => c.classe === 'Stampa autorevole').forEach(c => {
        const confirmed = c.confermata === true || (Array.isArray(c.conferme) && c.conferme.length > 0);
        if (confirmed) return;
        const sec = perSection.find(s => s.label === c.section);
        const text = sec ? [sec.body, sec.verdict].join('\n') : allText;
        if (!CAUTION.test(text)) push('error', 'ed_factcheck_cautela', `Fact-check: «${String(c.claim).slice(0, 60)}» è solo Stampa autorevole senza conferma: servono una seconda fonte o una formula di cautela nel testo ("secondo quanto riportato")`, sec ? sec.i : undefined);
      });
      // Copertura: ogni numero significativo di titolo, sottotitolo, KPI e testo ha una voce.
      const covered = claims.flatMap(c => amountsIn([c.claim, c.valore, c.found, c.note].filter(Boolean).join(' ')));
      const needed = [
        ...head.flatMap(h => amountsIn(h.text)),
        ...perSection.flatMap(s => amountsIn([s.title, s.body, s.verdict, s.kpiText].join('\n'))),
      ].filter(significant);
      const missing = [];
      needed.forEach(a => {
        if (!covered.some(b => sameLoose(a, b)) && !missing.some(x => sameLoose(x, a))) missing.push(a);
      });
      if (missing.length) push('error', 'ed_factcheck_copertura', `Fact-check: ${missing.length} numero/i senza voce (${missing.slice(0, 8).map(a => a.raw).join(', ')}${missing.length > 8 ? '…' : ''})`);
    }
  }

  // 6. LINK ESTERNI e BLOCCO FONTI
  const URL_RE = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9][a-z0-9-]*\.(?:com|it|org|net|eu|io|co\.uk|es|fr|de)\b/gi;
  const ALLOWED_HOST = /(?:^|\.)valoreatteso\.com$|^wa\.me$/i;
  const scanLinks = (label, text, section) => {
    (String(text).match(URL_RE) || []).forEach(u => {
      const host = u.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/[.,;:)]+$/, '');
      if (!ALLOWED_HOST.test(host)) push('error', 'ed_link_esterno', `${label}: link esterno non ammesso (${u.slice(0, 60)})`, section);
    });
  };
  head.forEach(h => scanLinks(h.where[0].toUpperCase() + h.where.slice(1), h.text));
  perSection.forEach(s => scanLinks(s.label, [s.title, s.body, s.verdict, s.kpiText].join('\n'), s.i));

  const outletCheck = (label, text, section) => {
    const m = OUTLET_RE.exec(text) || OUTLET_AP.exec(text);
    if (m) push('error', 'ed_testata_nel_testo', `${label}: nome di testata o social nel testo («${m[0]}»): la fonte va solo nel campo interno`, section);
  };
  head.forEach(h => outletCheck(h.where[0].toUpperCase() + h.where.slice(1), h.text));
  perSection.forEach(s => {
    outletCheck(s.label, [s.title, s.body, s.verdict, s.kpiText].join('\n'), s.i);
    if (/(^|\n)\s*(?:fonti?|fonte)\s*:/i.test([s.body, s.verdict].join('\n'))) push('error', 'ed_blocco_fonti', `${s.label}: blocco «Fonti» nel testo: le fonti stanno solo nel campo interno`, s.i);
  });

  // 7. ANGLICISMI
  const cleaned = t => String(t).replace(/\b[Ii]l Deal\b/g, ' ').replace(/\bLa nostra lettura\b/g, ' ');
  const anglicismsIn = t => ANGLICISMS.filter(([, re]) => re.test(cleaned(t))).map(([n]) => n);
  head.forEach(h => {
    const a = anglicismsIn(h.text);
    if (a.length) push('error', 'ed_anglicismo_titolo', `${h.where[0].toUpperCase() + h.where.slice(1)}: anglicismi non ammessi (${a.join(', ')})`);
  });
  perSection.forEach(s => {
    const head2 = anglicismsIn([s.title, s.kpis.map(k => k && k.label).join(' ')].join(' '));
    if (head2.length) push('error', 'ed_anglicismo_titolo', `${s.label}: anglicismi nel titolo o nelle etichette KPI (${head2.join(', ')})`, s.i);
    const inBody = anglicismsIn([s.body, s.verdict].join('\n'));
    if (inBody.length > BODY_ANGLICISM_MAX) push('error', 'ed_anglicismo_corpo', `${s.label}: troppi anglicismi (${inBody.join(', ')}): al massimo ${BODY_ANGLICISM_MAX} termini tecnici`, s.i);
    else if (inBody.length) push('warning', 'ed_anglicismo_corpo', `${s.label}: anglicismi nel corpo (${inBody.join(', ')}): sostituisci quando puoi`, s.i);
  });
  if (/\bfondi PE\b/.test(allText)) push('warning', 'ed_anglicismo_pe', 'Scrivi «fondi di private equity» la prima volta, poi «fondi»');

  // 8. SENSAZIONALISMO e cliché
  const sens = (label, text, section) => {
    SENSATIONAL.forEach(re => { const m = re.exec(text); if (m) push('error', 'ed_sensazionalismo', `${label}: tono sensazionalistico («${m[0]}»)`, section); });
    CLICHES.forEach(re => { const m = re.exec(text); if (m) push('warning', 'ed_cliche', `${label}: cliché («${m[0]}»)`, section); });
  };
  head.forEach(h => sens(h.where[0].toUpperCase() + h.where.slice(1), h.text));
  perSection.forEach(s => sens(s.label, [s.title, s.body, s.verdict, s.kpiText].join('\n'), s.i));

  // 9. RIPETIZIONI: stesso attacco nei verdetti, frasi uguali o quasi tra campi e tra sezioni
  const openings = perSection.map(s => ({ s, w: words(s.verdict) }));
  for (let a = 0; a < openings.length; a++) {
    for (let b = a + 1; b < openings.length; b++) {
      const x = openings[a].w, y = openings[b].w;
      if (!x.length || !y.length) continue;
      if ((x[0] === y[0] && x[1] === y[1]) || (x[0] === 'per' && y[0] === 'per')) {
        push('error', 'ed_verdetti_stesso_attacco', `Verdetti di ${openings[a].s.label} e ${openings[b].s.label} con lo stesso attacco («${x.slice(0, 3).join(' ')}…»): variane struttura e apertura`, openings[b].s.i);
      } else if (x[0] === y[0]) {
        push('warning', 'ed_verdetti_stessa_parola', `Verdetti di ${openings[a].s.label} e ${openings[b].s.label} cominciano con la stessa parola («${x[0]}»)`, openings[b].s.i);
      }
    }
  }
  // espressioni di 5+ parole ripetute (testo e verdetto della stessa sezione, o sezioni diverse)
  const seen = new Map();
  perSection.forEach(s => {
    [['testo', s.body], ['verdetto', s.verdict]].forEach(([part, text]) => {
      sh6(text).forEach(sg => {
        if (seen.has(sg) && !(seen.get(sg).label === s.label && seen.get(sg).part === part)) {
          const prev = seen.get(sg);
          const key = `${prev.label}/${prev.part}->${s.label}/${part}`;
          if (!seen.has('k:' + key)) {
            seen.set('k:' + key, true);
            push('error', 'ed_frase_ripetuta', prev.label === s.label
              ? `${s.label}: la stessa espressione («${sg}…») compare sia nel ${prev.part} sia nel ${part}`
              : `Espressione ripetuta tra ${prev.label} e ${s.label} («${sg}…»)`, s.i);
          }
        } else if (!seen.has(sg)) seen.set(sg, { label: s.label, part });
      });
    });
  });
  function sh6(text) { return shingles(text, 5); }

  // 10. DEAL e METRICA su temi diversi
  if (perSection.length === 3) {
    const topic = s => {
      const t = [s.title, s.kpis.map(k => k && k.label).join(' '), s.verdict].join(' ');
      const scores = Object.entries(THEMES).map(([k, re]) => [k, (t.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
      return scores[0];
    };
    const d = topic(perSection[1]), m = topic(perSection[2]);
    if (d[1] >= 2 && m[1] >= 2 && d[0] === m[0]) {
      push('error', 'ed_deal_metrica_tema', `Il Deal e La Metrica trattano lo stesso tema («${d[0].replace('_', ' ')}»): la Metrica deve ruotare attorno a un altro numero`, 2);
    }
    const sig = s => new Set(words([s.title, s.kpis.map(k => k && k.label).join(' ')].join(' ')).filter(w => w.length > 4 && !STOPWORDS.has(w)));
    const A = sig(perSection[1]), B = sig(perSection[2]);
    const inter = [...A].filter(x => B.has(x)).length;
    const jac = inter / Math.max(1, new Set([...A, ...B]).size);
    if (jac >= 0.34) push('error', 'ed_deal_metrica_sovrapposti', `Il Deal e La Metrica hanno titoli e KPI troppo simili (${Math.round(jac * 100)}% di parole in comune)`, 2);
  }

  // 11. FORMATO IMPORTI: nel testo «milioni», nei KPI «mln» (avviso)
  perSection.forEach(s => {
    const t = [s.body, s.verdict].join('\n');
    if (/€\s?\d[\d.,]*\s?(?:mln|M)\b/.test(t) && /€\s?\d[\d.,]*\s+milion/.test(t)) {
      push('warning', 'ed_formato_importi', `${s.label}: importi scritti sia «milioni» sia «mln/M» nel testo: uniforma`, s.i);
    }
  });

  return checks;
}

// ── Anteprima email: footer, titolare, link ──────────────────────────────────
function emailRenderChecks(html, text) {
  const checks = [];
  const push = (code, message) => checks.push({ type: 'error', code, message });
  const h = String(html || '');
  if (!h) { push('ed_mail_assente', 'Anteprima email non disponibile: impossibile verificare footer e titolare'); return checks; }
  const visible = h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  if (!visible.includes(FOOTER_TEXT)) push('ed_mail_footer', `Footer diverso dal testo fisso: «${FOOTER_TEXT}»`);
  if (!/Titolare del trattamento:\s*Valore Atteso(?![\p{L}])/u.test(visible)) push('ed_mail_titolare', 'Titolare del trattamento diverso da «Valore Atteso»');
  const hrefs = [...h.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  if (!hrefs.some(x => /^https:\/\/www\.valoreatteso\.com\/privacy\/?(?:[?#].*)?$/.test(x))) push('ed_mail_privacy', 'Link all\'informativa privacy (valoreatteso.com/privacy) assente');
  if (!hrefs.some(x => x === 'mailto:info@valoreatteso.com')) push('ed_mail_contatto', 'Link mailto:info@valoreatteso.com assente');
  if (/(?:titolare del trattamento:\s*Valore Atteso\s*,)/i.test(visible)) push('ed_mail_indirizzo_personale', 'Nel titolare compare un indirizzo: non deve esserci nessun indirizzo personale');
  hrefs.forEach(x => {
    if (x.startsWith('#') || x.startsWith('mailto:')) return;
    let u;
    try { u = new URL(x); } catch (_) { push('ed_mail_link', `Link non valido: ${x.slice(0, 60)}`); return; }
    if (u.hostname !== 'www.valoreatteso.com' && u.hostname !== 'wa.me' && u.hostname !== 'valoreatteso.com') push('ed_mail_link_esterno', `Link esterno nell'email: ${u.hostname}`);
  });
  const anchors = [...h.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (anchors.some(a => /^fonti?\b/i.test(a))) push('ed_mail_link_fonti', 'Link «Fonti» nell\'email: non ammesso');
  if (/(^|\n)\s*Fonti?:/i.test(String(text || '')) || />\s*Fonti?\s*:\s*</i.test(h)) push('ed_mail_blocco_fonti', 'Blocco «Fonti» nell\'email: non ammesso');
  const m = OUTLET_RE.exec(visible);
  if (m) push('ed_mail_testata', `Nome di testata o social nell'email («${m[0]}»)`);
  return checks;
}

module.exports = { editorialChecks, emailRenderChecks, appliesTo, evalFormula, FOOTER_TEXT, FIRST_EDITION, OUTLETS, ANGLICISMS };
