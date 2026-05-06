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

  const { email, action, token } = req.body || {};

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

    // Email benvenuto
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Valore Atteso <onboarding@resend.dev>',
        to: rows[0].email,
        subject: 'Benvenuto in Valore Atteso',
        html: `<table width="560" style="max-width:560px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif"><tr><td style="padding:24px 28px;border-bottom:2px solid #111010;text-align:center"><h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1><p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.16em;text-transform:uppercase;margin:4px 0 0">Il calcio dei numeri, non dei goal</p></td></tr><tr><td style="padding:28px"><p style="font-family:Georgia,serif;font-size:15px;font-weight:300;color:#3D3C39;line-height:1.75;margin:0 0 16px">Benvenuto.</p><p style="font-family:Georgia,serif;font-size:15px;font-weight:300;color:#3D3C39;line-height:1.75;margin:0 0 20px">Ogni martedì mattina riceverai un'analisi del business del calcio — un bilancio, un deal, una metrica — in 8 minuti. Dati verificati, nessun gossip di mercato.</p><a href="${SITE}" style="background:#111010;color:#F7F4EE;padding:12px 24px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Leggi la prima edizione →</a></td></tr><tr><td style="padding:14px 28px;border-top:1px solid #C8C4BB"><p style="font-family:'Courier New',monospace;font-size:8px;color:#888480;margin:0">© 2025 Valore Atteso · <a href="${SITE}" style="color:#888480">valore-atteso.vercel.app</a></p></td></tr></table>`
      })
    }).catch(e => console.error('Welcome email error:', e));

    return res.status(200).json({ ok: true });
  }

  // NUOVA ISCRIZIONE
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email non valida' });
  }

  const tok = crypto.randomUUID();

  // Prima elimina eventuale record esistente non confermato
  await fetch(`${SUPA_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&confirmed=eq.false`, {
    method: 'DELETE',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  }).catch(() => {});

  // Salva su Supabase con token
  const saveRes = await fetch(`${SUPA_URL}/rest/v1/subscribers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ email, token: tok, confirmed: false })
  });

  if (!saveRes.ok) {
    const err = await saveRes.text();
    return res.status(500).json({ error: 'Errore salvataggio: ' + err });
  }

  // Invia email di conferma
  const mailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Valore Atteso <onboarding@resend.dev>',
      to: email,
      subject: 'Conferma la tua iscrizione a Valore Atteso',
      html: `<table width="560" style="max-width:560px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif"><tr><td style="padding:24px 28px;border-bottom:2px solid #111010;text-align:center"><h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1><p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.16em;text-transform:uppercase;margin:4px 0 0">Il calcio dei numeri, non dei goal</p></td></tr><tr><td style="padding:28px"><p style="font-family:Georgia,serif;font-size:15px;font-weight:300;color:#3D3C39;line-height:1.75;margin:0 0 20px">Ciao, clicca il link qui sotto per completare l'iscrizione:</p><table width="100%"><tr><td style="text-align:center;padding:8px 0 24px"><a href="${SITE}/conferma.html?token=${tok}&email=${encodeURIComponent(email)}" style="background:#111010;color:#F7F4EE;padding:14px 28px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Conferma iscrizione →</a></td></tr></table><p style="font-family:Georgia,serif;font-size:13px;font-weight:300;color:#888480;line-height:1.6;margin:0">Il link scade fra 7 giorni. Se non sei stato tu, ignora questa email.</p></td></tr><tr><td style="padding:14px 28px;border-top:1px solid #C8C4BB"><p style="font-family:'Courier New',monospace;font-size:8px;color:#888480;margin:0">© 2025 Valore Atteso</p></td></tr></table>`
    })
  });

  if (!mailRes.ok) {
    const mailErr = await mailRes.json();
    return res.status(502).json({ error: 'Errore email: ' + (mailErr.message || mailRes.status) });
  }

  return res.status(200).json({ ok: true });
}
