// lib/ai-usage.js — logging del consumo token Anthropic (costo reale per agente).
// Self-contained: usa SOLO fetch + env var (nessun pacchetto npm), quindi è
// importabile sia dagli script (GitHub Actions) sia dalle function in api/.
// Il logging è fire-and-forget e non lancia MAI: non deve rompere il chiamante.

// Prezzi $/1M token (verificare periodicamente sulla console Anthropic).
const PRICES = {
  'claude-opus-4-8':   { in: 5, out: 25 },
  'claude-opus-4-5':   { in: 5, out: 25 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5':  { in: 1, out: 5  },
};
const USD_EUR = 0.92;

function priceFor(model) {
  if (model) for (const k of Object.keys(PRICES)) if (model.indexOf(k) !== -1) return PRICES[k];
  return PRICES['claude-sonnet-4-6']; // fallback prudente
}

// usage = oggetto `usage` della risposta Anthropic { input_tokens, output_tokens, ... }
async function logUsage(agent, model, usage) {
  try {
    if (!usage) return;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) return;
    const inTok  = usage.input_tokens  || 0;
    const outTok = usage.output_tokens || 0;
    const p = priceFor(model);
    const costEur = ((inTok * p.in + outTok * p.out) / 1e6) * USD_EUR;
    await fetch(url + '/rest/v1/ai_usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        agent,
        model: model || null,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_eur: Number(costEur.toFixed(6))
      })
    });
  } catch (e) { /* il logging dei costi non deve mai far fallire l'agente */ }
}

module.exports = { logUsage, priceFor, PRICES, USD_EUR };
