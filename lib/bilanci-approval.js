// lib/bilanci-approval.js — Approvazione bozze bilanci (Control Room)
// Delegato da api/run-agent.js con ?action=bilanci&op=list|approve|reject
// Scrive su tabelle protette da RLS: usa la SERVICE key (mai esposta al browser).
const { createClient } = require('@supabase/supabase-js');

// Init lazy: creare il client a livello di modulo fa crashare l'intera function
// (Vercel risponde HTML "A server error has occurred") se una env var manca,
// prima ancora di poter restituire un JSON. Lo creiamo dentro il try/catch
// dell'handler, così qualsiasi problema di config arriva al browser come JSON.
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!url) throw new Error('Config mancante: SUPABASE_URL non impostata su Vercel');
  if (!key) throw new Error('Config mancante: SUPABASE_SERVICE_KEY/SUPABASE_KEY non impostata su Vercel');
  return createClient(url, key);
}

module.exports = async function bilanciApproval(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cr-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth Control Room
  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  if (req.headers['x-cr-token'] !== CR_TOKEN) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  const op = (req.query?.op || 'list').toString();

  try {
    const supabase = getSupabase();
    // ── LISTA bozze (verified=false) con riepilogo ──
    if (op === 'list') {
      const { data, error } = await supabase
        .from('club_financials')
        .select('id, season, revenue_total, net_result, net_debt, source, source_date, created_at, clubs(name, slug)')
        .eq('verified', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const bozze = (data || []).map(r => ({
        id: r.id,
        club: r.clubs?.name || r.clubs?.slug || '—',
        season: r.season,
        revenue_total: r.revenue_total,
        net_result: r.net_result,
        net_debt: r.net_debt,
        source: r.source,
        source_date: r.source_date,
        created_at: r.created_at
      }));
      return res.status(200).json({ ok: true, bozze });
    }

    // op approve/reject richiedono POST con id
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const id = (req.body?.id || '').toString();
    if (!id) return res.status(400).json({ error: 'id mancante' });

    // ── APPROVA: rende la bozza pubblica ──
    if (op === 'approve') {
      const { data, error } = await supabase
        .from('club_financials')
        .update({ verified: true })
        .eq('id', id)
        .select('id, club_id, clubs(name)');
      if (error) throw new Error(error.message);
      if (!data || !data.length) return res.status(404).json({ error: 'Bozza non trovata' });
      return res.status(200).json({ ok: true, message: `Bilancio ${data[0].clubs?.name || ''} approvato e pubblicato.` });
    }

    // ── RIFIUTA: elimina bozza + deal collegati + club orfano ──
    if (op === 'reject') {
      const { data: draft, error: e0 } = await supabase
        .from('club_financials')
        .select('id, club_id, season, verified')
        .eq('id', id)
        .single();
      if (e0 || !draft) return res.status(404).json({ error: 'Bozza non trovata' });
      if (draft.verified) return res.status(400).json({ error: 'Questa riga è già pubblicata, non è una bozza.' });

      // deal estratti per quel club/stagione
      await supabase.from('club_deals').delete().eq('club_id', draft.club_id).eq('season', draft.season);
      // la bozza
      const { error: e1 } = await supabase.from('club_financials').delete().eq('id', id);
      if (e1) throw new Error(e1.message);
      // se il club non ha altri bilanci, rimuovi il club orfano (es. club nuovo mai approvato)
      const { data: rest } = await supabase.from('club_financials').select('id').eq('club_id', draft.club_id).limit(1);
      let club_removed = false;
      if (!rest || !rest.length) {
        await supabase.from('club_deals').delete().eq('club_id', draft.club_id);
        await supabase.from('clubs').delete().eq('id', draft.club_id);
        club_removed = true;
      }
      return res.status(200).json({ ok: true, message: 'Bozza eliminata.', club_removed });
    }

    return res.status(400).json({ error: 'op non valido (list|approve|reject)' });
  } catch (e) {
    console.error('[bilanci-approval]', e);
    return res.status(500).json({ error: e.message });
  }
};
