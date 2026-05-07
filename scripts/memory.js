// memory.js — Memoria condivisa tra agenti via Supabase
// Usato da tutti gli agenti per leggere/scrivere stato

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;

async function supaFetch(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      ...(opts.headers || {})
    }
  });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Legge un valore dalla memoria condivisa
async function memGet(key) {
  try {
    const rows = await supaFetch(`/rest/v1/agent_memory?key=eq.${encodeURIComponent(key)}&select=value,written_by,updated_at`);
    return rows[0] || null;
  } catch { return null; }
}

// Scrive un valore nella memoria condivisa
async function memSet(key, value, writtenBy) {
  await supaFetch('/rest/v1/agent_memory', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, written_by: writtenBy, updated_at: new Date().toISOString() })
  });
}

// Logga il run di un agente
async function logRun(agent, status, summary, output = null, durationMs = null) {
  await supaFetch('/rest/v1/agent_runs', {
    method: 'POST',
    body: JSON.stringify({ agent, status, summary, data: output, output, duration_ms: durationMs })
  });
}

// Recupera ultimi run per ogni agente
async function getAgentStatus() {
  const rows = await supaFetch('/rest/v1/agent_runs?select=agent,status,summary,created_at&order=created_at.desc&limit=20');
  const status = {};
  rows.forEach(r => { if (!status[r.agent]) status[r.agent] = r; });
  return status;
}

module.exports = { memGet, memSet, logRun, getAgentStatus, supaFetch };
