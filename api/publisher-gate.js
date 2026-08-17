// api/publisher-gate.js
// Verifica pre-pubblicazione prima dell'invio newsletter
// Checks di contenuto delegati a lib/preflight (condivisi con send-newsletter/send-test).
// Qui restano i check che richiedono il DB: dedup temi, stato pubblicazione, sponsor.
const { createClient } = require('@supabase/supabase-js');
const { contentPreflight } = require('../lib/preflight');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_KEY
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

    // ── 1-3. CONTENUTO (placeholder, trattini, KPI, fonti, verdetto, corpo) ──
    // Delegato al validatore condiviso: stessa logica usata al momento dell'invio.
    const preflight = contentPreflight(edition);
    const checks = [...preflight.checks];
    let blockers = preflight.blockers;

    const sectionLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];

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

    // ── 5. STATO PUBBLICAZIONE ──────────────────────────────────────────────
    if (!edition.published) {
      checks.push({ type: 'error', code: 'not_published', message: 'Edizione non marcata come pubblicata' });
      blockers++;
    }

    // 6. SPONSOR ASSOCIATI
    const { data: sponsors, error: sponsorErr } = await supabase
      .from('sponsor_requests')
      .select('company,slot_type,preview_status,payment_status,materials_status,terms_accepted_at,publication_authorized_at')
      .eq('edition_id', edition.id);
    if (sponsorErr) throw new Error('Supabase sponsor: ' + sponsorErr.message);
    (sponsors || []).forEach(sponsor => {
      const ready = sponsor.preview_status === 'approved'
        && sponsor.payment_status === 'received'
        && sponsor.materials_status === 'approved'
        && sponsor.terms_accepted_at
        && sponsor.publication_authorized_at;
      if (!ready) {
        checks.push({
          type: 'error',
          code: 'sponsor_not_ready',
          message: `Sponsor ${sponsor.company}: mancano approvazioni, pagamento, materiali o accettazioni legali`
        });
        blockers++;
      } else {
        checks.push({
          type: 'ok',
          code: 'sponsor_ready',
          message: `Sponsor ${sponsor.company}: ${sponsor.slot_type} pronto per l'invio`
        });
      }
    });

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
