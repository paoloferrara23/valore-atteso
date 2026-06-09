const { supabaseRequest } = require('./sponsor-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const token = req.headers['x-cr-token'];
    const expectedToken = process.env.CR_PASSWORD || 'valopro2025';
    if (token !== expectedToken) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const rows = await supabaseRequest(
      '/rest/v1/sponsor_requests?select=id,company,contact_name,email,format,notes,status,created_at,approved_at&order=created_at.desc&limit=100',
      { headers: { Accept: 'application/json' } }
    );

    return res.status(200).json({ ok: true, requests: rows || [] });
  } catch (error) {
    console.error('[list-sponsor-requests]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante il recupero delle richieste' });
  }
};
