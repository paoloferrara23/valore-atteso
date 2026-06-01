// api/genera-edizione.js — Genera o rigenera la bozza completa con qualità editoriale alta
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

async function callClaude(messages, system) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 6000, system, messages })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Anthropic: ${r.status} ${t}`); }
  const data = await r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

const SYSTEM_REDAZIONE = `Sei il redattore senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Target: professionisti M&A, PE, consulenza, finanza. Esce ogni martedì. 

STILE EDITORIALE — REGOLE NON NEGOZIABILI:
1. DATI PRIMA DI TUTTO: ogni affermazione quantitativa deve avere un numero. Non "ricavi in crescita" ma "ricavi +12% a €580M (bilancio 2023/24)".
2. FONTI VERIFICABILI: cita sempre la fonte (bilancio depositato, comunicato club, UEFA Financial Reports, Deloitte Football Money League, calcioefinanza.it, SwissRamble, FT, Reuters, Il Sole 24 Ore). Se un dato non ha fonte certa, non scriverlo.
3. ANGOLO FINANCE: ogni sezione deve rispondere a una domanda finanziaria precisa. Non descrivere — analizzare. "Cosa dice questo dato sulla sostenibilità del modello?" "Qual è il multiplo implicito?" "Come si confronta con i peer?"
4. TONO DIRETTO: frasi corte. Nessuna ridondanza. Nessun gossip. Nessuna speculazione senza dati.
5. STRUTTURA SEZIONE:
   - Apertura: il dato/fatto principale in 1-2 righe
   - Sviluppo: contesto, comparabili, implicazioni (3-4 paragrafi da 40-60 parole)
   - KPI: 3 metriche chiave con valore, label breve (max 4 parole), sub-label contesto
   - Verdict (La nostra lettura): 2-3 righe di sintesi editoriale — cosa significa per un investitore/advisor
6. LUNGHEZZA: ogni sezione 200-280 parole totali. Non di più, non di meno.
7. KPI FORMAT: {"label":"max 4 parole","value":"numero+unità","sub":"max 4 parole contesto"}

FONTI PRIMARIE ACCETTATE (in ordine di affidabilità):
- Bilanci depositati (FIGC, Companies House, Bundesanzeiger)
- Comunicati ufficiali club / federazioni
- UEFA Financial Reports / Club Licensing Benchmarking
- Deloitte Football Money League / Annual Review
- KPMG Football Benchmark
- calcioefinanza.it (solo dati con fonte primaria citata)
- SwissRamble (solo analisi bilanci verificate)
- Financial Times, Reuters, Bloomberg, Il Sole 24 Ore`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  if (req.headers['x-cr-token'] !== CR_TOKEN) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const { editionId, bilancio, deal, metrica, date, hint, regenSezione } = req.body;
    if (!editionId) return res.status(400).json({ error: 'editionId obbligatorio' });

    const { data: editions, error } = await supabase.from('editions').select('*').eq('id', editionId).limit(1);
    if (error) throw new Error(error.message);
    if (!editions?.length) throw new Error('Bozza non trovata');
    const draft = editions[0];

    // ── MODALITÀ: rigenera singola sezione ───────────────────────────────
    if (regenSezione) {
      const sezIdx = { bilancio: 0, deal: 1, metrica: 2 }[regenSezione];
      if (sezIdx === undefined) return res.status(400).json({ error: 'Sezione non valida' });

      const sezLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
      const sezCorrente = draft.sections?.[sezIdx];
      if (!sezCorrente) return res.status(400).json({ error: 'Sezione non trovata nella bozza' });

      const prompt = `Riscrivi SOLO la sezione "${sezLabels[sezIdx]}" dell'edizione #${draft.num}.

TEMA ATTUALE: "${sezCorrente.title}"
TESTO ATTUALE DA MIGLIORARE:
${JSON.stringify(sezCorrente, null, 2)}

ISTRUZIONI:
- Mantieni lo stesso tema ma migliora qualità, precisione e stile
- Aggiungi dati più specifici se mancanti
- Verifica che ogni dato abbia una fonte
- Migliora il verdict per renderlo più incisivo

Rispondi SOLO in JSON con questa struttura:
{
  "label": "${sezLabels[sezIdx]}",
  "title": "titolo sezione",
  "body": "testo completo 200-280 parole",
  "kpis": [{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."}],
  "verdict": "2-3 righe di lettura editoriale",
  "sources": ["fonte — testata — data"]
}`;

      const testo = await callClaude([{ role: 'user', content: prompt }], SYSTEM_REDAZIONE);
      const match = testo.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSON non valido');
      const newSez = JSON.parse(match[0]);

      const sections = [...(draft.sections || [])];
      sections[sezIdx] = newSez;

      const { error: upErr } = await supabase.from('editions').update({ sections }).eq('id', editionId);
      if (upErr) throw new Error(upErr.message);
      return res.status(200).json({ ok: true, id: editionId, sezione: regenSezione });
    }

    // ── MODALITÀ: genera bozza completa ─────────────────────────────────
    const sezionePrompt = (label, scelta) => {
      if (!scelta) return `${label}: (nessun tema selezionato)`;
      if (scelta.custom) return `${label}: "${scelta.custom}" (tema libero — sviluppa con dati verificati)`;
      return `${label}: "${scelta.titolo || scelta.title}"\nAngolo: ${scelta.angolo || 'analitico'}\nSommario: ${scelta.sommario || scelta.summary}\nFonte principale: ${scelta.fonte_principale || scelta.source}\nDati preview: ${(scelta.dati_chiave || scelta.kpi_preview || []).join(', ')}`;
    };

    const prompt = `Genera l'edizione #${draft.num} di Valore Atteso.

SEZIONI DA SVILUPPARE:
${sezionePrompt('IL BILANCIO', bilancio)}

${sezionePrompt('IL DEAL', deal)}

${sezionePrompt('LA METRICA', metrica)}

${hint ? `NOTA EDITORIALE DI PAOLO: ${hint}` : ''}

DELIVERABLE:
- Titolo principale edizione (incisivo, max 8 parole)
- Sottotitolo (max 12 parole, contestualizza il tema)
- Opener (2-3 righe editoriali che introducono il filo conduttore dell'edizione)
- 3 sezioni complete con body 200-280 parole, 3 KPI verificati, verdict incisivo, fonti
- Ogni fonte nel formato: "Nome dato — Testata/Documento — Anno"

Rispondi SOLO in JSON valido:
{
  "title": "...",
  "subtitle": "...",
  "opener": "...",
  "sections": [
    {
      "label": "Il Bilancio",
      "title": "...",
      "body": "...",
      "kpis": [{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."}],
      "verdict": "...",
      "sources": ["...","..."]
    },
    {"label": "Il Deal", ...},
    {"label": "La Metrica", ...}
  ]
}`;

    const testo = await callClaude([{ role: 'user', content: prompt }], SYSTEM_REDAZIONE);
    const match = testo.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON non valido dalla AI');
    const generated = JSON.parse(match[0]);

    const updateData = {
      title: generated.title,
      subtitle: generated.subtitle || '',
      opener: generated.opener || '',
      sections: generated.sections,
      date: date || draft.date,
    };

    const { error: updateErr } = await supabase.from('editions').update(updateData).eq('id', editionId);
    if (updateErr) throw new Error(updateErr.message);

    return res.status(200).json({ ok: true, id: editionId, title: generated.title });

  } catch (e) {
    console.error('[genera-edizione]', e);
    return res.status(500).json({ error: e.message });
  }
};

