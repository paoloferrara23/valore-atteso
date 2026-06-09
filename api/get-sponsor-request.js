const { supabaseRequest } = require('./_sponsor-utils');

const ALLOWED_STATUSES = ['approved', 'pending_materials', 'paid', 'scheduled'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'Token richiesto' });

    const statusFilter = ALLOWED_STATUSES.map(encodeURIComponent).join(',');
    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?token=eq.${encodeURIComponent(token)}&status=in.(${statusFilter})&select=company,contact_name,format,status,scheduled_date`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Link non valido o richiesta non disponibile' });

    return res.status(200).json({ ok: true, request });
  } catch (error) {
    console.error('[get-sponsor-request]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante il recupero della richiesta' });
  }
};
