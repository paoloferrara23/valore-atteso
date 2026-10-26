// api/_lib/admin-db.js — Accesso ai dati della Control Room, solo con sessione admin.
//
// La Control Room chiamava Supabase dal browser con la chiave pubblica: per
// funzionare le tabelle dovevano essere aperte a chiunque. Ora le chiamate
// passano da qui (/api/admin-db/rest/v1/<tabella>?...), il server verifica il
// cookie di sessione e inoltra con la chiave di servizio, solo verso le
// tabelle elencate.

const { requireAdmin, serviceKey } = require('./admin-auth');

const TABLES = new Set([
  'editions', 'agent_memory', 'agent_runs', 'subscribers', 'ai_usage',
  'sponsor_requests', 'sponsor_leads', 'sponsor_contacts', 'sponsor_outreach',
  'sponsor_outreach_runs', 'sponsor_excluded_domains'
]);
const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

module.exports = async function adminDb(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAdmin(req, res)) return;
  if (!METHODS.has(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const p = String(req.query.p || '');
  const m = p.match(/^rest\/v1\/([a-z_]+)$/);
  if (!m || !TABLES.has(m[1])) return res.status(400).json({ ok: false, error: 'Tabella non consentita' });

  const key = serviceKey();
  if (!key) return res.status(500).json({ ok: false, error: 'Chiave di servizio Supabase mancante' });

  // action e p vengono dalla rewrite di vercel.json; path lo aggiunge Vercel
  // (parametro :path* della rewrite): Supabase li leggerebbe come filtri (400).
  const qs = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([k, v]) => {
    if (k === 'action' || k === 'p' || k === 'path') return;
    (Array.isArray(v) ? v : [v]).forEach(x => qs.append(k, x));
  });

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (req.headers.prefer) headers.Prefer = req.headers.prefer;

  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.body !== undefined) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${m[1]}${qs.toString() ? '?' + qs : ''}`, init);
  const text = await r.text();
  if (!r.ok) console.error('[admin-db]', req.method, m[1], r.status, text.slice(0, 200));
  res.status(r.status);
  res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
  return res.send(text);
};
