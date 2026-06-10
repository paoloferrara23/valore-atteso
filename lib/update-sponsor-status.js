const {
  escapeHtml,
  parseJsonBody,
  sendGmail,
  supabaseRequest
} = require('./sponsor-utils');
const { issueMagicToken } = require('./sponsor-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const token = req.headers['x-admin-secret'] || req.headers['x-cr-token'];
  const expected = process.env.SPONSOR_ADMIN_SECRET || process.env.CR_PASSWORD || 'valopro2025';
  if (token !== expected) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    const body = parseJsonBody(req);
    const requestId = String(body.request_id || '').trim();
    const action = String(body.action || '').trim();
    if (!requestId || !['mark_paid', 'schedule'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'Azione non valida' });
    }
    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}&select=id,company,contact_name,email,status,selected_slot_id,materials_status,payment_status,terms_accepted_at`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });
    if (!request.selected_slot_id) {
      return res.status(409).json({ ok: false, error: 'Nessuno slot selezionato' });
    }
    if (!request.terms_accepted_at) {
      return res.status(409).json({ ok: false, error: 'Condizioni di sponsorizzazione non accettate' });
    }

    if (action === 'mark_paid') {
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'pending_materials',
          payment_status: 'received',
          paid_at: new Date().toISOString()
        })
      });
      const forwardedProto = req.headers['x-forwarded-proto'];
      const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https';
      const siteUrl = process.env.SPONSOR_SITE_URL || `${protocol}://${req.headers.host}`;
      const magicToken = await issueMagicToken(request.id);
      const privateUrl = `${siteUrl.replace(/\/$/, '')}/sponsor-area.html?token=${encodeURIComponent(magicToken)}`;
      await sendGmail({
        to: request.email,
        subject: 'Pagamento sponsor confermato - Valore Atteso',
        html: `
          <div style="font-family:Arial,sans-serif;color:#1C1914;line-height:1.6">
            <h2>Area materiali sbloccata</h2>
            <p>Ciao ${escapeHtml(request.contact_name)},</p>
            <p>abbiamo registrato manualmente il pagamento per <strong>${escapeHtml(request.company)}</strong>.</p>
            <p>Ora puoi caricare logo, testo e link nella tua area privata:</p>
            <p><a href="${privateUrl}">Apri l'area sponsor</a></p>
          </div>
        `
      });
    } else {
      if (request.payment_status !== 'received' || request.materials_status !== 'approved') {
        return res.status(409).json({ ok: false, error: 'Pagamento o materiali non ancora approvati' });
      }
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'scheduled' })
      });
      await supabaseRequest(`/rest/v1/sponsor_slots?id=eq.${encodeURIComponent(request.selected_slot_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'booked' })
      });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[update-sponsor-status]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante l aggiornamento dello stato' });
  }
};
