const crypto = require('crypto');
const {
  escapeHtml,
  parseJsonBody,
  sendGmail,
  supabaseRequest
} = require('../lib/sponsor-utils');
const approveSponsor = require('../lib/approve-sponsor');
const getSponsorRequest = require('../lib/get-sponsor-request');
const listSponsorRequests = require('../lib/list-sponsor-requests');
const uploadSponsorAssets = require('../lib/upload-sponsor-assets');

const SPONSOR_ACTIONS = {
  approve: approveSponsor,
  get: getSponsorRequest,
  list: listSponsorRequests,
  upload: uploadSponsorAssets
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  const action = String((req.query && req.query.action) || '');
  if (SPONSOR_ACTIONS[action]) {
    return SPONSOR_ACTIONS[action](req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { name, company, email, format, notes } = parseJsonBody(req);
    const clean = {
      contact_name: String(name || '').trim(),
      company: String(company || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      format: String(format || '').trim(),
      notes: String(notes || '').trim()
    };

    if (!clean.contact_name || !clean.company || !clean.format || !EMAIL_RE.test(clean.email)) {
      return res.status(400).json({ ok: false, error: 'Controlla i campi obbligatori' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await supabaseRequest('/rest/v1/sponsor_requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        ...clean,
        name: clean.contact_name,
        status: 'new',
        token
      })
    });

    await sendGmail({
      to: 'info@valoreatteso.com',
      replyTo: clean.email,
      subject: `Nuova richiesta sponsor - ${clean.company}`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#1C1914">
          <h2>Nuova richiesta sponsor</h2>
          <p><strong>Azienda:</strong> ${escapeHtml(clean.company)}</p>
          <p><strong>Contatto:</strong> ${escapeHtml(clean.contact_name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(clean.email)}</p>
          <p><strong>Formato:</strong> ${escapeHtml(clean.format)}</p>
          <p><strong>Note:</strong><br>${escapeHtml(clean.notes || 'Nessuna nota')}</p>
          <p>La richiesta deve essere approvata manualmente prima di contattare lo sponsor.</p>
        </div>
      `
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[sponsor-request]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante la gestione della richiesta' });
  }
};
