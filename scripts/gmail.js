// gmail.js — Helper Gmail API per outreach sponsor
// SOLO creazione bozze e lettura thread. Nessuna funzione di invio.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const SENDER = process.env.GMAIL_SENDER || 'info@valoreatteso.com';

let cachedToken = null;
let cachedExp = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedExp - 60000) return cachedToken;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!r.ok) throw new Error(`OAuth refresh fallito: ${r.status}`);
  const d = await r.json();
  cachedToken = d.access_token;
  cachedExp = Date.now() + (d.expires_in || 3600) * 1000;
  return cachedToken;
}

function buildRawMessage(to, subject, body) {
  // RFC 2822, base64url. Soggetto encodato per caratteri non-ASCII.
  const encSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const msg = [
    `From: Valore Atteso <${SENDER}>`,
    `To: ${to}`,
    `Subject: ${encSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64')
  ].join('\r\n');
  return Buffer.from(msg).toString('base64url');
}

// Crea una bozza. NON invia. Ritorna { draftId, threadId }.
async function createDraft(to, subject, body) {
  const token = await getAccessToken();
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: buildRawMessage(to, subject, body) } })
  });
  if (!r.ok) throw new Error(`Gmail createDraft: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { draftId: d.id, threadId: d.message && d.message.threadId };
}

// Legge i messaggi di un thread (per rilevare risposte). Sola lettura.
async function getThreadMessages(threadId) {
  const token = await getAccessToken();
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!r.ok) {
    if (r.status === 404) return [];
    throw new Error(`Gmail getThread: ${r.status}`);
  }
  const d = await r.json();
  return (d.messages || []).map(m => {
    const headers = {};
    ((m.payload && m.payload.headers) || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });
    let text = '';
    function walk(part) {
      if (!part) return;
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        text += Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
      (part.parts || []).forEach(walk);
    }
    walk(m.payload);
    return {
      id: m.id,
      from: headers['from'] || '',
      date: headers['date'] || '',
      snippet: m.snippet || '',
      text: text.slice(0, 4000),
      isFromUs: (headers['from'] || '').includes(SENDER)
    };
  });
}

// Verifica che una bozza esista ancora (se sparita = inviata o cancellata a mano)
async function draftExists(draftId) {
  const token = await getAccessToken();
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return r.ok;
}

function gmailConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

module.exports = { createDraft, getThreadMessages, draftExists, gmailConfigured };
