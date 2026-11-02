// api/_lib/redazione-guard.js
// Permessi dell'agente redazione (Parte B). L'agente produce solo BOZZE:
//   - non invia, non pubblica, non approva, non elimina, non rigenera su richiesta propria;
//   - non legge ne' scrive tabelle di iscritti o di indirizzi email;
//   - non legge sent_to, sent_count, sent_at, draft_token ne' la colonna email delle edizioni
//     (la colonna email la scrive solo il codice esistente di genera-edizione: preheader, tesi, "cosa guardare").
// Ogni accesso al database dell'agente passa da guardedClient(): un accesso non previsto lancia un errore.

const ALLOWED = {
  // tabella -> { select: colonne leggibili ('*' mai), update: colonne scrivibili, insert: false }
  editions: {
    select: ['id', 'num', 'title', 'subtitle', 'date', 'opener', 'sections', 'tags', 'published', 'factcheck', 'created_at'],
    update: ['title', 'subtitle', 'opener', 'sections', 'date', 'tags', 'factcheck', 'email'],
  },
  editorial_wiki: { select: ['categoria', 'chiave', 'valore', 'edizione_ref'], update: [] },
  agent_memory: { select: ['id', 'agent', 'key', 'value', 'created_at'], update: [] },
};
const FORBIDDEN_TABLES = ['subscribers', 'blocked_emails', 'rate_limits', 'sponsor_requests', 'sponsors'];
const FORBIDDEN_COLUMNS = ['sent_to', 'sent_count', 'sent_at', 'draft_token', 'published'];
const FORBIDDEN_ACTIONS = ['send', 'publish', 'approve', 'regenerate', 'delete'];

class AgentPermissionError extends Error {
  constructor(message) { super('Permesso negato all\'agente redazione: ' + message); this.name = 'AgentPermissionError'; }
}

const cols = c => String(c || '').split(',').map(s => s.trim()).filter(Boolean);

function assertTable(table) {
  if (FORBIDDEN_TABLES.includes(table)) throw new AgentPermissionError(`la tabella «${table}» è vietata`);
  if (!ALLOWED[table]) throw new AgentPermissionError(`la tabella «${table}» non è tra quelle consentite`);
}

function assertSelect(table, columns) {
  assertTable(table);
  const list = cols(columns);
  if (!list.length || list.includes('*')) throw new AgentPermissionError(`select su «${table}» senza elenco di colonne (vietato select *)`);
  list.forEach(c => {
    if (FORBIDDEN_COLUMNS.filter(x => x !== 'published').includes(c)) throw new AgentPermissionError(`la colonna «${c}» non è leggibile`);
    if (c === 'email' && table === 'editions') throw new AgentPermissionError('la colonna «email» non è leggibile');
    if (!ALLOWED[table].select.includes(c)) throw new AgentPermissionError(`la colonna «${table}.${c}» non è tra quelle leggibili`);
  });
}

// Una bozza si scrive con un update parziale: mai published, mai campi di invio.
function assertDraftPatch(patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) throw new AgentPermissionError('update vuoto');
  keys.forEach(k => {
    if (FORBIDDEN_COLUMNS.includes(k)) throw new AgentPermissionError(`la colonna «${k}» non è scrivibile (pubblicazione e invio spettano a Paolo)`);
    if (!ALLOWED.editions.update.includes(k)) throw new AgentPermissionError(`la colonna «editions.${k}» non è scrivibile`);
  });
  return patch;
}

function assertAction(action) {
  if (FORBIDDEN_ACTIONS.includes(String(action))) throw new AgentPermissionError(`l'azione «${action}» non è consentita`);
}

// Client con interfaccia ridotta: select/update ammessi, nessun insert, upsert o delete.
function guardedClient(supabase) {
  return {
    from(table) {
      assertTable(table);
      const q = supabase.from(table);
      return {
        select(columns, ...rest) { assertSelect(table, columns); return q.select(columns, ...rest); },
        update(patch) {
          if (table !== 'editions') throw new AgentPermissionError(`scrittura su «${table}» non consentita`);
          return q.update(assertDraftPatch(patch));
        },
      };
    },
  };
}

module.exports = { AgentPermissionError, ALLOWED, FORBIDDEN_TABLES, FORBIDDEN_COLUMNS, FORBIDDEN_ACTIONS, assertTable, assertSelect, assertDraftPatch, assertAction, guardedClient };
