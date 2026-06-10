const {
  escapeHtml,
  parseJsonBody,
  sendGmail,
  supabaseRequest
} = require('./sponsor-utils');
const { buildSponsorPreviewHtml } = require('./sponsor-newsletter-preview');
const { TERMS_VERSION, recordAcceptance } = require('./sponsor-legal');

function isAdmin(req) {
  const token = req.headers['x-admin-secret'] || req.headers['x-cr-token'];
  return token === (process.env.SPONSOR_ADMIN_SECRET || process.env.CR_PASSWORD || 'valopro2025');
}

function privateUrl(req, token) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https';
  const siteUrl = process.env.SPONSOR_SITE_URL || `${protocol}://${req.headers.host}`;
  return `${siteUrl.replace(/\/$/, '')}/sponsor-area.html?token=${encodeURIComponent(token)}`;
}

async function getPreviewData({ requestId, token }) {
  const filter = requestId
    ? `id=eq.${encodeURIComponent(requestId)}`
    : `token=eq.${encodeURIComponent(token)}`;
  const rows = await supabaseRequest(
    `/rest/v1/sponsor_requests?${filter}&select=id,company,contact_name,email,token,slot_type,edition_id,payment_status,materials_status,sponsor_assets(logo_url,headline,body,cta_url)`,
    { headers: { Accept: 'application/json' } }
  );
  const request = rows && rows[0];
  if (!request) throw new Error('Richiesta non trovata');

  let editions = [];
  if (request.edition_id) {
    editions = await supabaseRequest(
      `/rest/v1/editions?id=eq.${encodeURIComponent(request.edition_id)}&select=*`,
      { headers: { Accept: 'application/json' } }
    );
  }
  if (!editions || !editions[0]) {
    editions = await supabaseRequest(
      '/rest/v1/editions?published=eq.true&select=*&order=created_at.desc&limit=1',
      { headers: { Accept: 'application/json' } }
    );
  }
  const edition = editions && editions[0];
  if (!edition) throw new Error('Nessuna edizione disponibile per la preview');

  const asset = Array.isArray(request.sponsor_assets)
    ? request.sponsor_assets[0]
    : request.sponsor_assets;
  if (!asset) throw new Error('Materiali sponsor non disponibili');

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

  edition.sponsors = [{
    company: request.company,
    slot_type: request.slot_type,
    asset: {
      ...asset,
      logo_signed_url: logoSignedUrl
    }
  }];

  return {
    request,
    edition,
    html: buildSponsorPreviewHtml(edition)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = parseJsonBody(req);
    const action = String(body.action || '').trim();

    if (action === 'accept_terms') {
      const token = String(body.token || '').trim();
      const accepted = body.terms === true
        && body.material_rights === true
        && body.privacy_read === true
        && body.specific_clauses === true;
      if (!token || !accepted) {
        return res.status(400).json({ ok: false, error: 'Tutte le accettazioni sono obbligatorie' });
      }
      const rows = await supabaseRequest(
        `/rest/v1/sponsor_requests?token=eq.${encodeURIComponent(token)}&select=id`,
        { headers: { Accept: 'application/json' } }
      );
      const request = rows && rows[0];
      if (!request) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });
      const acceptedAt = new Date().toISOString();
      await recordAcceptance(req, request.id, 'terms', {
        terms: true,
        material_rights: true,
        privacy_read: true,
        specific_clauses: true
      });
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          terms_version: TERMS_VERSION,
          terms_accepted_at: acceptedAt
        })
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'get_preview') {
      const token = String(body.token || '').trim();
      const requestId = String(body.request_id || '').trim();
      if (!token && (!requestId || !isAdmin(req))) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const preview = await getPreviewData({ requestId, token });
      return res.status(200).json({
        ok: true,
        html: preview.html,
        edition: {
          id: preview.edition.id,
          num: preview.edition.num,
          title: preview.edition.title,
          date: preview.edition.date
        },
        placement: preview.request.slot_type === 'main'
          ? 'Dopo l’apertura e prima de Il Bilancio'
          : 'Dopo le sezioni e prima de La Tesi'
      });
    }

    if (action === 'approve_preview') {
      const token = String(body.token || '').trim();
      if (!token) return res.status(400).json({ ok: false, error: 'Token richiesto' });
      const rows = await supabaseRequest(
        `/rest/v1/sponsor_requests?token=eq.${encodeURIComponent(token)}&preview_status=eq.sent&select=id,company,terms_accepted_at`,
        { headers: { Accept: 'application/json' } }
      );
      const request = rows && rows[0];
      if (!request) return res.status(404).json({ ok: false, error: 'Preview non disponibile' });
      if (!request.terms_accepted_at || body.publication_authorized !== true) {
        return res.status(400).json({ ok: false, error: 'Autorizzazione alla pubblicazione obbligatoria' });
      }
      const authorizedAt = new Date().toISOString();
      await recordAcceptance(req, request.id, 'publication', {
        publication_authorized: true,
        preview_approved: true
      });
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          preview_status: 'approved',
          preview_approved_at: authorizedAt,
          publication_authorized_at: authorizedAt
        })
      });
      try {
        await sendGmail({
          to: 'info@valoreatteso.com',
          subject: `Preview sponsor approvata da ${request.company}`,
          html: `<p style="font-family:Arial,sans-serif">La preview sponsor di <strong>${escapeHtml(request.company)}</strong> è stata approvata.</p>`
        });
      } catch (emailError) {
        console.error('[manage-sponsor-editorial][approval-notification]', emailError);
      }
      return res.status(200).json({ ok: true });
    }

    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const requestId = String(body.request_id || '').trim();
    if (!requestId) return res.status(400).json({ ok: false, error: 'request_id richiesto' });

    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}&select=id,company,contact_name,email,token,status,materials_status,payment_status,edition_id,preview_status,terms_accepted_at`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });

    if (action === 'assign_edition') {
      const editionId = String(body.edition_id || '').trim();
      if (!editionId) return res.status(400).json({ ok: false, error: 'Seleziona un edizione' });
      const editions = await supabaseRequest(
        `/rest/v1/editions?id=eq.${encodeURIComponent(editionId)}&select=id,num,title,date`,
        { headers: { Accept: 'application/json' } }
      );
      if (!editions || !editions[0]) {
        return res.status(404).json({ ok: false, error: 'Edizione non trovata' });
      }
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          edition_id: editionId,
          preview_status: 'draft',
          preview_sent_at: null,
          preview_approved_at: null
        })
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'send_preview') {
      if (!request.terms_accepted_at) {
        return res.status(409).json({ ok: false, error: 'Condizioni di sponsorizzazione non accettate' });
      }
      if (request.payment_status !== 'received' || request.materials_status !== 'approved') {
        return res.status(409).json({ ok: false, error: 'Pagamento o materiali non approvati' });
      }
      await getPreviewData({ requestId: request.id });
      const url = privateUrl(req, request.token);
      await sendGmail({
        to: request.email,
        subject: 'Preview sponsorizzazione - Valore Atteso',
        html: `
          <div style="font-family:Arial,sans-serif;color:#1C1914;line-height:1.6">
            <h2>La preview è pronta</h2>
            <p>Ciao ${escapeHtml(request.contact_name)},</p>
            <p>puoi vedere come apparirà la sponsorizzazione di <strong>${escapeHtml(request.company)}</strong> e approvarla dal link privato:</p>
            <p><a href="${url}" style="display:inline-block;background:#1C1914;color:#F0EBE1;padding:12px 20px;border-radius:24px;text-decoration:none">Apri e approva la preview</a></p>
          </div>
        `
      });
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          preview_status: 'sent',
          preview_sent_at: new Date().toISOString(),
          preview_approved_at: null
        })
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Azione non valida' });
  } catch (error) {
    console.error('[manage-sponsor-editorial]', error);
    return res.status(500).json({ ok: false, error: 'Errore nella gestione editoriale sponsor' });
  }
};
