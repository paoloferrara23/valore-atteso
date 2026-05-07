export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_KEY || 're_8NSq3NEw_2SjYt5J4SiUw29AvEXcMzZHw';
  const SUPA_URL = 'https://xxnmkiwnjpppfzrftvuv.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bm1raXduanBwcGZ6cmZ0dnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MTkwNTUsImV4cCI6MjA5MTk5NTA1NX0.2EePZNm_OCc9WscYSG7CL_mbFV6E8ifwV9sP2WxkUo4';
  const SITE = 'https://valore-atteso.vercel.app';
  const FROM = 'Valore Atteso <info@valoreatteso.com>';

  const { email, action, token } = req.body || {};

  const emailFooter = (email) => `
    <tr>
      <td style="padding:14px 28px;border-top:1px solid #C8C4BB;text-align:center">
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#888480;margin:0 0 6px;letter-spacing:.04em">
          © 2025 Valore Atteso · <a href="${SITE}" style="color:#888480;text-decoration:none">valore-atteso.vercel.app</a>
        </p>
        <p style="font-family:'Courier New',monospace;font-size:8px;color:#aaa;margin:0;letter-spacing:.04em">
          <a href="${SITE}/cancella.html?email=${encodeURIComponent(email)}" style="color:#aaa;text-decoration:underline">Cancella iscrizione</a>
        </p>
      </td>
    </tr>`;

  // CONFERMA iscrizione
  if (action === 'conferma' && token) {
    const r = await fetch(`${SUPA_URL}/rest/v1/subscribers?token=eq.${token}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ confirmed: true, token: null })
    });
    const rows = await r.json();
    if (!r.ok || !rows?.length) return res.status(400).json({ error: 'Token non valido' });

    const userEmail = rows[0].email;

    // 1. Email di benvenuto
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: FROM,
        to: userEmail,
        subject: 'Benvenuto in Valore Atteso',
        html: `<table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif">
          <tr><td style="padding:24px 28px;border-bottom:2px solid #1A1A1A;text-align:center">
            <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
            <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.16em;text-transform:uppercase;margin:4px 0 0">Il calcio dei numeri, non dei goal</p>
          </td></tr>
          <tr><td style="padding:28px">
            <p style="font-family:Georgia,serif;font-size:15px;font-weight:300;color:#4A4845;line-height:1.75;margin:0 0 16px">Benvenuto.</p>
            <p style="font-family:Georgia,serif;font-size:15px;font-weight:300;color:#4A4845;line-height:1.75;margin:0 0 20px">Ogni martedì mattina riceverai un'analisi del business del calcio: un bilancio, un deal, una metrica in 8 minuti. Dati verificati, nessun gossip di mercato.</p>
            <p style="font-family:Georgia,serif;font-size:15px;font-weight:300;color:#4A4845;line-height:1.75;margin:0">Ti mando subito la prima edizione, così puoi capire di cosa parliamo.</p>
          </td></tr>
          ${emailFooter(userEmail)}
        </table>`
      })
    }).catch(e => console.error('Welcome email error:', e));

    // 2. Recupera ultima edizione pubblicata e la manda
    try {
      const edRes = await fetch(`${SUPA_URL}/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=*`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
      });
      const editions = await edRes.json();
      const edition = editions?.[0];

      if (edition && edition.sections?.length) {
        const secsHTML = edition.sections.map((s, i) => `
          <tr><td style="padding:0">
            <table width="100%" style="border-collapse:collapse">
              <tr><td style="padding:16px 24px 6px;background:#F5F2EB">
                <p style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.14em;text-transform:uppercase;margin:0">&#8212; 0${i+1} &middot; ${s.label}</p>
              </td></tr>
              <tr><td style="padding:6px 24px 12px;background:#F5F2EB;border-bottom:1px solid #D0CBC0">
                <h2 style="font-family:Georgia,serif;font-size:16px;font-weight:700;letter-spacing:-.3px;line-height:1.25;color:#1A1A1A;margin:0 0 10px">${s.title}</h2>
                <p style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.8;margin:0">${(s.body || '').replace(/\n/g, '<br>')}</p>
              </td></tr>
              ${s.kpis?.length ? `<tr><td style="padding:0;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
                <table width="100%" style="border-collapse:collapse;font-family:'Courier New',monospace;font-size:10px">
                  <tr style="background:#D0CBC0"><td colspan="2" style="padding:6px 24px;font-size:8px;color:#1A1A1A;letter-spacing:.08em;text-transform:uppercase;font-weight:500">Dati chiave</td></tr>
                  ${s.kpis.map((k,ki) => `<tr style="background:${ki%2===0?'#EDE9E0':'#E6E1D8'}"><td style="padding:7px 24px;color:#4A4845;font-size:10px">${k.key}</td><td style="padding:7px 24px;text-align:right;color:#1A1A1A;font-weight:700;font-size:11px">${k.value}</td></tr>`).join('')}
                </table>
              </td></tr>` : ''}
              <tr><td style="padding:10px 24px 18px;background:#F5F2EB;border-bottom:2px solid #D0CBC0">
                <p style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;margin:0;letter-spacing:.06em">&#8594; ${s.verdict}</p>
              </td></tr>
            </table>
          </td></tr>`).join('');

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({
            from: FROM,
            to: userEmail,
            subject: `Valore Atteso #${edition.num} — ${edition.title}`,
            html: `<table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
              <tr><td style="padding:24px 28px;border-bottom:3px solid #1A1A1A;text-align:center;background:#F5F2EB">
                <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.16em;text-transform:uppercase;margin:0 0 8px">${edition.date}</p>
                <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:900;letter-spacing:-1.5px;color:#1A1A1A;margin:0 0 4px;line-height:1">Valore Atteso</h1>
                <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.14em;text-transform:uppercase;margin:4px 0 0">Il calcio dei numeri, non dei goal &middot; Edizione #${edition.num}</p>
              </td></tr>
              ${edition.opener ? `<tr><td style="padding:16px 28px;background:#EDE9E0;border-bottom:1px solid #D0CBC0;border-left:3px solid #1A1A1A"><p style="font-family:Georgia,serif;font-size:14px;color:#4A4845;font-weight:300;line-height:1.8;font-style:italic;margin:0">${edition.opener}</p></td></tr>` : ''}
              <tr><td style="padding:0"><table width="100%" style="border-collapse:collapse">${secsHTML}</table></td></tr>
              <tr><td style="padding:24px 28px;text-align:center;border-top:2px solid #1A1A1A;background:#1A1A1A">
                <p style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.1em;text-transform:uppercase;margin:0 0 12px">Ogni martedì mattina &middot; Gratis &middot; 8 minuti</p>
                <a href="https://valoreatteso.com" style="background:#F5F2EB;color:#1A1A1A;padding:12px 28px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;display:inline-block;font-weight:500">Leggi sul sito &#8594;</a>
              </td></tr>
              <tr><td style="padding:14px 28px;border-top:1px solid #D0CBC0;text-align:center;background:#EDE9E0">
                <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0 0 4px">&copy; 2025 Valore Atteso &middot; <a href="https://valoreatteso.com" style="color:#9A9690;text-decoration:none">valoreatteso.com</a></p>
                <p style="font-family:'Courier New',monospace;font-size:8px;color:#C8C4BB;margin:0"><a href="https://valoreatteso.com/cancella.html?email=${encodeURIComponent(userEmail)}" style="color:#C8C4BB;text-decoration:underline">Cancella iscrizione</a></p>
              </td></tr>
            </table>`
          })
        }).catch(e => console.error('Edition email error:', e));
      }
    } catch(e) {
      console.error('Edition fetch error:', e);
    }

    return res.status(200).json({ ok: true });
  }

  // NUOVA ISCRIZIONE
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email non valida' });
  }

  const tok = crypto.randomUUID();

  const saveRes = await fetch(`${SUPA_URL}/rest/v1/subscribers?on_conflict=email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ email, token: tok, confirmed: false })
  });

  if (!saveRes.ok) {
    const err = await saveRes.text();
    return res.status(500).json({ error: 'Errore salvataggio: ' + err });
  }

  const mailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM,
      to: email,
      subject: 'Conferma la tua iscrizione a Valore Atteso',
      html: `<table width="560" style="max-width:560px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif">
        <tr><td style="padding:24px 28px;border-bottom:2px solid #1A1A1A;text-align:center">
          <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
          <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.16em;text-transform:uppercase;margin:4px 0 0">Il calcio dei numeri, non dei goal</p>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="font-family:Georgia,serif;font-size:15px;font-weight:300;color:#4A4845;line-height:1.75;margin:0 0 20px">Ciao, clicca il link qui sotto per completare l'iscrizione:</p>
          <table width="100%"><tr><td style="text-align:center;padding:8px 0 24px">
            <a href="${SITE}/conferma.html?token=${tok}&email=${encodeURIComponent(email)}" style="background:#C8251D;color:#fff;padding:14px 28px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Conferma iscrizione →</a>
          </td></tr></table>
          <p style="font-family:Georgia,serif;font-size:13px;font-weight:300;color:#888480;line-height:1.6;margin:0">Il link scade fra 7 giorni. Se non sei stato tu, ignora questa email.</p>
        </td></tr>
        ${emailFooter(email)}
      </table>`
    })
  });

  if (!mailRes.ok) {
    const mailErr = await mailRes.json();
    return res.status(502).json({ error: 'Errore email: ' + (mailErr.message || mailRes.status) });
  }

  return res.status(200).json({ ok: true });
}
