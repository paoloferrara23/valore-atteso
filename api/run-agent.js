// api/run-agent.js — Esegui agente manualmente dalla Control Room
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const AGENT_MAP = {
  scout:       { script: 'scout.js',        label: 'Scout' },
  seo:         { script: 'seo-agent.js',    label: 'SEO Agent' },
  editoriale:  { script: 'agent.js',        label: 'Editoriale Agent' },
  growth:      { script: 'growth-agent.js', label: 'Growth Agent' },
  content:     { script: 'content-agent.js',label: 'Content Agent' },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  if (req.headers['x-cr-token'] !== CR_TOKEN) return res.status(401).json({ error: 'Non autorizzato' });

  const { agent } = req.body || {};
  if (!agent || !AGENT_MAP[agent]) {
    return res.status(400).json({ error: `Agente non valido. Disponibili: ${Object.keys(AGENT_MAP).join(', ')}` });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'paoloferrara23/valore-atteso';

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN non configurato' });
  }

  // Mappa agente → nome workflow
  const WORKFLOW_MAP = {
    scout:      'scout.yml',
    seo:        'seo-agent.yml',
    editoriale: 'editoriale-agent.yml',
    growth:     'growth-agent.yml',
    content:    'content-agent.yml',
  };

  const workflow = WORKFLOW_MAP[agent];

  try {
    // Triggera workflow via GitHub API
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'valore-atteso'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (r.status === 204) {
      // Logga il run manuale
      await supabase.from('agent_runs').insert({
        agent,
        status: 'triggered',
        summary: `${AGENT_MAP[agent].label} avviato manualmente dalla Control Room`,
        data: { triggered_by: 'control_room', workflow }
      });

      return res.status(200).json({
        ok: true,
        message: `${AGENT_MAP[agent].label} avviato. Risultati visibili tra 1-2 minuti.`
      });
    }

    const err = await r.json();
    throw new Error(`GitHub: ${r.status} — ${err.message || JSON.stringify(err)}`);

  } catch (e) {
    console.error('[run-agent]', e);
    return res.status(500).json({ error: e.message });
  }
};
