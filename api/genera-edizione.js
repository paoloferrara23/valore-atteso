// api/genera-edizione.js — Genera la bozza completa dalle sezioni scelte
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
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 5000, system, messages })
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
    const { editionId, bilancio, deal, metrica, date, hint } = req.body;

    if (!editionId) return res.status(400).json({ error: 'editionId obbligatorio' });

    // Carica la bozza esistente con le opzioni
    const { data: editions, error } = await supabase
      .from('editions')
      .select('*')
      .eq('id', editionId)
      .limit(1);

    if (error) throw new Error(error.message);
    if (!editions?.length) throw new Error('Bozza non trovata');
    const draft = editions[0];

    // Costruisce il prompt con le sezioni scelte
    const sezionePrompt = (label, scelta, custom) => {
      if (custom) return `${label}: ${custom} (tema inserito manualmente dall'editore)`;
      return `${label}: "${scelta.title}" — ${scelta.summary}`;
    };

    const system = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio.
Scrivi le 3 sezioni dell'edizione usando SOLO i temi e dati forniti.
Tono: analitico, diretto, professionale. Pubblico: M&A, PE, consulenza.

FORMATO KPI OBBLIGATORIO per ogni sezione (esattamente 3):
[{"label":"nome breve max 4 parole","value":"numero con unità","sub":"contesto 3-4 parole"}]

Rispondi SOLO in JSON valido:
{
  "title": "titolo principale edizione",
  "subtitle": "sottotitolo",
  "opener": "2-3 righe di apertura",
  "sections": [
    {
      "label": "Il Bilancio",
      "title": "titolo sezione",
      "body": "testo 150-200 parole",
      "kpis": [{"label":"...","value":"...","sub":"..."}],
      "verdict": "verdetto finale",
      "sources": ["fonte — testata — data"]
    },
    { "label": "Il Deal", ... },
    { "label": "La Metrica", ... }
  ]
}`;

    const userMsg = `Genera l'edizione #${draft.num} di Valore Atteso.

SEZIONI DA SVILUPPARE:
${sezionePrompt('Il Bilancio', bilancio, bilancio?.custom)}
${sezionePrompt('Il Deal', deal, deal?.custom)}
${sezionePrompt('La Metrica', metrica, metrica?.custom)}

${hint ? `NOTA EDITORIALE: ${hint}` : ''}

Scrivi testi completi per ognuna. KPI verificati dai temi forniti.`;

    const testo = await callClaude([{ role: 'user', content: userMsg }], system);

    let generated;
    try {
      const match = testo.match(/\{[\s\S]*\}/);
      generated = JSON.parse(match[0]);
    } catch {
      throw new Error('JSON generato non valido');
    }

    // Aggiorna la bozza con il contenuto generato
    const updateData = {
      title: generated.title,
      subtitle: generated.subtitle || '',
      opener: generated.opener || '',
      sections: generated.sections,
      date: date || draft.date,
    };

    const { error: updateErr } = await supabase
      .from('editions')
      .update(updateData)
      .eq('id', editionId);

    if (updateErr) throw new Error(updateErr.message);

    return res.status(200).json({ ok: true, id: editionId, title: generated.title });

  } catch (e) {
    console.error('[genera-edizione]', e);
    return res.status(500).json({ error: e.message });
  }
};

