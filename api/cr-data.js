// api/cr-data.js — Endpoint protetto per la Control Room
// Usa fetch nativo, nessuna dipendenza esterna

const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_KEY;
const CR_PWD = process.env.CR_PASSWORD || 'valopro2025';

async function supaGet(path) {
  const r = await fetch(SURL + path, {
    headers: { apikey: SKEY, Authorization: 'Bearer ' + SKEY }
  });
  const text = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + text.slice(0, 200));
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pwd, type } = req.body || {};
  if (pwd !== CR_PWD) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    if (type === 'subscribers') {
      const data = await supaGet('/rest/v1/subscribers?select=email,source,created_at,confirmed&order=created_at.desc');
      return res.status(200).json({ ok: true, data });
    }

    if (type === 'instagram_posts') {
      const data = await supaGet('/rest/v1/instagram_posts?order=post_num.desc&limit=20&select=*');
      return res.status(200).json({ ok: true, data });
    }

    if (type === 'edition_status') {
      const [pub, boz] = await Promise.all([
        supaGet('/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=num,title,date'),
        supaGet('/rest/v1/editions?published=eq.false&select=id')
      ]);
      return res.status(200).json({ ok: true, pub: pub[0] || null, bozze: boz.length });
    }

    return res.status(400).json({ error: 'Tipo non valido' });

  } catch (e) {
    console.error('[cr-data]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
