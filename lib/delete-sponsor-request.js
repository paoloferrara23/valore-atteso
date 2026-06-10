const {
  parseJsonBody,
  supabaseHeaders,
  supabaseRequest
} = require('./sponsor-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const token = req.headers['x-admin-secret'] || req.headers['x-cr-token'];
  const expected = process.env.SPONSOR_ADMIN_SECRET || process.env.CR_PASSWORD || 'valopro2025';
  if (token !== expected) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    const { request_id: requestId } = parseJsonBody(req);
    if (!requestId) return res.status(400).json({ ok: false, error: 'request_id richiesto' });
    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}&select=id,selected_slot_id,sponsor_assets(logo_url)`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });

    const asset = Array.isArray(request.sponsor_assets)
      ? request.sponsor_assets[0]
      : request.sponsor_assets;
    if (asset && asset.logo_url) {
      const storageUrl = `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/sponsor-assets/${asset.logo_url}`;
      const storageResponse = await fetch(storageUrl, {
        method: 'DELETE',
        headers: supabaseHeaders()
      });
      if (!storageResponse.ok && storageResponse.status !== 404) {
        throw new Error(`Storage ${storageResponse.status}: ${await storageResponse.text()}`);
      }
    }

    if (request.selected_slot_id) {
      await supabaseRequest(`/rest/v1/sponsor_slots?id=eq.${encodeURIComponent(request.selected_slot_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'available', request_id: null })
      });
    }
    await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[delete-sponsor-request]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante l eliminazione della richiesta' });
  }
};
