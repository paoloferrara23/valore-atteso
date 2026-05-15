// api/send-communication.js — Invia comunicazione one-shot agli iscritti
// Chiamato dalla Control Room tab Comunicazioni

const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function supaFetch(path, opts = {}) {
  const r = await fetch(SURL + path, {
    ...opts,
    headers: { apikey: SKEY, Authorization: 'Bearer ' + SKEY, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const text = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + text);
  return JSON.parse(text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject, body, tipo, segmento } = req.body || {};

  if (!subject || !body) return res.status(400).json({ error: 'subject e body obbligatori' });

  try {
    // Legge iscritti confermati
    let query = '/rest/v1/subscribers?confirmed=eq.true&select=email,created_at';
    if (segmento === 'ultimi30') {
      const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      query += '&created_at=gte.' + d30;
    }
    const subs = await supaFetch(query);
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0 });

    // Costruisce email HTML
    const oggi = new Date().toLocaleDateString('it-IT');
    const tipoLabel = { annuncio: 'Annuncio', ritardo: 'Avviso', speciale: 'Contenuto speciale', sondaggio: 'Sondaggio', altro: 'Comunicazione' }[tipo] || 'Comunicazione';

    const html = `<table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
      <tr><td style="padding:24px 28px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">${tipoLabel} · ${oggi}</div>
      </td></tr>
      <tr><td style="padding:28px 28px 20px">
        <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1A1A1A;margin:0 0 18px;letter-spacing:-.3px">${subject}</h2>
        <div style="font-family:Georgia,serif;font-size:16px;color:#4A4845;line-height:1.75;white-space:pre-wrap">${body.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0">
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">
          Hai ricevuto questa email perché sei iscritto a Valore Atteso.<br>
          Per cancellarti rispondi a questa email con oggetto "cancellami".
        </p>
      </td></tr>
    </table>`;

    // Invia in batch da 50
    let sent = 0;
    for (let i = 0; i < subs.length; i += 50) {
      const batch = subs.slice(i, i + 50);
      await Promise.all(batch.map(s =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
          body: JSON.stringify({ from: FROM, to: s.email, subject, html })
        })
      ));
      sent += batch.length;
    }

    return res.status(200).json({ ok: true, sent });

  } catch (e) {
    console.error('send-communication error:', e);
    return res.status(500).json({ error: e.message });
  }
}
