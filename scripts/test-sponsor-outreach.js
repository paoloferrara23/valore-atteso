// test-sponsor-outreach.js — Test offline dei validatori (nessuna rete, nessun invio)
// Esegui: node scripts/test-sponsor-outreach.js

const assert = require('assert');

// Replica dei validatori dell'agente (testati in isolamento)
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PERSONAL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'libero.it', 'tiscali.it', 'icloud.com'];
function validEmail(e) {
  if (!e || !EMAIL_RE.test(e)) return false;
  return !PERSONAL_DOMAINS.includes(e.split('@')[1].toLowerCase());
}
function validUrl(u) {
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; }
  catch { return false; }
}
function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

// Email
assert.strictEqual(validEmail('marketing@azienda.it'), true);
assert.strictEqual(validEmail('mario.rossi@gmail.com'), false, 'email personale rifiutata');
assert.strictEqual(validEmail('non-una-email'), false);
assert.strictEqual(validEmail(''), false);
assert.strictEqual(validEmail(null), false);

// URL
assert.strictEqual(validUrl('https://example.com/comunicato'), true);
assert.strictEqual(validUrl('javascript:alert(1)'), false, 'protocollo non http rifiutato');
assert.strictEqual(validUrl('ftp://example.com'), false);
assert.strictEqual(validUrl('testo qualsiasi'), false);

// Dominio
assert.strictEqual(extractDomain('https://www.Azienda.IT/chi-siamo'), 'azienda.it');
assert.strictEqual(extractDomain('non valido'), null);

// Nessuna funzione di invio: verifica statica che gmail.js non contenga endpoint di invio
const fs = require('fs');
const gmailSrc = fs.readFileSync(__dirname + '/gmail.js', 'utf8');
assert.ok(!gmailSrc.includes('/messages/send'), 'gmail.js non deve contenere endpoint di invio');
const agentSrc = fs.readFileSync(__dirname + '/sponsor-outreach-agent.js', 'utf8');
assert.ok(!agentSrc.includes('/messages/send'), 'agent non deve contenere endpoint di invio Gmail');

console.log('✓ Tutti i test passati. Nessuna funzione di invio presente.');
