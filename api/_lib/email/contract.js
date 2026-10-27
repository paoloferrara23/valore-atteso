// api/_lib/email/contract.js — Contratto dell'edizione a partire dalla riga Supabase `editions`.
//
// I contenuti restano su Supabase. Le colonne di oggi (num, date, title, subtitle, sections)
// danno titolo, dek, testi, KPI e letture; la colonna proposta `email` (jsonb, vedi
// sql/2026-10-27_editions_email.sql) contiene solo i campi del template: preheader, intro,
// summary, sections[i].{kpi, module, sources}, watch, share, sponsor, approvals.
// Se un campo manca resta vuoto e la validazione lo segnala: qui non si inventa nulla.

const cfg = require('./config');

function contractFromRow(row) {
  const e = row.email || {};
  const num = String(row.num || '').padStart(3, '0');
  const extra = e.sections || [];
  return {
    edition: num,
    date: row.date,
    read_min: e.read_min !== undefined ? e.read_min : 8,
    subject: e.subject !== undefined ? e.subject : `#${num} - ${row.title}`,
    preheader: e.preheader || '',
    kicker: e.kicker || cfg.copy.kicker,
    title: row.title || '',
    dek: e.dek !== undefined ? e.dek : (row.subtitle || ''),
    intro: e.intro !== undefined ? e.intro : null,
    sponsor: e.sponsor !== undefined ? e.sponsor : null,
    summary: e.summary || [],
    sections: (row.sections || []).map((s, i) => {
      const x = extra[i] || {};
      const body = Array.isArray(s.body) ? s.body : String(s.body || '').split(/\n{2,}/);
      return {
        n: i + 1,
        label: s.label || cfg.sectionLabels[i],
        title: s.title || '',
        kpi: x.kpi !== undefined ? x.kpi : (s.kpis || []).map(k => ({ value: k.value, label: k.label })),
        module: x.module || { type: 'none' },
        body: body.map(p => String(p).trim()).filter(Boolean),
        reading: s.verdict || '',
        sources: x.sources !== undefined ? x.sources : (s.sources || []),
      };
    }),
    watch: e.watch || [],
    share: e.share || { headline: '', subline: '', text: '' },
    approvals: e.approvals || { copy: false, factcheck: false, paolo: row.published === true },
  };
}

module.exports = { contractFromRow };
