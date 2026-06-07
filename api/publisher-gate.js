// api/publisher-gate.js
// Verifica pre-pubblicazione prima dell'invio newsletter
// Checks: dedup temi, KPI presenti, fonti pulite, verdict presenti
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  const token = req.headers['x-cr-token'];
  if (token !== CR_TOKEN) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const { edition_num } = req.body;
    if (!edition_num) return res.status(400).json({ error: 'edition_num obbligatorio' });

    const num = String(edition_num).padStart(3, '0');

    // Carica edizione
    const { data: editions, error: edErr } = await supabase
      .from('editions')
      .select('*')
      .eq('num', num)
      .limit(1);

    if (edErr) throw new Error('Supabase: ' + edErr.message);
    if (!editions || !editions.length) {
      return res.status(404).json({ error: `Edizione #${num} non trovata` });
    }

    const edition = editions[0];
    const sections = edition.sections || [];

    const checks = [];
    let blockers = 0; // errori critici che bloccano l'invio

    // ── 1. KPI PRESENTI ────────────────────────────────────────────────────
    const sectionLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
    sections.forEach((sec, i) => {
      const label = sectionLabels[i] || `Sezione ${i + 1}`;
      const kpis = sec.kpis || sec.kpi_rows || [];
      if (!kpis || kpis.length === 0) {
        checks.push({
          type: 'error',
          code: 'missing_kpi',
          message: `${label}: nessun KPI presente`,
          section: i
        });
        blockers++;
      } else {
        const invalidKpi = kpis.find(k => !k.value || !k.label);
        if (invalidKpi) {
          checks.push({
            type: 'warning',
            code: 'incomplete_kpi',
            message: `${label}: KPI con label o value mancante`,
            section: i
          });
        } else {
          checks.push({
            type: 'ok',
            code: 'kpi_ok',
            message: `${label}: ${kpis.length} KPI presenti`
          });
        }
      }
    });

    // ── 2. DATO DA VERIFICARE ───────────────────────────────────────────────
    let daVerificareCount = 0;
    sections.forEach((sec, i) => {
      const label = sectionLabels[i] || `Sezione ${i + 1}`;
      const body = Array.isArray(sec.body)
        ? sec.body.join(' ')
        : String(sec.body || '');
      const verdict = String(sec.verdict || '');
      const fullText = body + ' ' + verdict + ' ' + (sec.title || '');

      const matches = (fullText.match(/\[dato da verificare\]/gi) || []).length;
      if (matches > 0) {
        daVerificareCount += matches;
        checks.push({
          type: 'warning',
          code: 'unverified_data',
          message: `${label}: ${matches} dato/i non verificato/i`,
          section: i
        });
      }
    });

    if (daVerificareCount === 0) {
      checks.push({
        type: 'ok',
        code: 'sources_clean',
        message: 'Nessun [dato da verificare] nel testo'
      });
    }

    // ── 3. VERDICT PRESENTI ─────────────────────────────────────────────────
    sections.forEach((sec, i) => {
      const label = sectionLabels[i] || `Sezione ${i + 1}`;
      const verdict = String(sec.verdict || '').trim();
      if (!verdict || verdict.length < 20) {
        checks.push({
          type: 'warning',
          code: 'missing_verdict',
          message: `${label}: verdetto assente o troppo breve`,
          section: i
        });
      } else {
        checks.push({
          type: 'ok',
          code: 'verdict_ok',
          message: `${label}: verdetto presente`
        });
      }
    });

    // ── 4. DEDUP — tema già trattato? ───────────────────────────────────────
    const { data: wikiEntries } = await supabase
      .from('editorial_wiki')
      .select('chiave, valore')
      .eq('categoria', 'edizione')
      .neq('chiave', `ed_${num}`); // escludi l'edizione corrente

    if (wikiEntries && wikiEntries.length > 0) {
      const currentTitle = String(edition.title || '').toLowerCase();
      const currentSectionTitles = sections
        .map(s => String(s.title || s.titolo || '').toLowerCase())
        .filter(Boolean);

      const dupMatches = [];

      wikiEntries.forEach(entry => {
        const entryText = String(entry.valore || '').toLowerCase();
        // Controlla overlap di parole chiave significative (>5 caratteri)
        const keywords = currentTitle.split(/\s+/).filter(w => w.length > 5);
        const matchingKw = keywords.filter(kw => entryText.includes(kw));

        if (matchingKw.length >= 2) {
          dupMatches.push({
            edizione: entry.chiave.replace('ed_', '#'),
            overlap: matchingKw.slice(0, 3).join(', ')
          });
        }

        // Controlla anche i titoli delle sezioni
        currentSectionTitles.forEach(secTitle => {
          const secKeywords = secTitle.split(/\s+/).filter(w => w.length > 5);
          const secMatches = secKeywords.filter(kw => entryText.includes(kw));
          if (secMatches.length >= 2 && !dupMatches.find(d => d.edizione === entry.chiave.replace('ed_', '#'))) {
            dupMatches.push({
              edizione: entry.chiave.replace('ed_', '#'),
              overlap: secMatches.slice(0, 3).join(', ')
            });
          }
        });
      });

      if (dupMatches.length > 0) {
        checks.push({
          type: 'warning',
          code: 'possible_duplicate',
          message: `Possibile sovrapposizione con: ${dupMatches.map(d => `${d.edizione} (${d.overlap})`).join('; ')}`
        });
      } else {
        checks.push({
          type: 'ok',
          code: 'dedup_ok',
          message: 'Nessuna sovrapposizione tematica rilevata'
        });
      }
    } else {
      checks.push({
        type: 'ok',
        code: 'dedup_ok',
        message: 'Prima edizione — nessun confronto disponibile'
      });
    }

    // ── 5. METADATI BASE ────────────────────────────────────────────────────
    if (!edition.title || edition.title.trim().length < 5) {
      checks.push({ type: 'error', code: 'missing_title', message: 'Titolo edizione mancante' });
      blockers++;
    }
    if (!edition.published) {
      checks.push({ type: 'error', code: 'not_published', message: 'Edizione non marcata come pubblicata' });
      blockers++;
    }

    // ── RISULTATO FINALE ────────────────────────────────────────────────────
    const errors = checks.filter(c => c.type === 'error').length;
    const warnings = checks.filter(c => c.type === 'warning').length;
    const oks = checks.filter(c => c.type === 'ok').length;

    const canSend = blockers === 0;

    return res.status(200).json({
      ok: true,
      can_send: canSend,
      edition_num: num,
      edition_title: edition.title,
      summary: {
        errors,
        warnings,
        oks,
        blockers
      },
      checks
    });

  } catch (err) {
    console.error('[publisher-gate]', err);
    return res.status(500).json({ error: err.message });
  }
};
