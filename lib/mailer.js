// lib/mailer.js — invio email con provider intercambiabile.
// Piano B se Resend è bloccato/limitato: si passa a Brevo senza cambiare codice,
// solo due env var su Vercel:
//   EMAIL_PROVIDER=brevo
//   BREVO_KEY=<chiave api Brevo>
// Default: 'resend' (comportamento invariato se le env non sono impostate).
//
// Prerequisito Brevo: dominio valoreatteso.com autenticato (DKIM/SPF) nella
// dashboard Brevo, altrimenti la deliverability crolla.

function provider() {
  return (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
}

// Estrae nome ed email da una stringa "Nome <email@dominio>".
function parseFrom(from) {
  const m = /<([^>]+)>/.exec(String(from || ''));
  const email = m ? m[1].trim() : String(from || '').trim();
  const name = String(from || '').replace(/<[^>]+>/, '').trim() || 'Valore Atteso';
  return { email, name };
}

// Chiamata singola a Brevo. Ritorna { ok, status, body } per poter mostrare il
// motivo reale di un rifiuto (chiave errata, account non attivato, sender non
// verificato, ecc.) invece di un generico "non riuscito".
async function brevoRequest(msg) {
  const key = process.env.BREVO_KEY;
  if (!key) return { ok: false, status: 0, body: 'BREVO_KEY mancante su Vercel' };
  const sender = parseFrom(msg.from);
  const toList = (Array.isArray(msg.to) ? msg.to : [msg.to])
    .filter(Boolean)
    .map(email => ({ email: String(email).trim() }));
  let r;
  try {
    r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ sender, to: toList, subject: msg.subject, htmlContent: msg.html }),
    });
  } catch (e) {
    return { ok: false, status: 0, body: 'rete: ' + (e && e.message) };
  }
  const body = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, body };
}

// Invia una lista di messaggi [{ from, to, subject, html }] via Brevo.
// Ritorna il numero di invii riusciti. Concorrenza limitata per stare nei
// tempi della serverless function.
async function sendViaBrevo(messages) {
  if (!process.env.BREVO_KEY) throw new Error('BREVO_KEY mancante: configurala su Vercel');
  const CHUNK = 30;
  let sent = 0;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(m => brevoRequest(m)));
    sent += results.filter(x => x.ok).length;
  }
  return sent;
}

// Invia UN singolo messaggio via Resend (percorso di default).
async function sendViaResendOne(msg) {
  const key = process.env.RESEND_KEY;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html }),
  });
  return r.ok;
}

// Invia UN messaggio { from, to, subject, html } col provider corrente.
// Ritorna true se l'invio è riuscito. Usato da subscribe (conferma/benvenuto)
// e ovunque serva un invio singolo indipendente dal provider.
async function sendEmail(msg) {
  // L'email di notifica è secondaria: gli agenti salvano il loro output su
  // Supabase PRIMA di notificare. Un invio fallito (chiave mancante, rifiuto
  // Brevo, rete) NON deve mai far crashare l'agente e vanificare un run costoso.
  // Ritorna sempre un booleano; chi vuole il motivo del rifiuto usa
  // brevoRequest/sendViaBrevo direttamente (es. send-test, subscribe).
  try {
    if (provider() === 'brevo') {
      return (await sendViaBrevo([msg])) > 0;
    }
    return await sendViaResendOne(msg);
  } catch (e) {
    console.error('[mailer] invio email fallito (non bloccante):', e && e.message);
    return false;
  }
}

module.exports = { provider, sendViaBrevo, brevoRequest, sendEmail, parseFrom };
