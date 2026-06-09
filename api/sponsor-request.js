const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_KEY);

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  try {
    const {
      name,
      company,
      email,
      format,
      notes
    } = req.body || {};

    if (!name || !company || !email || !format) {
      return res.status(400).json({
        ok: false,
        error: 'Campi obbligatori mancanti'
      });
    }

    await resend.emails.send({
      from: 'Valore Atteso <info@valoreatteso.com>',
      to: 'info@valoreatteso.com',
      reply_to: email,
      subject: `Nuova richiesta sponsorizzazione — ${company}`,
      html: `
        <div style="font-family:Arial,sans-serif;background:#F0EBE1;padding:28px;color:#1C1914">
          <h2 style="margin:0 0 18px">Nuova richiesta sponsorizzazione</h2>

          <p><strong>Nome:</strong> ${esc(name)}</p>
          <p><strong>Azienda:</strong> ${esc(company)}</p>
          <p><strong>Email:</strong> ${esc(email)}</p>
          <p><strong>Formato:</strong> ${esc(format)}</p>

          <p><strong>Note:</strong></p>
          <p style="white-space:pre-line">${esc(notes || 'Nessuna nota')}</p>
        </div>
      `
    });

    return res.status(200).json({
      ok: true
    });

  } catch (err) {
    console.error('[sponsor-request]', err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};
