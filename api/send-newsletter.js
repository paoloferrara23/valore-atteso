export const config = { maxDuration: 60 };

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
        <td style="padding:0">
          <!-- sezione header -->
          <table width="100%" style="border-collapse:collapse">
            <tr>
              <td style="padding:16px 24px 0;background:#F5F2EB">
                <table width="100%" style="border-collapse:collapse"><tr>
                  <td width="28" style="border-bottom:1px solid #C8251D;vertical-align:bottom;padding-bottom:4px">&nbsp;</td>
                  <td style="padding-left:10px;vertical-align:bottom;padding-bottom:4px">
                    <span style="font-family:Georgia,serif;font-size:10px;color:#C8251D;letter-spacing:.12em;text-transform:uppercase;font-style:italic">0${i+1} &middot; ${s.label}</span>
                  </td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 24px 12px;background:#F5F2EB;border-bottom:1px solid #D0CBC0">
                <h2 style="font-family:Georgia,serif;font-size:16px;font-weight:700;letter-spacing:-.3px;line-height:1.25;color:#1A1A1A;margin:0 0 10px">${s.title}</h2>
                <p style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.8;margin:0">${(s.body || '').replace(/
/g, '<br>')}</p>
              </td>
            </tr>
            ${s.kpis?.length ? `
            <tr>
              <td style="padding:0;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
                <table width="100%" style="border-collapse:collapse;font-family:'Courier New',monospace;font-size:10px">
                  <tr style="background:#D0CBC0">
                    <td colspan="2" style="padding:6px 24px;font-size:8px;color:#1A1A1A;letter-spacing:.08em;text-transform:uppercase;font-weight:500">Dati chiave</td>
                  </tr>
                  ${s.kpis.map((k,ki) => `<tr style="background:${ki%2===0?'#F5F2EB':'#EDE9E0'}">
                    <td style="padding:7px 24px;color:#4A4845;font-size:10px;border-right:1px solid #D0CBC0">${k.key}</td>
                    <td style="padding:7px 24px;text-align:right;color:#1A1A1A;font-weight:900;font-size:12px;letter-spacing:-.3px">${k.value}</td>
                  </tr>`).join('')}
                </table>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding:10px 24px 18px;background:#F5F2EB;border-bottom:2px solid #D0CBC0">
                <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.12em;text-transform:uppercase;margin:0 0 3px">Il verdetto</p>
                <p style="font-family:Georgia,serif;font-size:13px;color:#C8251D;margin:0 0 10px;font-style:italic">&#8594; ${s.verdict}</p>
                ${s.sources?.length ? `<div style="padding:8px 12px;background:#EDE9E0;border-left:2px solid #D0CBC0">
                  <span style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.1em;text-transform:uppercase">Fonti: </span>
                  <span style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690">${s.sources.join(' · ')}</span>
                </div>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`).join('');

    const buildHtml = (email) => `
      <!DOCTYPE html><html lang="it"><head><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light only}body{background-color:#F5F2EB!important}@media(prefers-color-scheme:dark){body,table,td,div,p,h1,h2,h3,span{background-color:#F5F2EB!important;color:#1A1A1A!important}.dk{background-color:#1A1A1A!important}.dk *{color:#ffffff!important}.dk p{color:#ffffff!important}}</style></head><body style="margin:0;padding:16px 0;background:#F5F2EB"><table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
        <!-- HEADER -->
        <tr>
          <td class="dk" style="padding:28px 32px;border-bottom:3px solid #D4A017;text-align:center;background:#1A1A1A">
            <p style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.16em;text-transform:uppercase;margin:0 0 10px">${edition.date} &middot; Edizione #${edition.num}</p>
            <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:900;letter-spacing:-1.5px;color:#ffffff;margin:0 0 6px;line-height:1">Valore Atteso</h1>
            <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.45);letter-spacing:.1em;text-transform:uppercase;margin:0">Il calcio dei numeri, non dei goal</p>
          </td>
        </tr>
        <!-- OPENER -->
        ${edition.opener ? `
        <tr>
          <td style="padding:16px 28px;background:#EDE9E0;border-bottom:1px solid #D0CBC0;border-left:3px solid #1A1A1A">
            <p style="font-family:Georgia,serif;font-size:14px;color:#4A4845;font-weight:300;line-height:1.8;font-style:italic;margin:0">${edition.opener}</p>
          </td>
        </tr>` : ''}
        <!-- SEZIONI -->
        <tr><td style="padding:0"><table width="100%" style="border-collapse:collapse">${secsHTML}</table></td></tr>
        <!-- CTA -->
        <tr>
          <td class="dk" style="padding:28px 32px;text-align:center;border-top:3px solid #D4A017;background:#1A1A1A">
            <a href="${SITE}" style="background:#D4A017;color:#1A1A1A;padding:14px 32px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;display:inline-block;font-weight:700">Leggi sul sito &#8594;</a>
            <p style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin:12px 0 0">Ogni martedì mattina &middot; Gratis &middot; 8 minuti</p>
          </td>
        </tr>
        <!-- FOOTER -->
        <tr>
          <td style="padding:14px 28px;border-top:1px solid #D0CBC0;text-align:center;background:#EDE9E0">
            <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0 0 4px;letter-spacing:.04em">
              &copy; ${new Date().getFullYear()} Valore Atteso &middot; <a href="${SITE}" style="color:#9A9690;text-decoration:none">valoreatteso.com</a>
            </p>
            <p style="font-family:'Courier New',monospace;font-size:8px;color:#C8C4BB;margin:0">
              <a href="${SITE}/cancella.html?email=${encodeURIComponent(email)}" style="color:#C8C4BB;text-decoration:underline">Cancella iscrizione</a>
            </p>
          </td>
        </tr>
      </table></body></html>`;

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
