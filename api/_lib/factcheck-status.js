// api/_lib/factcheck-status.js — GET /api/run-agent?action=factcheckStatus&num=029 (solo Control Room)
// Dice se il fact-check salvato è aggiornato al testo attuale (stessa impronta) e se l'ultimo avvio è fallito.
// Lo usa la Control Room quando si preme «Invia»: se è aggiornato non parte nulla, altrimenti parte UNA volta.
const { createClient } = require('@supabase/supabase-js');
const { requireAdmin, serviceKey } = require('./admin-auth');
const { contentHash } = require('./content-hash');

module.exports = async function factcheckStatus(req, res) {
  if (!requireAdmin(req, res)) return;
  const num = String(req.query?.num || '').padStart(3, '0');
  if (!/^\d{3}$/.test(num)) return res.status(400).json({ error: 'num non valido' });
  try {
    const sb = createClient(process.env.SUPABASE_URL, serviceKey() || process.env.SUPABASE_KEY);
    const { data, error } = await sb.from('editions')
      .select('num,title,subtitle,opener,sections,factcheck').eq('num', num).limit(1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) return res.status(404).json({ error: `Edizione #${num} non trovata` });
    const ed = data[0];
    const fc = ed.factcheck;
    const fresh = !!(fc && fc.checked_at && fc.content_hash && fc.content_hash === contentHash(ed));
    const { data: errRuns } = await sb.from('agent_runs').select('created_at,summary')
      .eq('agent', 'factcheck').eq('status', 'error').order('created_at', { ascending: false }).limit(1);
    const lastError = errRuns && errRuns[0] ? { at: errRuns[0].created_at, message: String(errRuns[0].summary || '').slice(0, 200) } : null;
    return res.status(200).json({ ok: true, fresh, checked_at: (fc && fc.checked_at) || null, status: (fc && fc.status) || null, last_error: lastError });
  } catch (e) {
    console.error('[factcheckStatus]', e);
    return res.status(500).json({ error: e.message });
  }
};
