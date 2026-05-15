// api/cr-data.js — Endpoint protetto per la Control Room
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const CR_PWD = process.env.CR_PASSWORD || 'valopro2025';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pwd, type } = req.body || {};
  if (pwd !== CR_PWD) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    if (type === 'subscribers') {
      const { data, error } = await supabase
        .from('subscribers')
        .select('email, source, created_at, confirmed')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, data: data || [] });
    }

    if (type === 'instagram_posts') {
      const { data, error } = await supabase
        .from('instagram_posts')
        .select('*')
        .order('post_num', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, data: data || [] });
    }

    if (type === 'edition_status') {
      const [pubRes, bozRes] = await Promise.all([
        supabase.from('editions').select('num, title, date').eq('published', true).order('num', { ascending: false }).limit(1),
        supabase.from('editions').select('id').eq('published', false)
      ]);
      if (pubRes.error) throw new Error(pubRes.error.message);
      if (bozRes.error) throw new Error(bozRes.error.message);
      return res.status(200).json({
        ok: true,
        pub: pubRes.data?.[0] || null,
        bozze: bozRes.data?.length || 0
      });
    }

    return res.status(400).json({ error: 'Tipo non valido' });

  } catch (e) {
    console.error('[cr-data]', e);
    return res.status(500).json({ error: e.message });
  }
};
