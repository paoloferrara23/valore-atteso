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
  const text = await r.text();
  if (!text || text.trim() === '') return null;
  return JSON.parse(text);
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
  await supaFetch('/rest/v1/agent_memory?on_conflict=key', {
    method: 'POST',
    headers: {
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
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


// ── EDITORIAL WIKI ────────────────────────────────────────────────────────────

async function getWiki(categorie = null) {
  // Legge il Wiki editoriale filtrato per categoria
  let url = `${SUPA_URL}/rest/v1/editorial_wiki?select=categoria,chiave,valore,fonte,edizione_ref&order=categoria.asc,created_at.desc`;
  if (categorie && categorie.length) {
    url += `&categoria=in.(${categorie.join(',')})`;
  }
  const r = await supaFetch(url);
  return Array.isArray(r) ? r : [];
}

async function getWikiContext() {
  // Costruisce il contesto Wiki completo per gli agenti
  const rows = await getWiki();
  
  const stile    = rows.filter(r => r.categoria === 'stile').map(r => `${r.chiave}: ${r.valore}`).join('\n');
  const edizioni = rows.filter(r => r.categoria === 'edizione').map(r => r.valore).join('\n');
  const errori   = rows.filter(r => r.categoria === 'errore').map(r => r.valore).join('\n');
  const club     = rows.filter(r => r.categoria === 'club_analizzato').map(r => r.valore).join('\n');
  const angoli   = rows.filter(r => r.categoria === 'angolo_usato').map(r => r.valore).join('\n');

  return `=== WIKI EDITORIALE VALORE ATTESO ===

STILE E REGOLE:
${stile}

EDIZIONI PRECEDENTI (non ripetere stessi temi/club):
${edizioni}

CLUB GIÀ ANALIZZATI:
${club}

${angoli ? `ANGOLI GIÀ USATI:
${angoli}
` : ''}
ERRORI DA EVITARE (segnalati da Paolo):
${errori}

=== FINE WIKI ===`;
}

async function addWikiEntry(categoria, chiave, valore, fonte = 'sistema', edizioneRef = null) {
  // Aggiunge o aggiorna una voce nel Wiki
  const r = await fetch(`${SUPA_URL}/rest/v1/editorial_wiki?on_conflict=chiave`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ 
      categoria, chiave, valore, fonte, 
      edizione_ref: edizioneRef,
      updated_at: new Date().toISOString()
    })
  });
  return r.ok;
}

async function updateWikiAfterPublish(edition) {
  // Auto-aggiorna il Wiki dopo pubblicazione edizione
  const { num, title, sections = [] } = edition;
  
  // Aggiungi edizione
  await addWikiEntry('edizione', `ed_${num}`,
    `Edizione #${num}: ${title} | Sezioni: ${sections.map(s => s.title || s.titolo || '').join(' / ')}`,
    'sistema', num
  );
  
  // Aggiungi club analizzati
  for (const sec of sections) {
    const titolo = sec.title || sec.titolo || '';
    if (titolo) {
      const chiave = `club_${num}_${titolo.slice(0,20).toLowerCase().replace(/[^a-z0-9]/g,'')}`;
      await addWikiEntry('club_analizzato', chiave,
        `Analizzato in edizione #${num}: ${titolo}`,
        'sistema', num
      );
    }
  }
  
  console.log(`Wiki aggiornato per edizione #${num}`);
}

module.exports = { memGet, memSet, logRun, getAgentStatus, supaFetch, getWiki, getWikiContext, addWikiEntry, updateWikiAfterPublish };


