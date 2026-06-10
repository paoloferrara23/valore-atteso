// api/send-test.js
// CommonJS — Vercel serverless function

const { buildHtml } = require('./send-newsletter');
const { loadEditionSponsors } = require('../lib/sponsor-edition-data');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { edition_num, edition_id } = req.body;

    // Importiamo lo stesso buildHtml del file principale
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_KEY
    );

    const resend = new Resend(process.env.RESEND_KEY);

    let query = supabase
      .from('editions')
      .select('*');

    if (edition_id) {
      query = query.eq('id', edition_id);
    } else if (edition_num) {
      query = query.eq('num', String(edition_num).padStart(3, '0'));
    } else {
      return res.status(400).json({
        error: 'Parametro edition_num o edition_id obbligatorio'
      });
    }

    const { data: editions, error } = await query.limit(1);

    if (error) {
      throw new Error(error.message);
    }

    if (!editions || !editions.length) {
      throw new Error('Edizione non trovata');
    }

    const edition = editions[0];
    edition.sponsors = await loadEditionSponsors(supabase, edition.id);

    const html = buildHtml(edition)
      .replace('{{EMAIL}}', encodeURIComponent('info@valoreatteso.com'))
      .replace(
        '{{WEBVIEW_URL}}',
        `https://valoreatteso.com/archivio#${edition.num}`
      );

    const subject = `[TEST] #${edition.num} - ${edition.title}`;

    const result = await resend.emails.send({
      from: 'Valore Atteso <info@valoreatteso.com>',
      to: 'info@valoreatteso.com',
      subject,
      html,
    });

    return res.status(200).json({
      ok: true,
      sent: true,
      id: result.data?.id || null,
      sponsors: edition.sponsors.length,
    });

  } catch (err) {
    console.error('[send-test]', err);

    return res.status(500).json({
      error: err.message
    });
  }
};
