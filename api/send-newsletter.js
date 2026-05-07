export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_KEY || 're_8NSq3NEw_2SjYt5J4SiUw29AvEXcMzZHw';
  const SUPA_URL = 'https://xxnmkiwnjpppfzrftvuv.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bm1raXduanBwcGZ6cmZ0dnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MTkwNTUsImV4cCI6MjA5MTk5NTA1NX0.2EePZNm_OCc9WscYSG7CL_mbFV6E8ifwV9sP2WxkUo4';
  const SITE = 'https://valoreatteso.com';
  const FROM = 'Valore Atteso <info@valoreatteso.com>';

  const { edition_id, edition_num } = req.body || {};

  if (!edition_id && !edition_num) {
    return res.status(400).json({ error: 'Specifica edition_id o edition_num' });
  }

  try {
    // 1. Recupera edizione
    const query = edition_id
      ? `id=eq.${edition_id}`
      : `num=eq.${edition_num}`;

    const edRes = await fetch(`${SUPA_URL}/rest/v1/editions?${query}&published=eq.true&select=*`, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    });
    const editions = await edRes.json();
    const edition = editions?.[0];

    if (!edition) {
      return res.status(404).json({ error: 'Edizione non trovata o non pubblicata' });
    }

    // 2. Recupera iscritti confermati
    const subRes = await fetch(`${SUPA_URL}/rest/v1/subscribers?confirmed=eq.true&select=email`, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    });
    const subscribers = await subRes.json();

    if (!subscribers?.length) {
      return res.status(200).json({ ok: true, sent: 0, message: 'Nessun iscritto confermato' });
    }

    // 3. Costruisci HTML email
    const secsHTML = (edition.sections || []).map((s, i) => `
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #D0CBC0">
          <p style="font-family:'Courier New',monospace;font-size:8px;color:#C8251D;letter-spacing:.12em;text-transform:uppercase;margin:0 0 4px">0${i+1} · ${s.label}</p>
          <h3 style="font-family:Georgia,serif;font-size:14px;font-weight:700;margin:0 0 6px;letter-spacing:-.2px">${s.title}</h3>
          <p style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.75;margin:0 0 8px">${(s.body || '').replace(/\n/g, '<br>')}</p>
          ${s.kpis?.length ? `
          <table width="100%" style="border-collapse:collapse;font-family:'Courier New',monospace;font-size:10px;background:#EDE9E0;margin-bottom:8px">
            ${s.kpis.map(k => `<tr><td style="padding:4px 10px;color:#9A9690">${k.key}</td><td style="padding:4px 10px;text-align:right;color:#1A1A1A;font-weight:500">${k.value}</td></tr>`).join('')}
          </table>` : ''}
          <p style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;margin:0">→ ${s.verdict}</p>
        </td>
      </tr>`).join('');

    const buildHtml = (email) => `
      <table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif">
        <tr><td style="padding:20px 24px;border-bottom:2px solid #1A1A1A;text-align:center">
          <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
          <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.14em;text-transform:uppercase;margin:3px 0 0">Edizione #${edition.num} · ${edition.date}</p>
        </td></tr>
        ${edition.opener ? `
        <tr><td style="padding:14px 20px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
          <p style="font-family:Georgia,serif;font-size:14px;color:#4A4845;font-weight:300;line-height:1.75;font-style:italic;margin:0">${edition.opener}</p>
        </td></tr>` : ''}
        <table width="100%" style="border-collapse:collapse">${secsHTML}</table>
        <tr><td style="padding:20px 24px;text-align:center;border-top:2px solid #1A1A1A">
          <a href="${SITE}" style="background:#1A1A1A;color:#F5F2EB;padding:12px 24px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Leggi sul sito →</a>
        </td></tr>
        <tr><td style="padding:12px 20px;border-top:1px solid #D0CBC0;text-align:center">
          <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">
            © 2025 Valore Atteso · <a href="${SITE}" style="color:#9A9690;text-decoration:none">valoreatteso.com</a>
          </p>
          <p style="font-family:'Courier New',monospace;font-size:8px;color:#bbb;margin:4px 0 0">
            <a href="${SITE}/cancella.html?email=${encodeURIComponent(email)}" style="color:#bbb;text-decoration:underline">Cancella iscrizione</a>
          </p>
        </td></tr>
      </table>`;

    // 4. Invia in batch (Resend batch API — max 100 per chiamata)
    const BATCH_SIZE = 100;
    let sent = 0;
    let errors = 0;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);

      const batchPayload = batch.map(sub => ({
        from: FROM,
        to: sub.email,
        subject: `Valore Atteso #${edition.num} — ${edition.title}`,
        html: buildHtml(sub.email)
      }));

      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_KEY}`
        },
        body: JSON.stringify(batchPayload)
      });

      if (r.ok) {
        sent += batch.length;
      } else {
        const err = await r.json();
        console.error('Batch error:', err);
        errors += batch.length;
      }
    }

    // 5. Aggiorna edizione come inviata
    await fetch(`${SUPA_URL}/rest/v1/editions?id=eq.${edition.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`
      },
      body: JSON.stringify({ sent_at: new Date().toISOString(), sent_count: sent })
    });

    return res.status(200).json({
      ok: true,
      sent,
      errors,
      edition: `#${edition.num} — ${edition.title}`,
      total_subscribers: subscribers.length
    });

  } catch (e) {
    console.error('send-newsletter error:', e);
    return res.status(500).json({ error: e.message });
  }
}
