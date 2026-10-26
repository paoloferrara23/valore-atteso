// lib/preflight.js
// Controlli deterministici pre-invio (barriera 2 della "macchina redazionale").
// Funzione pura: nessuna dipendenza da rete o Supabase, così è riusabile e testabile.
// Consumata da:
//   - api/publisher-gate.js   (anteprima check in Control Room)
//   - api/send-newsletter.js  (blocco reale prima dell'invio massivo)
//   - api/send-test.js        (mostra i check nel test, senza bloccare)
//
// Regola chiave: un BLOCKER impedisce l'invio. Un WARNING si mostra ma non blocca.
// Filosofia: bloccare solo cose inequivocabili (placeholder, trattino lungo, sezione
// senza corpo/KPI/fonti, titolo mancante). Tutto ciò che è "di gusto" resta warning.

const SECTION_LABELS = ['Il Bilancio', 'Il Deal', 'La Metrica'];

// Placeholder tipici lasciati dagli agenti: "[dato da verificare]", "[da verificare 2026]",
// "[inserire]", "TODO", "TBD", "XXX", "[...]", "???".
const PLACEHOLDER_BRACKET = /\[[^\]]*?(da verificare|verificare|dato|todo|tbd|inserire|aggiorna|fonte|placeholder|xxx|\.\.\.|…)[^\]]*?\]/i;
const PLACEHOLDER_TOKEN = /\b(TODO|TBD|FIXME|XXX)\b|\?\?\?/;

// Trattini: em-dash — (U+2014) vietato da regola editoriale; en-dash – (U+2013) sconsigliato.
const EM_DASH = /—/;
const EN_DASH = /–/;

// Fonti chiaramente non ammesse (blog di tifosi, forum, aggregatori di rumor).
// NB: Calcio e Finanza e Transfermarkt NON sono qui: sono fonti ammesse.
const JUNK_SOURCE = /\b(reddit|blogspot|wordpress|forum|tifosi|rumor|gossip|bleacher\s?report)\b/i;

// URL nudi nella riga fonti (la riga fonti va tenuta pulita, senza link).
const BARE_URL = /(https?:\/\/|www\.)/i;

// Lunghezza massima di un corpo sezione per rispettare il "test del caffè" (~8 minuti).
// ~1800 caratteri per sezione x3 sezioni resta una lettura da pochi minuti.
const BODY_MAX_CHARS = 1800;

function bodyToString(body) {
  return Array.isArray(body) ? body.join('\n\n') : String(body || '');
}

// Estrae i "gruppi numero" da una stringa (es. "97,7%" -> ["97,7"], "€65,4M" -> ["65,4"]).
function numbersIn(str) {
  return (String(str).match(/\d+(?:[.,]\d+)?/g) || []);
}

// Il valore di un KPI compare (anche approssimato) nel corpo?
// Match se il numero esatto è nel corpo, oppure la sua parte intera o un intero adiacente
// (per tollerare gli arrotondamenti narrativi voluti: KPI 97,7% ~ corpo "vicino al 98%").
function kpiValueAppearsInBody(kpiValue, body) {
  const nums = numbersIn(kpiValue);
  if (!nums.length) return true; // KPI senza numero (es. "N/D") non va controllato
  const bodyNums = numbersIn(body);
  const bodyIntSet = new Set(bodyNums.map(n => Math.round(parseFloat(n.replace(',', '.')))));
  return nums.some(n => {
    if (body.includes(n)) return true;
    const asFloat = parseFloat(n.replace(',', '.'));
    if (!isFinite(asFloat)) return false;
    const base = Math.round(asFloat);
    return bodyIntSet.has(base) || bodyIntSet.has(base - 1) || bodyIntSet.has(base + 1);
  });
}

/**
 * Esegue i controlli di contenuto deterministici su una edizione.
 * @param {object} edition - riga della tabella editions (con .title, .sections, ...)
 * @returns {{ checks: Array, blockers: number, warnings: number, oks: number, can_send: boolean }}
 */
