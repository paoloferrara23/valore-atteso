// api/subscribe.js — Con rate limiting per IP
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Rate limiting: max 3 iscrizioni per IP per ora ───────────────────────────
async function checkRateLimit(ip) {
  if (!ip) return true; // se non c'è IP, lascia passare
  try {
    const ora = new Date().toISOString();
    const un_ora_fa = new Date(Date.now() - 3600000).toISOString();

    const { data, error } = await supabase
      .from('rate_limits')
      .select('count')
      .eq('ip', ip)
      .eq('action', 'subscribe')
      .gte('created_at', un_ora_fa)
      .single();

    const count = data?.count || 0;
    if (count >= 3) return false; // bloccato

    // Aggiorna o crea record
    await supabase.from('rate_limits').upsert({
      ip, action: 'subscribe',
      count: count + 1,
      created_at: ora
    }, { onConflict: 'ip,action' });

    return true;
  } catch(e) {
    return true; // in caso di errore DB, lascia passare
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_KEY;
  const SITE = process.env.SITE_URL || 'https://valoreatteso.com';
  const FROM = 'Valore Atteso <info@valoreatteso.com>';
  const { email, action, token } = req.body || {};

  // ── CONFERMA ISCRIZIONE ─────────────────────────────────────────────────
  if (action === 'conferma' && token) {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscribers?token=eq.${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_KEY}`, 'Prefer': 'return=representation' },
      body: JSON.stringify({ confirmed: true, token: null })
    });
    const rows = await r.json();
    if (!r.ok || !rows?.length) return res.status(400).json({ error: 'Token non valido' });

    const userEmail = rows[0].email;

    // Genera token disiscrizione sicuro
    const unsubToken = Buffer.from(`${userEmail}:${Date.now()}`).toString('base64url');
    await supabase.from('subscribers').update({ unsub_token: unsubToken }).eq('email', userEmail);

    const welcomeHtml = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#D8D0C4">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#D8D0C4"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#F0EBE1">
  <tr><td style="background:#1C1914;padding:7px 28px"><table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.45)">Benvenuto in Valore Atteso</td>
    <td align="right" style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.4)">Valore Atteso</td>
  </tr></table></td></tr>
  <tr><td style="background:#F0EBE1;padding:18px 28px 16px;border-bottom:3px solid #1C1914">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="width:34px;height:34px;border:2px solid #1C1914;text-align:center;vertical-align:middle;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#1C1914">VA</td>
      <td style="padding-left:14px">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-1px;color:#1C1914">VALORE ATTESO</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;margin-top:2px">Il calcio dei numeri, non dei goal.</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="#1C1914" style="background:#1C1914;padding:32px 28px 28px">
    <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#8E6B33;text-transform:uppercase;margin-bottom:12px">— Benvenuto</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:900;color:#FFFDF8;line-height:1.1;letter-spacing:-1px;margin:0 0 16px">Analisi, non rumore.</h1>
    <p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,235,225,0.75);font-weight:300;line-height:1.85;margin:0 0 14px">Ogni martedì mattina trovi nella tua inbox un bilancio analizzato, un deal sezionato e una metrica spiegata. In 8 minuti, con il caffè, prima di una riunione.</p>
    <p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,235,225,0.75);font-weight:300;line-height:1.85;margin:0 0 26px">Esplora le analisi già pubblicate nell'archivio.</p>
    <!--[if mso]><table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#C8A97A" style="background:#C8A97A;padding:12px 28px;"><![endif]--><a href="${SITE}/archivio.html" bgcolor="#C8A97A" style="display:inline-block;background:#C8A97A;color:#1C1914;font-family:'Courier New',monospace;font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:12px 28px;text-decoration:none;mso-padding-alt:12px 28px;">Vai all'archivio →</a><!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
  <tr><td style="background:#E7DFD2;border-top:3px solid #1C1914;padding:16px 28px;text-align:center">
    <p style="font-family:'Courier New',monospace;font-size:8.5px;color:#9A9690;margin:0">Per cancellarti <a href="${SITE}/api/unsubscribe?token=${unsubToken}" style="color:#777066">clicca qui</a>.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from: FROM, to: userEmail, subject: 'Benvenuto in Valore Atteso', html: welcomeHtml })
    });

    return res.status(200).json({ ok: true });
  }

  // ── NUOVA ISCRIZIONE ────────────────────────────────────────────────────
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email non valida' });

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || '';
  const allowed = await checkRateLimit(ip);
  if (!allowed) return res.status(429).json({ error: 'Troppi tentativi. Riprova tra un\'ora.' });

  const existing = await supabase.from('subscribers').select('email,confirmed,token').eq('email', email).single();

  if (existing.data?.confirmed) return res.status(200).json({ ok: true, already: true });

  const tok = existing.data?.token || crypto.randomUUID();

  if (existing.data) {
    if (!existing.data.token) await supabase.from('subscribers').update({ token: tok }).eq('email', email);
  } else {
    const ins = await supabase.from('subscribers').insert({ email, token: tok, confirmed: false });
    if (ins.error) return res.status(500).json({ error: ins.error.message });
  }

  const confirmHtml = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#D8D0C4">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#D8D0C4"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#F0EBE1">
  <tr><td style="background:#F0EBE1;padding:18px 28px 16px;border-bottom:3px solid #1C1914">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="width:34px;height:34px;border:2px solid #1C1914;text-align:center;vertical-align:middle;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#1C1914">VA</td>
      <td style="padding-left:14px">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-1px;color:#1C1914">VALORE ATTESO</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;margin-top:2px">Il calcio dei numeri, non dei goal.</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="#1C1914" style="background:#1C1914;padding:32px 28px">
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#FFFDF8;margin:0 0 16px">Conferma la tua iscrizione</h1>
    <p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,235,225,0.75);font-weight:300;line-height:1.85;margin:0 0 24px">Clicca il pulsante qui sotto per completare l'iscrizione a Valore Atteso.</p>
    <!--[if mso]><table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#C8A97A" style="background:#C8A97A;padding:12px 28px;"><![endif]--><a href="${SITE}/conferma.html?token=${tok}&email=${encodeURIComponent(email)}" bgcolor="#C8A97A" style="display:inline-block;background:#C8A97A;color:#1C1914;font-family:'Courier New',monospace;font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:12px 28px;text-decoration:none;mso-padding-alt:12px 28px;">Conferma iscrizione →</a><!--[if mso]></td></tr></table><![endif]-->
    <p style="font-family:Georgia,serif;font-size:12px;color:rgba(240,235,225,0.35);margin:20px 0 0">Il link scade fra 7 giorni.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

  const mailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: email, subject: 'Conferma la tua iscrizione a Valore Atteso', html: confirmHtml })
  });

  if (!mailRes.ok) { const err = await mailRes.json(); return res.status(502).json({ error: 'Errore email: ' + (err.message || mailRes.status) }); }
  return res.status(200).json({ ok: true });
};
