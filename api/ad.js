export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY non configurata' });
  }

  const { messages, system } = req.body || {};
  
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages mancanti o vuoti' });
  }

  const payload = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages,
  };
  
  if (system) payload.system = system;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  const data = await r.json();
  
  if (!r.ok) {
    return res.status(r.status).json({ 
      error: data.error?.message || 'Errore API',
      type: data.error?.type,
      key_prefix: ANTHROPIC_KEY.substring(0, 20)
    });
  }
  
  return res.status(200).json({ text: data.content?.[0]?.text || '' });
}
