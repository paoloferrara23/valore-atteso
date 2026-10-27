// api/_lib/email/contract.js — Contratto dell'edizione a partire dalla riga Supabase `editions`.
//
// Colonne di oggi: num, date, title, subtitle, sections (label, title, body, kpis, verdict), published.
// Colonna `email` (jsonb): campi del template che il Writer produce dalla #027
// (preheader, summary, watch) e quelli opzionali (sections[i].kpi/module, sponsor, read_min).
// Ripieghi quando un campo manca, senza scrivere testo nuovo:
//   - tesi della sintesi = titolo della sezione; numero della sintesi = primo KPI;
//   - preheader = sottotitolo (se entro 100 caratteri), altrimenti titolo;
//   - "Cosa guardare" assente = blocco non mostrato.

const cfg = require('./config');

function contractFromRow(row, opts = {}) {
  const e = row.email || {};
  const num = String(row.num || '').padStart(3, '0');
  const extra = e.sections || [];
  const sections = (row.sections || []).map((s, i) => {
    const x = extra[i] || {};
    const body = Array.isArray(s.body) ? s.body : String(s.body || '').split(/\n{2,}/);
    return {
      n: i + 1,
      label: s.label || cfg.sectionLabels[i],
      title: s.title || '',
      kpi: x.kpi !== undefined ? x.kpi : (s.kpis || []).map(k => ({ value: String(k.value || ''), label: String(k.label || '') })),
      module: x.module || { type: 'none' },
      body: body.map(p => String(p).trim()).filter(Boolean),
      reading: s.verdict || '',
    };
  });
  const summary = sections.map((s, i) => {
    const x = (e.summary || [])[i] || {};
    return {
      section_n: i + 1,
      label: s.label,
      number: x.number || (s.kpi[0] && s.kpi[0].value) || '',
      thesis: x.thesis || s.title,
    };
  });
  const subtitle = row.subtitle || '';
  return {
    edition: num,
    edition_page: opts.editionPage !== undefined ? opts.editionPage : true,
    date: row.date,
    read_min: e.read_min || 8,
    subject: e.subject || `#${num} - ${row.title}`,
    preheader: e.preheader || (subtitle && subtitle.length <= 100 ? subtitle : row.title || ''),
    kicker: cfg.copy.kicker,
    title: row.title || '',
    dek: e.dek || subtitle,
    sponsor: e.sponsor !== undefined ? e.sponsor : null,
    summary,
    sections,
    watch: (e.watch || []).filter(w => w && w.label && w.text),
    approvals: { paolo: row.published === true },
  };
}

module.exports = { contractFromRow };
