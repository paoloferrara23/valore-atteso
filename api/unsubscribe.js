// api/unsubscribe.js — Con token sicuro
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SITE = process.env.SITE_URL || 'https://valoreatteso.com';

  // Supporta GET (link email) e POST (da cancella.html)
  const token = req.method === 'GET' ? req.query?.token : req.body?.token;
  const emailDirect = req.method === 'GET' ? req.query?.email : req.body?.email;

  try {
    let email = null;

    if (token) {
      // ── Disiscrizione con token sicuro (nuovo metodo) ──────────────────
      const { data } = await supabase
        .from('subscribers')
        .select('email')
        .eq('unsub_token', token)
        .single();

      if (!data?.email) {
        if (req.method === 'GET') return res.redirect(302, `${SITE}/cancella.html?error=token_invalido`);
        return res.status(400).json({ error: 'Link non valido o già utilizzato' });
      }
      email = data.email;

    } else if (emailDirect && emailDirect.includes('@')) {
      // ── Fallback: email diretta (solo per iscritti esistenti con vecchio formato) ──
      // Verifica che l'email esista prima di disiscrivere
      const { data } = await supabase.from('subscribers').select('email,confirmed').eq('email', emailDirect).single();
      if (!data) {
        if (req.method === 'GET') return res.redirect(302, `${SITE}/cancella.html?error=non_trovato`);
        return res.status(404).json({ error: 'Email non trovata' });
      }
      email = emailDirect;
    } else {
      return res.status(400).json({ error: 'Token o email obbligatori' });
    }

    // Disiscrivi e invalida il token
    await supabase.from('subscribers')
      .update({ confirmed: false, unsub_token: null })
      .eq('email', email);

    await supabase.from('agent_runs').insert({
      agent: 'unsubscribe', status: 'success',
      summary: `Iscritto cancellato: ${email}`,
      data: { email, method: token ? 'token' : 'email' }
    }).catch(() => {});

    if (req.method === 'GET') return res.redirect(302, `${SITE}/cancella.html?done=1`);
    return res.status(200).json({ ok: true });

  } catch(e) {
    console.error('[unsubscribe]', e);
    return res.status(500).json({ error: e.message });
  }
};
