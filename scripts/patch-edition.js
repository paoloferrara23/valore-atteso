// scripts/patch-edition.js — Correzioni redazionali su una bozza, senza passare dalla Control Room.
// Lanciato dal workflow "Edition Patch" (workflow_dispatch) con la patch in env PATCH_JSON:
//   {
//     "num": "026",
//     "fields":   { "title": "...", "subtitle": "...", "opener": "...", "date": "..." },
//     "sections": [ { "index": 0, "field": "verdict", "value": "..." } ],
//     "reset_factcheck": true
//   }
// Regole di sicurezza: tocca solo edizioni MAI inviate (sent_at nullo), solo i campi in
// whitelist, e rifiuta testi con trattino lungo o segnaposto (gli stessi blocchi di lib/preflight).

const { supaFetch, logRun } = require('./memory');

const EDITION_FIELDS = ['title', 'subtitle', 'opener', 'date'];
const SECTION_FIELDS = ['label', 'title', 'body', 'kpis', 'sources', 'verdict'];
const PLACEHOLDER = /\[[^\]]*?(da verificare|verificare|todo|tbd|inserire)[^\]]*?\]|\b(TODO|TBD|FIXME)\b/i;

function checkText(where, value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/—/.test(s)) throw new Error(`${where}: contiene un trattino lungo`);
  if (PLACEHOLDER.test(s)) throw new Error(`${where}: contiene un segnaposto`);
}

// Applica la patch all'edizione e ritorna { update, changed } senza toccare la rete.
function applyPatch(edition, patch) {
  const update = {};
  const changed = [];
  Object.entries(patch.fields || {}).forEach(([k, v]) => {
    if (!EDITION_FIELDS.includes(k)) throw new Error(`Campo edizione non ammesso: ${k}`);
    checkText(k, v);
    update[k] = v;
    changed.push(k);
  });
  if (Array.isArray(patch.sections) && patch.sections.length) {
    const sections = JSON.parse(JSON.stringify(edition.sections || []));
    patch.sections.forEach(({ index, field, value }) => {
      if (!Number.isInteger(index) || !sections[index]) throw new Error(`Sezione inesistente: ${index}`);
      if (!SECTION_FIELDS.includes(field)) throw new Error(`Campo sezione non ammesso: ${field}`);
      checkText(`sezione ${index}.${field}`, value);
      sections[index][field] = value;
      changed.push(`sections[${index}].${field}`);
    });
    update.sections = sections;
  }
  if (patch.reset_factcheck) { update.factcheck = null; changed.push('factcheck=null'); }
  return { update, changed };
}

async function main() {
  const patch = JSON.parse(process.env.PATCH_JSON || '{}');
  const num = String(patch.num || '').padStart(3, '0');
  if (!/^\d{3}$/.test(num)) throw new Error('Numero edizione mancante o non valido');

  const rows = await supaFetch(`/rest/v1/editions?num=eq.${num}&select=id,num,sections,sent_at&limit=1`);
  const edition = Array.isArray(rows) ? rows[0] : null;
  if (!edition) throw new Error(`Edizione ${num} non trovata`);
  if (edition.sent_at) throw new Error(`Edizione ${num} già inviata: patch rifiutata`);

  const { update, changed } = applyPatch(edition, patch);
  if (!changed.length) throw new Error('Patch vuota');

  await supaFetch(`/rest/v1/editions?id=eq.${edition.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(update)
  });
  console.log(`Edizione ${num} aggiornata: ${changed.join(', ')}`);
  await logRun('editor-patch', 'success', `#${num}: ${changed.join(', ')}`).catch(() => {});
}

module.exports = { applyPatch };

if (require.main === module) {
  main().catch(e => { console.error('ERRORE patch:', e.message); process.exit(1); });
}
