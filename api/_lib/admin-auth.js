// api/_lib/admin-auth.js — Autenticazione della Control Room, tutta lato server.
//
// - La password vive SOLO nella env var CR_ADMIN_SECRET (Vercel). Se manca o è
//   corta (< 5 caratteri) l'accesso admin resta chiuso (503): fail closed.
// - Login: POST con la password, confronto a tempo costante, massimo 5 errori
//   per IP ogni 15 minuti (tabella rate_limits, IP salvato solo come hash) e
//   massimo 20 errori totali ogni 15 minuti da qualunque IP: con una password
//   corta il blocco globale impedisce i tentativi distribuiti su molti indirizzi.
// - Sessione: cookie va_admin httpOnly, Secure, SameSite=Strict, 4 ore, firmato
//   con HMAC derivato dalla password: cambiarla invalida tutte le sessioni.
// - Agenti GitHub Actions: header x-agent-key confrontato con AGENT_API_SECRET.

const crypto = require('crypto');

const COOKIE = 'va_admin';
const TTL_S = 4 * 3600;
const MAX_FAILS = 5;
const MAX_FAILS_ALL = 20;
const MIN_ADMIN_LEN = 5;
const WINDOW_MIN = 15;

function adminSecret() {
  const s = process.env.CR_ADMIN_SECRET || '';
  return s.length >= MIN_ADMIN_LEN ? s : null;
}

function serviceKey() {
  return process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || null;
}

// Tipo della chiave di servizio (mai il valore), una volta per istanza: serve a
// verificare dai log che il server non stia usando per errore la chiave pubblica.
function keyKind(v) {
  if (!v) return 'assente';
  if (v.startsWith('sb_secret_')) return 'secret';
  if (v.startsWith('sb_publishable_')) return 'publishable';
  try { return 'jwt:' + JSON.parse(Buffer.from(v.split('.')[1], 'base64url').toString()).role; } catch (_) { return 'sconosciuto'; }
}
console.log('[admin-auth] chiave di servizio:', keyKind(serviceKey()));

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sessionKey() {
  return crypto.createHmac('sha256', adminSecret()).update('va-admin-session-v1').digest();
}

function sign(value) {
  return crypto.createHmac('sha256', sessionKey()).update(value).digest('base64url');
}

function issueToken() {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const value = `v1.${exp}.${nonce}`;
  return `${value}.${sign(value)}`;
}

function verifyToken(token) {
  if (!adminSecret() || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const value = parts.slice(0, 3).join('.');
  if (!safeEqual(sign(value), parts[3])) return false;
  return Number(parts[1]) > Math.floor(Date.now() / 1000);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isAdmin(req) {
  return verifyToken(parseCookies(req)[COOKIE]);
}

function isAgent(req) {
  const s = process.env.AGENT_API_SECRET || '';
  const h = req.headers['x-agent-key'];
  return s.length >= 24 && !!h && safeEqual(h, s);
}

// Richieste che modificano dati: se il browser dichiara un'origine, deve essere la nostra.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || /(^|\.)valoreatteso\.com$/.test(host);
  } catch (_) { return false; }
}

function deny(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ ok: false, error });
  return false;
}

function requireAdmin(req, res) {
  if (!adminSecret()) return deny(res, 503, 'Accesso admin non configurato');
  if (!isAdmin(req)) return deny(res, 401, 'Non autorizzato');
  if (req.method !== 'GET' && !sameOrigin(req)) return deny(res, 403, 'Origine non consentita');
  return true;
}

function requireAdminOrAgent(req, res) {
  if (isAgent(req)) return true;
  return requireAdmin(req, res);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function ipHash(req) {
  return crypto.createHash('sha256').update('va-admin-ip:' + clientIp(req)).digest('hex').slice(0, 32);
}

async function supa(path, opts = {}) {
  const key = serviceKey();
  if (!key) throw new Error('Chiave di servizio Supabase mancante');
  const r = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function logAuth(status, summary, req) {
  try {
    await supa('/rest/v1/agent_runs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ agent: 'admin-auth', status, summary, data: { ip_hash: ipHash(req) } })
    });
  } catch (_) { /* il log non deve bloccare il login */ }
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function login(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return deny(res, 405, 'Method not allowed');
  const secret = adminSecret();
  if (!secret) return deny(res, 503, 'Accesso admin non configurato');
  if (!sameOrigin(req)) return deny(res, 403, 'Origine non consentita');

  const hash = ipHash(req);
  const windowStart = Date.now() - WINDOW_MIN * 60000;
  let row = null, all = null;
  try {
    const rows = await supa(`/rest/v1/rate_limits?ip=eq.${hash}&action=eq.admin_login_fail&select=count,created_at`);
    row = (rows || [])[0] || null;
    const allRows = await supa('/rest/v1/rate_limits?ip=eq.global&action=eq.admin_login_fail_all&select=count,created_at');
    all = (allRows || [])[0] || null;
  } catch (_) {
    // Senza registro dei tentativi non si rischia: login chiuso.
    return deny(res, 503, 'Servizio temporaneamente non disponibile');
  }
  const fresh = !!row && new Date(row.created_at).getTime() > windowStart;
  const fails = fresh ? (row.count || 0) : 0;
  const freshAll = !!all && new Date(all.created_at).getTime() > windowStart;
  const failsAll = freshAll ? (all.count || 0) : 0;
  if (fails >= MAX_FAILS || failsAll >= MAX_FAILS_ALL) {
    await logAuth('blocked', 'Login admin bloccato per troppi tentativi', req);
    return deny(res, 429, `Troppi tentativi. Riprova tra ${WINDOW_MIN} minuti.`);
  }

  const saveFails = async (count, createdAt, ip = hash, action = 'admin_login_fail') => {
    try {
      await supa('/rest/v1/rate_limits?on_conflict=ip,action', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ ip, action, count, created_at: createdAt })
      });
    } catch (_) {}
  };

  const password = String((req.body && req.body.password) || '');
  if (!password || !safeEqual(password, secret)) {
    await saveFails(fails + 1, fresh ? row.created_at : new Date().toISOString());
    await saveFails(failsAll + 1, freshAll ? all.created_at : new Date().toISOString(), 'global', 'admin_login_fail_all');
    await logAuth('error', 'Login admin fallito', req);
    await new Promise(r => setTimeout(r, 400));
    return deny(res, 401, 'Password errata');
  }

  if (row) await saveFails(0, new Date().toISOString());
  res.setHeader('Set-Cookie', cookie(issueToken(), TTL_S));
  await logAuth('success', 'Login admin riuscito', req);
  return res.status(200).json({ ok: true });
}

function logout(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', cookie('', 0));
  return res.status(200).json({ ok: true });
}

module.exports = {
  adminSecret, serviceKey, isAdmin, isAgent, requireAdmin, requireAdminOrAgent,
  login, logout, ipHash, logAuth, issueToken, verifyToken, safeEqual
};
