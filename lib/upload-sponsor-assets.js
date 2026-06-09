const path = require('path');
const {
  escapeHtml,
  parseJsonBody,
  sendGmail,
  supabaseHeaders,
  supabaseRequest
} = require('./sponsor-utils');

const ALLOWED_STATUSES = ['approved', 'pending_materials', 'paid', 'scheduled'];
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function hasValidImageSignature(buffer, mimeType) {
  if (mimeType === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3
      && buffer[0] === 0xff
      && buffer[1] === 0xd8
      && buffer[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = parseJsonBody(req);
    const token = String(body.token || '').trim();
    const headline = String(body.headline || '').trim();
    const sponsorBody = String(body.body || '').trim();
    const ctaUrl = String(body.cta_url || '').trim();
    const logoType = String(body.logo_type || '').toLowerCase();
    const logoName = path.basename(String(body.logo_name || 'logo'));
    const logoData = String(body.logo_data || '');

    if (!token || !headline || !sponsorBody || !ctaUrl || !logoData) {
      return res.status(400).json({ ok: false, error: 'Tutti i campi sono obbligatori' });
    }
    try {
      new URL(ctaUrl);
    } catch (_) {
      return res.status(400).json({ ok: false, error: 'CTA URL non valido' });
    }
    if (!ALLOWED_MIME.includes(logoType)) {
      return res.status(400).json({ ok: false, error: 'Formato logo non supportato' });
    }

    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?token=eq.${encodeURIComponent(token)}&select=id,company,status`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request || !ALLOWED_STATUSES.includes(request.status)) {
      return res.status(404).json({ ok: false, error: 'Link non valido o richiesta non disponibile' });
    }

    const base64 = logoData.includes(',') ? logoData.split(',').pop() : logoData;
    const logoBuffer = Buffer.from(base64, 'base64');
    if (!logoBuffer.length || logoBuffer.length > MAX_LOGO_BYTES) {
      return res.status(400).json({ ok: false, error: 'Il logo deve avere dimensione massima di 2 MB' });
    }
    if (!hasValidImageSignature(logoBuffer, logoType)) {
      return res.status(400).json({ ok: false, error: 'Il contenuto del logo non corrisponde al formato dichiarato' });
    }

    const extByMime = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp'
    };
    const extension = extByMime[logoType] || path.extname(logoName).toLowerCase();
    const storagePath = `${request.id}/logo-${Date.now()}${extension}`;
    const storageUrl = `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/sponsor-assets/${storagePath}`;
    const uploadResponse = await fetch(storageUrl, {
      method: 'POST',
      headers: supabaseHeaders({
        'Content-Type': logoType,
        'x-upsert': 'true'
      }),
      body: logoBuffer
    });
    if (!uploadResponse.ok) {
      throw new Error(`Storage ${uploadResponse.status}: ${await uploadResponse.text()}`);
    }

    await supabaseRequest('/rest/v1/sponsor_assets?on_conflict=request_id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        request_id: request.id,
        logo_url: storagePath,
        headline,
        body: sponsorBody,
        cta_url: ctaUrl,
        uploaded_at: new Date().toISOString()
      })
    });

    await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ status: 'materials_uploaded' })
    });

    try {
      await sendGmail({
        to: 'info@valoreatteso.com',
        subject: `Materiali sponsor caricati da ${request.company}`,
        html: `<p style="font-family:Arial,sans-serif">Materiali sponsor caricati da <strong>${escapeHtml(request.company)}</strong>.</p>`
      });
    } catch (emailError) {
      console.error('[upload-sponsor-assets][notification]', emailError);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[upload-sponsor-assets]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante il caricamento dei materiali' });
  }
};
