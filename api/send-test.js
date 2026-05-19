// api/send-test.js — Invia email di test a un singolo indirizzo
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const resend = new Resend(process.env.RESEND_KEY);

// Importa buildHtml da send-newsletter
const { buildHtml } = require('./send-newsletter');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { edition_num, test_email } = req.body;
    if (!edition_num) return res.status(400).json({ error: 'edition_num obbligatorio' });

    const to = test_email || process.env.APPROVAL_EMAIL || 'info@valoreatteso.com';

    const { data: editions, error } = await supabase
      .from('editions')
      .select('*')
      .eq('num', String(edition_num).padStart(3, '0'))
      .limit(1);

    if (error) throw new Error(error.message);
    if (!editions?.length) throw new Error('Edizione non trovata');
    const edition = editions[0];

    const html = buildHtml(edition)
      .replace('{{EMAIL}}', encodeURIComponent(to))
      .replace('{{WEBVIEW_URL}}', `https://valoreatteso.com/archivio#${edition.num}`);

    await resend.emails.send({
      from: 'Valore Atteso <info@valoreatteso.com>',
      to,
      subject: `[TEST] #${edition.num} — ${edition.title}`,
      html,
    });

    return res.status(200).json({ ok: true, sent_to: to });
  } catch (e) {
    console.error('[send-test]', e);
    return res.status(500).json({ error: e.message });
  }
};
