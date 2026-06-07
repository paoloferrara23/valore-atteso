// api/meta-webhook.js
// Riceve lead da Meta Lead Gen Forms e li salva in Supabase subscribers
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'valoreatteso_meta_2026';
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_TOKEN;

module.exports = async function handler(req, res) {

  // ── GET: verifica webhook da Meta ─────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[meta-webhook] Webhook verificato da Meta');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verify token non valido' });
  }

  // ── POST: ricezione lead ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Meta invia array di entry con changes
      const entries = body.entry || [];

      let processati = 0;
      let errori = 0;

      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'leadgen') continue;

          const leadgenId = change.value?.leadgen_id;
          const formId    = change.value?.form_id;
          const pageId    = change.value?.page_id;

          if (!leadgenId) continue;

          // Recupera i dati del lead da Meta Graph API
          const leadData = await fetchLeadData(leadgenId);
          if (!leadData) { errori++; continue; }

          const email = extractField(leadData.field_data, ['email', 'EMAIL', 'e-mail']);
          if (!email || !email.includes('@')) { errori++; continue; }

          // Salva in Supabase
          const { error } = await supabase
            .from('subscribers')
            .upsert({
              email: email.toLowerCase().trim(),
              confirmed: true,
              source: 'meta_leadgen',
              created_at: new Date().toISOString()
            }, { onConflict: 'email', ignoreDuplicates: true });

          if (error) {
            console.error('[meta-webhook] Supabase error:', error.message);
            errori++;
          } else {
            console.log(`[meta-webhook] Iscritto: ${email}`);
            processati++;
          }
        }
      }

      console.log(`[meta-webhook] Processati: ${processati}, Errori: ${errori}`);
      return res.status(200).json({ ok: true, processati, errori });

    } catch (err) {
      console.error('[meta-webhook] Errore:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// ── Recupera dati lead da Meta Graph API ────────────────────────────────────
async function fetchLeadData(leadgenId) {
  try {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('[meta-webhook] Graph API error:', response.status);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.error('[meta-webhook] fetchLeadData error:', err.message);
    return null;
  }
}

// ── Estrae un campo dal field_data del lead ──────────────────────────────────
function extractField(fieldData, possibleNames) {
  if (!Array.isArray(fieldData)) return null;
  for (const field of fieldData) {
    if (possibleNames.some(n => field.name?.toLowerCase() === n.toLowerCase())) {
      return field.values?.[0] || null;
    }
  }
  return null;
}
