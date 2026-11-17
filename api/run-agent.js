// api/run-agent.js — Esegui agente manualmente dalla Control Room
const { createClient } = require('@supabase/supabase-js');
const { requireAdmin, serviceKey, login, logout } = require('./_lib/admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, serviceKey() || process.env.SUPABASE_KEY);

const AGENT_MAP = {
  scout:      { workflow: 'scout.yml',             label: 'Scout' },
  seo:        { workflow: 'seo-agent.yml',          label: 'SEO Agent' },
  editoriale: { workflow: 'editoriale-agent.yml',   label: 'Editoriale Agent' },
  growth:     { workflow: 'growth-agent.yml',       label: 'Growth Agent' },
  factcheck:  { workflow: 'factcheck-agent.yml',    label: 'Fact-Check Agent' },
  'sponsor-outreach': { workflow: 'sponsor-outreach.yml', label: 'Sponsor Outreach' },
  // Pagina web /edizione-N: lanciata dalla Control Room all'approvazione, così "Leggi online" dell'email non resta sull'archivio.
  'edition-pages': { workflow: 'edition-pages.yml', label: 'Pagine edizioni' },
};

const REPO = 'paoloferrara23/valore-atteso';

module.exports = async function handler(req, res) {
  // Le deleghe sono protette: se il modulo delegato lancia in fase di load
  // (o di esecuzione async), restituiamo un JSON con l'errore reale invece
  // di lasciare crashare la function — che produrrebbe la pagina HTML
  // "A server error has occurred" e un JSON.parse fallito lato Control Room.
  // Accesso Control Room (vedi api/_lib/admin-auth.js): niente file nuovi in api/.
  const action = req.query?.action;
  if (action === 'adminLogin') return login(req, res);
  if (action === 'adminLogout') return logout(req, res);
  if (action === 'adminPage') return require('./_lib/admin-page')(req, res);
  if (action === 'adminDb') {
    try { return await require('./_lib/admin-db')(req, res); }
    catch (e) {
      console.error('[run-agent:adminDb]', e);
      if (!res.headersSent) return res.status(500).json({ ok: false, error: 'adminDb: ' + (e?.message || String(e)) });
      return;
    }
  }
  if (action === 'factcheckStatus') return require('./_lib/factcheck-status')(req, res);
  if (req.query?.action === 'scoutSelect') {
    try {
      return await require('./_lib/scout-select')(req, res, createClient);
    } catch (e) {
      console.error('[run-agent:scoutSelect]', e);
      if (!res.headersSent) return res.status(500).json({ error: 'scoutSelect: ' + (e?.message || String(e)) });
      return;
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { agent, scout_token, edition_num } = req.body || {};

  if (!(agent === 'scout' && scout_token)) {
    if (!requireAdmin(req, res)) return;
  } else {
    // Auth alternativa: scout token dall'email (solo per ri-avviare lo Scout)
    const { data: pendingRow } = await supabase.from('agent_memory').select('value').eq('key', 'scout_pending').single();
    if (!pendingRow?.value?.selection_token || pendingRow.value.selection_token !== scout_token) {
      return res.status(401).json({ error: 'Token non valido o scaduto.' });
    }
  }
  if (!agent || !AGENT_MAP[agent]) {
    return res.status(400).json({ error: `Agente non valido. Disponibili: ${Object.keys(AGENT_MAP).join(', ')}` });
  }

  // Token GitHub solo da env var (mai da database).
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  if (!ghToken) {
    return res.status(500).json({ error: 'Token GitHub non configurato su Vercel.' });
  }

  const { workflow, label } = AGENT_MAP[agent];

  // Fact-check: parte per UNA edizione, quando si preme «Invia» (la Control Room lo chiede solo se il testo
  // è cambiato dall'ultimo controllo). Un secondo avvio per la stessa edizione entro 4 minuti non fa nulla.
  let inputs;
  if (agent === 'factcheck' && edition_num != null) {
    const n = String(edition_num).padStart(3, '0');
    if (!/^\d{3}$/.test(n)) return res.status(400).json({ error: 'edition_num non valido' });
    inputs = { edition_num: n };
    const since = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    const { data: recent } = await supabase.from('agent_runs').select('id')
      .eq('agent', 'factcheck').eq('status', 'triggered').gte('created_at', since).contains('data', { edition_num: n }).limit(1);
    if (recent && recent.length) return res.status(200).json({ ok: true, already: true, message: 'Fact-check già in corso per questa edizione.' });
  }

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${ghToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'valore-atteso'
      },
      body: JSON.stringify(inputs ? { ref: 'main', inputs } : { ref: 'main' })
    });

    if (r.status === 204) {
      await supabase.from('agent_runs').insert({
        agent, status: 'triggered',
        summary: `${label} avviato manualmente dalla Control Room`,
        data: { triggered_by: 'control_room', workflow, ...(inputs || {}) }
      });
      return res.status(200).json({ ok: true, message: `${label} avviato. Risultati tra 1-3 minuti.` });
    }

    const err = await r.json().catch(() => ({}));
    const hint = (r.status === 401 || r.status === 403)
      ? ' — il token GitHub (GITHUB_TOKEN su Vercel) è scaduto o senza permessi Actions: va rinnovato'
      : '';
    throw new Error(`GitHub ${r.status}: ${err.message || JSON.stringify(err)}${hint}`);

  } catch (e) {
    console.error('[run-agent]', e);
    // Lasciare traccia: prima i fallimenti restavano solo nei log di Vercel (1 ora di retention).
    try {
      await supabase.from('agent_runs').insert({
        agent, status: 'error',
        summary: `${label}: avvio non riuscito. ${String(e.message || e).slice(0, 300)}`,
        data: { triggered_by: 'control_room', workflow }
      });
    } catch (_) {}
    return res.status(500).json({ error: e.message });
  }
};
