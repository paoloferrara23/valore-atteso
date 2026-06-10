const { supabaseRequest } = require('./sponsor-utils');
const { TERMS_VERSION } = require('./sponsor-legal');

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
      '/rest/v1/sponsor_requests?select=id,company,contact_name,email,format,notes,status,created_at,approved_at,paid_at,scheduled_date,amount,slot_type,selected_slot_id,materials_status,materials_approved_at,payment_status,edition_id,preview_status,preview_sent_at,preview_approved_at,terms_version,terms_accepted_at,publication_authorized_at,editions(id,num,title,date,published),sponsor_assets(id,logo_url,headline,body,cta_url,uploaded_at)&order=created_at.desc&limit=100',
      { headers: { Accept: 'application/json' } }
    );

    const requests = await Promise.all((rows || []).map(async (request) => {
      const asset = Array.isArray(request.sponsor_assets)
        ? request.sponsor_assets[0]
        : request.sponsor_assets;
      if (!asset || !asset.logo_url) return request;
      try {
        const signed = await supabaseRequest(
          `/storage/v1/object/sign/sponsor-assets/${asset.logo_url}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiresIn: 3600 })
          }
        );
        asset.logo_signed_url = signed && signed.signedURL
          ? `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1${signed.signedURL}`
          : null;
      } catch (signError) {
        console.error('[list-sponsor-requests][signed-url]', signError);
      }
      return request;
    }));

    const editions = await supabaseRequest(
      '/rest/v1/editions?select=id,num,title,date,published,sent_count&published=eq.false&order=created_at.desc&limit=20',
      { headers: { Accept: 'application/json' } }
    );
    return res.status(200).json({
      ok: true,
      requests,
      editions: editions || [],
      terms_version: TERMS_VERSION
    });
  } catch (error) {
    console.error('[list-sponsor-requests]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante il recupero delle richieste' });
  }
};
