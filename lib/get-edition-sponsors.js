const { supabaseRequest } = require('./sponsor-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const editionId = String(req.query.edition_id || '').trim();
    if (!editionId) return res.status(400).json({ ok: false, error: 'edition_id richiesto' });
    const editions = await supabaseRequest(
      `/rest/v1/editions?id=eq.${encodeURIComponent(editionId)}&published=eq.true&select=id`,
      { headers: { Accept: 'application/json' } }
    );
    if (!editions || !editions[0]) {
      return res.status(404).json({ ok: false, error: 'Edizione non disponibile' });
    }
    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?edition_id=eq.${encodeURIComponent(editionId)}&preview_status=eq.approved&payment_status=eq.received&materials_status=eq.approved&select=company,slot_type,sponsor_assets(logo_url,headline,body,cta_url)`,
      { headers: { Accept: 'application/json' } }
    );
    const sponsors = await Promise.all((rows || []).map(async (request) => {
      const asset = Array.isArray(request.sponsor_assets)
        ? request.sponsor_assets[0]
        : request.sponsor_assets;
      if (!asset) return null;
      let logoSignedUrl = null;
      if (asset.logo_url) {
        const signed = await supabaseRequest(
          `/storage/v1/object/sign/sponsor-assets/${asset.logo_url}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiresIn: 3600 })
          }
        );
        logoSignedUrl = signed && signed.signedURL
          ? `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1${signed.signedURL}`
          : null;
      }
      return {
        company: request.company,
        slot_type: request.slot_type,
        asset: {
          headline: asset.headline,
          body: asset.body,
          cta_url: asset.cta_url,
          logo_signed_url: logoSignedUrl
        }
      };
    }));
    return res.status(200).json({ ok: true, sponsors: sponsors.filter(Boolean) });
  } catch (error) {
    console.error('[get-edition-sponsors]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante il recupero degli sponsor' });
  }
};
