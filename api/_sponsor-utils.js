const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function supabaseHeaders(extra) {
  const key = requireEnv('SUPABASE_SECRET_KEY', SUPABASE_KEY);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

async function supabaseRequest(path, options = {}) {
  const url = `${requireEnv('SUPABASE_URL', SUPABASE_URL)}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: supabaseHeaders(options.headers)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function getGmailAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET),
      refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN', process.env.GOOGLE_REFRESH_TOKEN),
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth ${response.status}: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function sendGmail({ to, subject, html, replyTo }) {
  const sender = requireEnv('GMAIL_SENDER', process.env.GMAIL_SENDER);
  const headers = [
    `From: Valore Atteso <${sender}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8'
  ];
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  const raw = encodeBase64Url(`${headers.join('\r\n')}\r\n\r\n${html}`);
  const accessToken = await getGmailAccessToken();
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gmail API ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
}

module.exports = {
  escapeHtml,
  parseJsonBody,
  sendGmail,
  supabaseHeaders,
  supabaseRequest
};
