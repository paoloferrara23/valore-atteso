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

// Invia una lista di messaggi [{ from, to, subject, html }] via Brevo.
// Ritorna il numero di invii riusciti. Concorrenza limitata per stare nei
// tempi della serverless function.
async function sendViaBrevo(messages) {
  const key = process.env.BREVO_KEY;
  if (!key) throw new Error('BREVO_KEY mancante: configurala su Vercel');
  const CHUNK = 30;
  let sent = 0;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(async (m) => {
      const sender = parseFrom(m.from);
      try {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            sender,
            to: [{ email: m.to }],
            subject: m.subject,
            htmlContent: m.html,
          }),
        });
        return r.ok;
      } catch (_) {
        return false;
      }
    }));
    sent += results.filter(Boolean).length;
  }
  return sent;
}

module.exports = { provider, sendViaBrevo, parseFrom };
