const { supabaseRequest } = require('./sponsor-utils');

const TERMS_VERSION = '2026-06-10-v2';

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value || req.headers['x-real-ip'] || '')
    .split(',')[0]
    .trim()
    .slice(0, 100);
}

async function recordAcceptance(req, requestId, acceptanceType, evidence) {
  const rows = await supabaseRequest('/rest/v1/sponsor_acceptances', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      request_id: requestId,
      acceptance_type: acceptanceType,
      document_version: TERMS_VERSION,
      ip_address: clientIp(req) || null,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
      evidence
    })
  });
  return rows && rows[0];
}

module.exports = {
  TERMS_VERSION,
  recordAcceptance
};
