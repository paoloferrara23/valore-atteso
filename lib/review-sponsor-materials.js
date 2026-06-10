const {
  escapeHtml,
  parseJsonBody,
  sendGmail,
  supabaseRequest
} = require('./sponsor-utils');

function adminAuthorized(req) {
  const token = req.headers['x-admin-secret'] || req.headers['x-cr-token'];
  return token === (process.env.SPONSOR_ADMIN_SECRET || process.env.CR_PASSWORD || 'valopro2025');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!adminAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const body = parseJsonBody(req);
    const requestId = String(body.request_id || '').trim();
    const decision = String(body.decision || '').trim();
    const message = String(body.message || '').trim();
    if (!requestId || !['approve', 'changes'].includes(decision)) {
      return res.status(400).json({ ok: false, error: 'Dati revisione non validi' });
    }
    if (decision === 'changes' && !message) {
      return res.status(400).json({ ok: false, error: 'Indica le modifiche richieste' });
    }

    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}&select=id,company,contact_name,email,token,status,payment_status`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });
    if (request.payment_status !== 'received') {
      return res.status(409).json({ ok: false, error: 'Pagamento non ancora confermato' });
    }

    const assets = await supabaseRequest(
      `/rest/v1/sponsor_assets?request_id=eq.${encodeURIComponent(request.id)}&select=id`,
      { headers: { Accept: 'application/json' } }
    );
    if (!assets || !assets.length) {
      return res.status(409).json({ ok: false, error: 'Materiali non ancora caricati' });
    }

    if (decision === 'approve') {
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'materials_approved',
          materials_status: 'approved',
          materials_approved_at: new Date().toISOString()
        })
      });
      await sendGmail({
        to: request.email,
        subject: 'Materiali sponsor approvati - Valore Atteso',
        html: `
          <div style="font-family:Arial,sans-serif;color:#1C1914;line-height:1.6">
            <h2>Materiali approvati</h2>
            <p>Ciao ${escapeHtml(request.contact_name)},</p>
            <p>i materiali di <strong>${escapeHtml(request.company)}</strong> sono stati approvati.</p>
            <p>La disponibilità selezionata resta riservata. Le istruzioni per il bonifico saranno gestite separatamente dal team di Valore Atteso.</p>
            <p>Nessuna pubblicazione partirà senza conferma finale.</p>
          </div>
        `
      });
    } else {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https';
      const siteUrl = process.env.SPONSOR_SITE_URL || `${protocol}://${req.headers.host}`;
      const privateUrl = `${siteUrl.replace(/\/$/, '')}/sponsor-area.html?token=${encodeURIComponent(request.token)}`;
      await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'materials_changes_requested',
          materials_status: 'changes_requested',
          materials_approved_at: null,
          preview_status: 'draft',
          preview_sent_at: null,
          preview_approved_at: null
        })
      });
      await sendGmail({
        to: request.email,
        subject: 'Modifiche materiali sponsor - Valore Atteso',
        html: `
          <div style="font-family:Arial,sans-serif;color:#1C1914;line-height:1.6">
            <h2>Modifiche richieste</h2>
            <p>Ciao ${escapeHtml(request.contact_name)},</p>
            <p>prima di approvare i materiali chiediamo questa modifica:</p>
            <p style="padding:14px;background:#F0EBE1">${escapeHtml(message)}</p>
            <p><a href="${privateUrl}">Aggiorna i materiali nell'area sponsor</a></p>
          </div>
        `
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[review-sponsor-materials]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante la revisione dei materiali' });
  }
};
