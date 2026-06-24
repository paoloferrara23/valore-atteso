// api/run-agent.js — Esegui agente manualmente dalla Control Room
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const AGENT_MAP = {
  scout:      { workflow: 'scout.yml',             label: 'Scout' },
  seo:        { workflow: 'seo-agent.yml',          label: 'SEO Agent' },
  editoriale: { workflow: 'editoriale-agent.yml',   label: 'Editoriale Agent' },
  growth:     { workflow: 'growth-agent.yml',       label: 'Growth Agent' },
  content:    { workflow: 'content-agent.yml',      label: 'Content Agent' },
  'sponsor-outreach': { workflow: 'sponsor-outreach.yml', label: 'Sponsor Outreach' },
};

const REPO = 'paoloferrara23/valore-atteso';

module.exports = async function handler(req, res) {
  // Le deleghe sono protette: se il modulo delegato lancia in fase di load
  // (o di esecuzione async), restituiamo un JSON con l'errore reale invece
  // di lasciare crashare la function — che produrrebbe la pagina HTML
  // "A server error has occurred" e un JSON.parse fallito lato Control Room.
  if (req.query?.action === 'scoutSelect') {
    try {
      return await require('../lib/scout-select')(req, res);
    } catch (e) {
      console.error('[run-agent:scoutSelect]', e);
      if (!res.headersSent) return res.status(500).json({ error: 'scoutSelect: ' + (e?.message || String(e)) });
      return;
    }
  }
  if (req.query?.action === 'bilanci') {
    try {
      return await require('../lib/bilanci-approval')(req, res);
    } catch (e) {
      console.error('[run-agent:bilanci]', e);
      if (!res.headersSent) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cr-token');
        return res.status(500).json({ error: 'bilanci: ' + (e?.message || String(e)) });
      }
      return;
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  const { agent, scout_token } = req.body || {};

  if (req.headers['x-cr-token'] !== CR_TOKEN) {
    // Auth alternativa: scout token dall'email (solo per ri-avviare lo Scout)
    if (agent === 'scout' && scout_token) {
      const { data: pendingRow } = await supabase.from('agent_memory').select('value').eq('key', 'scout_pending').single();
      if (!pendingRow?.value?.selection_token || pendingRow.value.selection_token !== scout_token) {
        return res.status(401).json({ error: 'Token non valido o scaduto.' });
      }
    } else {
      return res.status(401).json({ error: 'Non autorizzato' });
    }
  }
  if (!agent || !AGENT_MAP[agent]) {
    return res.status(400).json({ error: `Agente non valido. Disponibili: ${Object.keys(AGENT_MAP).join(', ')}` });
  }

  // Leggi GH token da env var (aggiunta via setup-env) oppure da Supabase config
  let ghToken = process.env.GH_TOKEN;

  if (!ghToken) {
    try {
      const { data } = await supabase
        .from('agent_memory')
        .select('value')
        .eq('key', 'config_gh_token')
        .single();
      ghToken = data?.value;
    } catch(e) { /* ignore */ }
  }

  if (!ghToken) {
    return res.status(500).json({ error: 'GH_TOKEN non configurato. Contatta l\'amministratore.' });
  }

  const { workflow, label } = AGENT_MAP[agent];

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${ghToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'valore-atteso'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (r.status === 204) {
      await supabase.from('agent_runs').insert({
        agent, status: 'triggered',
        summary: `${label} avviato manualmente dalla Control Room`,
        data: { triggered_by: 'control_room', workflow }
      });
      return res.status(200).json({ ok: true, message: `${label} avviato. Risultati tra 1-3 minuti.` });
    }

    const err = await r.json();
    throw new Error(`GitHub ${r.status}: ${err.message || JSON.stringify(err)}`);

  } catch (e) {
    console.error('[run-agent]', e);
    return res.status(500).json({ error: e.message });
  }
};