function contentPreflight(edition) {
  const checks = [];
  const push = (type, code, message, section) => checks.push({ type, code, message, section });

  const sections = Array.isArray(edition && edition.sections) ? edition.sections : [];

  // ── 0. TITOLO EDIZIONE ────────────────────────────────────────────────────
  if (!edition || !edition.title || String(edition.title).trim().length < 5) {
    push('error', 'missing_title', 'Titolo edizione mancante o troppo corto');
  }

  // ── 0b. NUMERO DI SEZIONI ─────────────────────────────────────────────────
  if (sections.length < 3) {
    push('error', 'missing_sections', `Solo ${sections.length} sezioni su 3 (Bilancio / Deal / Metrica)`);
  }

  sections.forEach((sec, i) => {
    const label = (sec && sec.label) || SECTION_LABELS[i] || `Sezione ${i + 1}`;
    const title = String((sec && sec.title) || '').trim();
    const body = bodyToString(sec && sec.body);
    const verdict = String((sec && sec.verdict) || '').trim();
    const sources = Array.isArray(sec && sec.sources) ? sec.sources : [];
    const kpis = (sec && (sec.kpis || sec.kpi_rows)) || [];
    const scanText = [title, body, verdict].join('\n');

    // 1. CORPO E TITOLO PRESENTI
    if (!title) push('error', 'missing_section_title', `${label}: titolo sezione mancante`, i);
    if (body.trim().length < 80) {
      push('error', 'empty_body', `${label}: corpo mancante o troppo corto`, i);
    } else if (body.length > BODY_MAX_CHARS) {
      push('warning', 'body_too_long', `${label}: corpo lungo (${body.length} caratteri) — verifica il test del caffè`, i);
    }

    // 2. PLACEHOLDER (blocco: è l'errore del #15)
    if (PLACEHOLDER_BRACKET.test(scanText) || PLACEHOLDER_TOKEN.test(scanText)) {
      push('error', 'placeholder', `${label}: contiene un segnaposto non risolto (es. "[da verificare]", TODO)`, i);
    }

    // 3. TRATTINI
    if (EM_DASH.test(scanText)) {
      push('error', 'em_dash', `${label}: contiene un trattino lungo "—" (vietato)`, i);
    }
    if (EN_DASH.test(scanText)) {
      push('warning', 'en_dash', `${label}: contiene un trattino medio "–" — usa un trattino corto o riformula`, i);
    }

    // 4. KPI
    if (!kpis.length) {
      push('error', 'missing_kpi', `${label}: nessun KPI`, i);
    } else {
      const incomplete = kpis.filter(k => !k || !k.value || !k.label);
      if (incomplete.length) {
        push('warning', 'incomplete_kpi', `${label}: ${incomplete.length} KPI con label o value mancante`, i);
      }
      // KPI orfano: numero nei KPI che non compare nel corpo (possibile dato inventato)
      if (body.trim().length >= 80) {
        const orphan = kpis.filter(k => k && k.value && !kpiValueAppearsInBody(String(k.value), body));
        if (orphan.length) {
          push('warning', 'kpi_not_in_body',
            `${label}: ${orphan.length} valore/i KPI non compare nel testo (${orphan.map(k => k.value).join(', ')})`, i);
        }
      }
    }

    // 5. FONTI
    if (!sources.length) {
      push('error', 'missing_sources', `${label}: nessuna fonte indicata`, i);
    } else {
      if (sources.length < 2) {
        // Proxy anti-plagio: con una sola fonte si rischia di riscrivere un solo articolo.
        push('warning', 'single_source',
          `${label}: una sola fonte — aggiungi una fonte indipendente di riscontro`, i);
      }
      sources.forEach(src => {
        const s = String(src || '');
        if (JUNK_SOURCE.test(s)) {
          push('warning', 'weak_source', `${label}: fonte poco affidabile ("${s.slice(0, 40)}")`, i);
        }
        if (BARE_URL.test(s)) {
          push('warning', 'url_in_source', `${label}: la riga fonti contiene un URL — tienila pulita`, i);
        }
      });
    }

    // 6. VERDETTO
    if (!verdict || verdict.length < 20) {
      push('warning', 'missing_verdict', `${label}: "La nostra lettura" assente o troppo breve`, i);
    }
  });

  // ── 7. FACT-CHECK (barriera 3) ────────────────────────────────────────────
  // Esito scritto da scripts/factcheck-agent.js su editions.factcheck.
  // IMPORTANTE: il fact-check è un agente LLM con web search, quindi ha varianza:
  // a run diversi segnala cose diverse, a volte contesta dati corretti o allucina
  // (es. clausole inesistenti). Per questo le sue contraddizioni sono WARNING, non
  // blocchi: vanno lette e valutate a mano, ma NON impediscono l'invio da sole.
  // I blocchi restano appannaggio dei soli controlli deterministici e affidabili
  // qui sopra (trattini, segnaposto, campi mancanti, titolo).
  const fc = edition && edition.factcheck;
  if (!fc || !fc.checked_at) {
    push('warning', 'not_factchecked', 'Edizione non ancora passata dal Fact-Check agent');
  } else {
    const contradictions = Array.isArray(fc.contradictions) ? fc.contradictions : [];
    contradictions.forEach(c => {
      push('warning', 'factcheck_contradiction',
        `Fact-check ${c.section || ''}: "${String(c.claim || '').slice(0, 90)}"${c.correct ? ` → verifica: ${c.correct}` : ''} (avviso, non blocca)`);
    });
    const unver = (fc.totals && fc.totals.unverifiable) || 0;
    if (!contradictions.length && unver > 0) {
      push('warning', 'factcheck_unverifiable', `Fact-check: ${unver} affermazione/i non verificabile/i — controlla prima di inviare`);
    }
    if (!contradictions.length) {
      push('ok', 'factcheck_ok', `Fact-check superato (${(fc.totals && fc.totals.verified) || 0} affermazioni verificate)`);
    }
  }

  const blockers = checks.filter(c => c.type === 'error').length;
  const warnings = checks.filter(c => c.type === 'warning').length;

  // Se non ci sono error, aggiungi un ok riassuntivo di contenuto.
  if (blockers === 0) {
    push('ok', 'content_ok', 'Controlli di contenuto superati (nessun blocco)');
  }

  return {
    checks,
    blockers,
    warnings,
    oks: checks.filter(c => c.type === 'ok').length,
    can_send: blockers === 0,
  };
}

module.exports = { contentPreflight, SECTION_LABELS };
