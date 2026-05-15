// api/send-communication.js — Invia comunicazione one-shot agli iscritti
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const resend = new Resend(process.env.RESEND_KEY);
const FROM = 'Valore Atteso <info@valoreatteso.com>';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject, body, tipo, segmento } = req.body || {};
  if (!subject || !body) return res.status(400).json({ error: 'subject e body obbligatori' });

  try {
    let query = supabase.from('subscribers').select('email, created_at').eq('confirmed', true);
    if (segmento === 'ultimi30') {
      const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      query = query.gte('created_at', d30);
    }
    const { data: subs, error } = await query;
    if (error) throw new Error(error.message);
    if (!subs || !subs.length) return res.status(200).json({ ok: true, sent: 0 });

    const oggi = new Date().toLocaleDateString('it-IT');
    const tipoLabel = { annuncio: 'Annuncio', ritardo: 'Avviso', speciale: 'Contenuto speciale', sondaggio: 'Sondaggio', altro: 'Comunicazione' }[tipo] || 'Comunicazione';
    const bodyEsc = String(body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `<table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
      <tr><td style="padding:24px 28px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">${tipoLabel} · ${oggi}</div>
      </td></tr>
      <tr><td style="padding:28px 28px 20px">
        <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1A1A1A;margin:0 0 18px">${String(subject).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</h2>
        <div style="font-family:Georgia,serif;font-size:16px;color:#4A4845;line-height:1.75;white-space:pre-wrap">${bodyEsc}</div>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0">
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">
          Hai ricevuto questa email perche sei iscritto a Valore Atteso.<br>
          Per cancellarti rispondi con oggetto "cancellami".
        </p>
      </td></tr>
    </table>`;

    let sent = 0;
    for (let i = 0; i < subs.length; i += 50) {
      const batch = subs.slice(i, i + 50);
      const results = await Promise.allSettled(
        batch.map(s => resend.emails.send({ from: FROM, to: s.email, subject, html }))
      );
      sent += results.filter(r => r.status === 'fulfilled').length;
    }

    return res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error('[send-communication]', e);
    return res.status(500).json({ error: e.message });
  }
};
