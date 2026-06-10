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

  try {
    const adminSecret = req.headers['x-admin-secret'] || req.headers['x-cr-token'];
    const expectedSecret = process.env.SPONSOR_ADMIN_SECRET
      || process.env.CR_PASSWORD
      || 'valopro2025';
    if (adminSecret !== expectedSecret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const { request_id: requestId } = parseJsonBody(req);
    if (!requestId) return res.status(400).json({ ok: false, error: 'request_id richiesto' });

    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}&select=id,company,contact_name,email,format`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });

    await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        status: 'approved',
        approved_at: new Date().toISOString(),
        payment_status: 'not_requested',
        materials_status: 'pending'
      })
    });

    const token = await issueMagicToken(request.id);
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https';
    const siteUrl = process.env.SPONSOR_SITE_URL || `${protocol}://${req.headers.host}`;
    const privateUrl = `${siteUrl.replace(/\/$/, '')}/sponsor-area.html?token=${encodeURIComponent(token)}`;
    await sendGmail({
      to: request.email,
      subject: 'Richiesta sponsor approvata - Valore Atteso',
      html: `
        <div style="font-family:Arial,sans-serif;color:#1C1914;line-height:1.6">
          <h2>Richiesta approvata</h2>
          <p>Ciao ${escapeHtml(request.contact_name)},</p>
          <p>la richiesta sponsor di <strong>${escapeHtml(request.company)}</strong> è stata approvata.</p>
          <p>Dal link privato qui sotto puoi confrontare gli slot disponibili, scegliere la data e vedere il riepilogo economico:</p>
          <p><a href="${privateUrl}" style="display:inline-block;background:#1C1914;color:#F0EBE1;padding:12px 20px;border-radius:24px;text-decoration:none">Scegli slot e data</a></p>
          <p>Il link è monouso e scade dopo 14 giorni. Dopo il primo accesso, questo dispositivo resterà autorizzato per 14 giorni.</p>
          <p>Dopo la scelta dello slot potrai caricare i materiali e ricevere una preview. Le opzioni di pagamento saranno mostrate nell'area privata solo dopo la tua approvazione della preview.</p>
          <p>Nessun pagamento o pubblicazione parte automaticamente.</p>
        </div>
      `
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[approve-sponsor]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante l approvazione' });
  }
};
