// api/trigger-content.js
// Chiamato da crSalvaModifiche dopo salvataggio bozza
// Lancia il Content Agent via GitHub Actions workflow_dispatch

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'paoloferrara23/valore-atteso';
const WORKFLOW_ID = 'content-agent.yml';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  if (req.headers['x-cr-token'] !== CR_TOKEN) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: 'main' })
      }
    );

    if (r.status === 204) {
      return res.status(200).json({ ok: true, message: 'Content Agent avviato' });
    } else {
      const err = await r.text();
      return res.status(500).json({ error: `GitHub ${r.status}: ${err.slice(0, 200)}` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
