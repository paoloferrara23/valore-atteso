const crypto = require('crypto');
const {
  escapeHtml,
  parseJsonBody,
  sendGmail,
  supabaseRequest
} = require('./_sponsor-utils');

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
      `/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}&select=id,company,contact_name,email,format,token`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Richiesta non trovata' });

    const token = request.token || crypto.randomBytes(32).toString('hex');
    await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        status: 'approved',
        token,
        approved_at: new Date().toISOString()
      })
    });

    const privateUrl = `https://valoreatteso.com/sponsor-area.html?token=${encodeURIComponent(token)}`;
    await sendGmail({
      to: request.email,
      subject: 'Richiesta sponsor approvata - Valore Atteso',
      html: `
        <div style="font-family:Arial,sans-serif;color:#1C1914;line-height:1.6">
          <h2>Richiesta approvata</h2>
          <p>Ciao ${escapeHtml(request.contact_name)},</p>
          <p>la richiesta sponsor di <strong>${escapeHtml(request.company)}</strong> è stata approvata.</p>
          <p>Dal link privato qui sotto puoi caricare logo, headline, testo sponsor e URL della call to action:</p>
          <p><a href="${privateUrl}" style="display:inline-block;background:#1C1914;color:#F0EBE1;padding:12px 20px;border-radius:24px;text-decoration:none">Carica i materiali</a></p>
          <p>Il caricamento dei materiali non avvia alcun pagamento o pubblicazione automatica. Ogni passaggio resta soggetto ad approvazione manuale.</p>
        </div>
      `
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[approve-sponsor]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante l approvazione' });
  }
};
