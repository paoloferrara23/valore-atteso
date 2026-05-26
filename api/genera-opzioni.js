// api/genera-opzioni.js — Genera 3 opzioni per sezione (chiamata manuale da Control Room)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

async function callClaude(messages, system) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, system, messages })
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status}`);
  const data = await r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── AUTH ──────────────────────────────────────────────────────────────────
  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  const token = req.headers['x-cr-token'];
  if (token !== CR_TOKEN) return res.status(401).json({ error: 'Non autorizzato' });
  // ──────────────────────────────────────────────────────────────────────────

  try {
    const { hint, editionNum, oggi } = req.body;

    // Legge i temi dello Scout dalla memoria
    const { data: memory } = await supabase
      .from('agent_memory')
      .select('value')
      .eq('key', 'scout_brief')
      .single();

    const scoutBrief = memory?.value;
    const temiContext = scoutBrief
      ? `\nTEMI DELLO SCOUT:\n${JSON.stringify(scoutBrief.temi, null, 2)}\nTEMA CONSIGLIATO: ${scoutBrief.tema_consigliato}`
      : '\nNessun brief Scout disponibile — usa le notizie più rilevanti del calcio europeo.';

    const system = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio.
Proponi 3 opzioni per ogni sezione (Il Bilancio, Il Deal, La Metrica).
Ogni opzione: titolo breve, sommario 2-3 righe, 2 dati chiave, fonte principale.
USA SOLO dati verificabili dai temi Scout o notizie recenti note.
${temiContext}

Rispondi SOLO in JSON:
{
  "section_options": {
    "bilancio": [{"title":"...","summary":"...","kpi_preview":["...","..."],"source":"..."},...],
    "deal": [...],
    "metrica": [...]
  }
}`;

    const testo = await callClaude([{
      role: 'user',
      content: `Genera opzioni per l'edizione #${editionNum} di ${oggi}.${hint ? ' Hint: ' + hint : ''}`
    }], system);

    let opts;
    try {
      const match = testo.match(/\{[\s\S]*\}/);
      opts = JSON.parse(match[0]);
    } catch {
      throw new Error('JSON non valido');
    }

    // Salva bozza con le opzioni
    const { data: saved, error } = await supabase
      .from('editions')
      .insert({
        num: editionNum,
        title: `Bozza #${editionNum} — seleziona le sezioni`,
        date: oggi,
        sections: [],
        section_options: opts.section_options,
        published: false,
        tags: ['Il Bilancio', 'Il Deal', 'La Metrica']
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return res.status(200).json({ ok: true, id: saved.id });

  } catch (e) {
    console.error('[genera-opzioni]', e);
    return res.status(500).json({ error: e.message });
  }
};

