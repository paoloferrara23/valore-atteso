const crypto = require('crypto');
const { supabaseRequest } = require('./sponsor-utils');

const MAGIC_LINK_DAYS = 14;
const SESSION_DAYS = 14;
const COOKIE_NAME = 'va_sponsor_session';

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function addDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function cookieValue(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function setSessionCookie(res, value) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
  );
}

async function issueMagicToken(requestId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      token: hash(rawToken),
      token_expires_at: addDays(MAGIC_LINK_DAYS),
      token_used_at: null
    })
  });
  return rawToken;
}

async function createSession(req, res, requestId) {
  const rawSession = crypto.randomBytes(32).toString('hex');
  await supabaseRequest('/rest/v1/sponsor_sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      request_id: requestId,
      session_hash: hash(rawSession),
      expires_at: addDays(SESSION_DAYS)
    })
  });
  setSessionCookie(res, rawSession);
}

async function authenticateSponsor(req, res, rawMagicToken) {
  const session = cookieValue(req);
  if (session) {
    const sessions = await supabaseRequest(
      `/rest/v1/sponsor_sessions?session_hash=eq.${hash(session)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=request_id&limit=1`,
      { headers: { Accept: 'application/json' } }
    );
    if (sessions && sessions[0]) return sessions[0].request_id;
  }

  const token = String(rawMagicToken || '').trim();
  if (!token) return null;
  const requests = await supabaseRequest(
    `/rest/v1/sponsor_requests?token=eq.${hash(token)}&token_used_at=is.null&token_expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ token_used_at: new Date().toISOString() })
    }
  );
  const request = requests && requests[0];
  if (!request) return null;

  await createSession(req, res, request.id);
  return request.id;
}

module.exports = {
  authenticateSponsor,
  issueMagicToken,
  MAGIC_LINK_DAYS,
  SESSION_DAYS
};
