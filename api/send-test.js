// api/send-test.js
const { buildHtml } = require('./send-newsletter');
const { loadEditionSponsors } = require('../lib/sponsor-edition-data');
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { edition_num, edition_id } = req.body;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
    );

    let query = supabase.from('editions').select('*');
    if (edition_id) {
      query = query.eq('id', edition_id);
    } else if (edition_num) {
      query = query.eq('num', String(edition_num).padStart(3, '0'));
    } else {
      return res.status(400).json({ error: 'Parametro edition_num o edition_id obbligatorio' });
    }

    const { data: editions, error } = await query.limit(1);
    if (error) throw new Error('Supabase: ' + error.message);
    if (!editions || !editions.length) throw new Error('Edizione non trovata');

    const edition = editions[0];
    edition.sponsors = await loadEditionSponsors(supabase, edition.id);

    const toEmail = (process.env.APPROVAL_EMAIL || 'info@valoreatteso.com').trim();

    const html = buildHtml(edition)
      .replace('{{EMAIL}}', encodeURIComponent(toEmail))
      .replace('{{WEBVIEW_URL}}', `https://valoreatteso.com/archivio#${edition.num}`);

    const subject = `[TEST] #${edition.num} - ${edition.title}`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_KEY}`,
      },
      body: JSON.stringify({
        from: 'Valore Atteso <info@valoreatteso.com>',
        to: toEmail,
        subject,
        html,
      }),
    });

    const raw = await response.text();
    let result;
    try { result = JSON.parse(raw); } catch(e) { throw new Error('Resend: ' + raw.slice(0, 200)); }
    if (!response.ok) throw new Error('Resend ' + response.status + ': ' + (result.message || JSON.stringify(result)));

    return res.status(200).json({
      ok: true,
      sent_to: toEmail,
      id: result.id || null,
      sponsors: edition.sponsors.length,
    });

  } catch (err) {
    console.error('[send-test]', err);
    return res.status(500).json({ error: err.message });
  }
};
