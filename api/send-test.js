// api/send-test.js
const { createClient } = require('@supabase/supabase-js');
const { loadEditionSponsors } = require('../lib/sponsor-edition-data');
const { buildHtml } = require('../lib/build-html');
const { contentPreflight } = require('../lib/preflight');
const { provider, brevoRequest } = require('../lib/mailer');

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

    // Con eventuali duplicati (es. una bozza vuota con lo stesso num) scegli
    // in modo deterministico: prima l'edizione pubblicata, poi la più recente.
    const { data: editions, error } = await query
      .order('published', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error('Supabase: ' + error.message);
    if (!editions || !editions.length) throw new Error('Edizione non trovata');

    const edition = editions[0];

    // Controlli pre-invio: nel test NON bloccano (serve a Paolo per vedere la bozza),
    // ma vengono riportati in risposta così si sistemano prima dell'invio reale.
    const preflight = contentPreflight(edition);

    edition.sponsors = await loadEditionSponsors(supabase, edition.id);

    const toEmail = (process.env.APPROVAL_EMAIL || 'info@valoreatteso.com').trim();

    const html = buildHtml(edition)
      .replace('{{EMAIL}}', encodeURIComponent(toEmail))
      .replace('{{WEBVIEW_URL}}', `https://valoreatteso.com/archivio#${edition.num}`);

    const subject = `[TEST] #${edition.num} - ${edition.title}`;
    const from = 'Valore Atteso <info@valoreatteso.com>';

    // Piano B: se EMAIL_PROVIDER=brevo, invia il test via Brevo; altrimenti Resend.
    let sendId = null;
    if (provider() === 'brevo') {
      const r = await brevoRequest({ from, to: toEmail, subject, html });
      if (!r.ok) throw new Error(`Brevo ${r.status}: ${String(r.body || '').slice(0, 300)}`);
      sendId = 'brevo';
    } else {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_KEY}`,
        },
        body: JSON.stringify({ from, to: toEmail, subject, html }),
      });
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch(e) { throw new Error('Resend risposta non JSON: ' + raw.slice(0, 200)); }
      if (!response.ok) throw new Error('Resend ' + response.status + ': ' + (result.message || JSON.stringify(result)));
      sendId = result.id || null;
    }

    return res.status(200).json({
      ok: true,
      sent_to: toEmail,
      id: sendId,
      provider: provider(),
      sponsors: edition.sponsors.length,
      preflight: {
        can_send: preflight.can_send,
        blockers: preflight.blockers,
        warnings: preflight.warnings,
        issues: preflight.checks.filter(c => c.type !== 'ok'),
      },
    });

  } catch (err) {
    console.error('[send-test]', err);
    return res.status(500).json({ error: err.message });
  }
};
