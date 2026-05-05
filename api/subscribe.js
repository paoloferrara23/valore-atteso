const RESEND_KEY = 're_8NSq3NEw_2SjYt5J4SiUw29AvEXcMzZHw';
const SUPA_URL = 'https://xxnmkiwnjpppfzrftvuv.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bm1raXduanBwcGZ6cmZ0dnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MTkwNTUsImV4cCI6MjA5MTk5NTA1NX0.2EePZNm_OCc9WscYSG7CL_mbFV6E8ifwV9sP2WxkUo4';
const SITE = 'https://valore-atteso.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, action, token } = req.body;

  // CONFERMA
  if (action === 'conferma' && token) {
    const r = await fetch(`${SUPA_URL}/rest/v1/subscribers?token=eq.${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=representation' },
      body: JSON.stringify({ confirmed: true, token: null }),
    });
    const rows = await r.json();
    if (!r.ok || !rows?.length) return res.status(400).json({ error: 'Token non valido' });

    // Email benvenuto
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Valore Atteso <onboarding@resend.dev>',
        to: rows[0].email,
        subject: 'Benvenuto in Valore Atteso',
        html: `<table width="600" style="max-width:600px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif"><tr><td style="padding:24px 32px;border-bottom:2px solid #111010;text-align:center"><h1 style="font-size:32px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1><p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.18em;text-transform:uppercase;margin:6px 0 0">Il calcio dei numeri, non dei gol</p></td></tr><tr><td style="padding:32px"><p style="font-size:16px;font-weight:300;color:#3D3C39;line-height:1.7;margin:0 0 16px">Benvenuto.</p><p style="font-size:16px;font-weight:300;color:#3D3C39;line-height:1.7;margin:0 0 16px">Ogni martedì mattina riceverai un'analisi del business del calcio — un bilancio, un deal, una metrica — in 8 minuti.</p><p style="font-size:16px;font-weight:300;color:#3D3C39;line-height:1.7;margin:0 0 24px">Niente gossip di mercato. Solo dati verificati e ragionamento finanziario applicato al pallone.</p><table width="100%"><tr><td style="text-align:center;padding:8px 0 24px"><a href="${SITE}" style="background:#111010;color:#F7F4EE;padding:14px 28px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Leggi l'ultima edizione →</a></td></tr></table></td></tr><tr><td style="padding:16px 32px;border-top:1px solid #C8C4BB"><p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0">© 2025 Valore Atteso</p></td></tr></table>`
      })
    });
    return res.status(200).json({ ok: true });
  }

  // ISCRIZIONE
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email non valida' });

  const tok = crypto.randomUUID();

  // Salva su Supabase
  await fetch(`${SUPA_URL}/rest/v1/subscribers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ email, token: tok, confirmed: false }),
  });

  // Invia email conferma
  const mr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Valore Atteso <onboarding@resend.dev>',
      to: email,
      subject: 'Conferma la tua iscrizione a Valore Atteso',
      html: `<table width="600" style="max-width:600px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif"><tr><td style="padding:24px 32px;border-bottom:2px solid #111010;text-align:center"><h1 style="font-size:32px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1><p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;letter-spacing:.18em;text-transform:uppercase;margin:6px 0 0">Il calcio dei numeri, non dei gol</p></td></tr><tr><td style="padding:32px"><p style="font-size:16px;font-weight:300;color:#3D3C39;line-height:1.7;margin:0 0 20px">Ciao,</p><p style="font-size:16px;font-weight:300;color:#3D3C39;line-height:1.7;margin:0 0 24px">Per completare l'iscrizione clicca il link qui sotto:</p><table width="100%"><tr><td style="text-align:center;padding:8px 0 24px"><a href="${SITE}/conferma.html?token=${tok}&email=${encodeURIComponent(email)}" style="background:#111010;color:#F7F4EE;padding:14px 28px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Conferma iscrizione →</a></td></tr></table><p style="font-size:13px;font-weight:300;color:#888480;line-height:1.6;margin:0">Il link scade fra 7 giorni. Se non sei stato tu, ignora questa email.</p></td></tr><tr><td style="padding:16px 32px;border-top:1px solid #C8C4BB"><p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0">© 2025 Valore Atteso</p></td></tr></table>`
    })
  });

  if (!mr.ok) {
    const err = await mr.json();
    return res.status(502).json({ error: err.message || 'Errore invio email' });
  }

  return res.status(200).json({ ok: true });
}
