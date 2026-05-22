// api/unsubscribe.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Supporta sia GET (link diretto) che POST (da cancella.html)
  const email = req.method === 'GET'
    ? req.query?.email
    : req.body?.email;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email non valida' });
  }

  try {
    const { error } = await supabase
      .from('subscribers')
      .update({ confirmed: false })
      .eq('email', email);

    if (error) throw new Error(error.message);

    await supabase.from('agent_runs').insert({
      agent: 'unsubscribe',
      status: 'success',
      summary: `Iscritto cancellato: ${email}`,
      data: { email },
    }).catch(() => {});

    // Se GET, reindirizza a cancella.html con conferma
    if (req.method === 'GET') {
      return res.redirect(302, `/cancella.html?email=${encodeURIComponent(email)}&done=1`);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[unsubscribe]', e);
    return res.status(500).json({ error: e.message });
  }
};
