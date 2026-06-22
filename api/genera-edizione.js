// api/genera-edizione.js — Pipeline 3 fasi: Opus Writer → Opus Editor → salva
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

// ── Chiamata Claude ───────────────────────────────────────────────────────────
async function callClaude(messages, system, model = 'claude-sonnet-4-6') {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4000, system, messages })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Anthropic ${r.status}: ${t.slice(0,200)}`); }
  const d = await r.json();
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ── Leggi Wiki context da Supabase ────────────────────────────────────────────
async function getWikiContext() {
  try {
    const { data: rows } = await supabase
      .from('editorial_wiki')
      .select('categoria,chiave,valore')
      .order('categoria', { ascending: true });

    if (!rows || !rows.length) return '';

    const stile    = rows.filter(r => r.categoria === 'stile').map(r => `• ${r.chiave}: ${r.valore}`).join('\n');
    const edizioni = rows.filter(r => r.categoria === 'edizione').slice(-8).map(r => r.valore).join('\n');
    const club     = rows.filter(r => r.categoria === 'club_analizzato').slice(-20).map(r => r.valore).join('\n');
    const errori   = rows.filter(r => r.categoria === 'errore').map(r => r.valore).join('\n');

    return `=== WIKI EDITORIALE VALORE ATTESO ===

STILE E REGOLE:
${stile}

EDIZIONI PRECEDENTI (evita di ripetere stessi temi e club):
${edizioni}

CLUB GIÀ ANALIZZATI RECENTEMENTE:
${club}

ERRORI DA EVITARE (segnalati dall'editore):
${errori}

=== FINE WIKI ===`;
  } catch(e) {
    console.warn('Wiki non disponibile:', e.message);
    return '';
  }
}

// ── Parser JSON robusto ───────────────────────────────────────────────────────
function parseJSON(text) {
  const raw = text.replace(/```json|```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Nessun JSON trovato');
  return JSON.parse(
    match[0]
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/"((?:[^"\\]|\\.)*)"/g, (m, s) => '"' + s.replace(/\n/g, ' ').replace(/\r/g, '') + '"')
  );
}

// ── Prompt sezione ────────────────────────────────────────────────────────────
function sezionePrompt(label, scelta) {
  if (!scelta) return `${label}: (nessun tema selezionato)`;
  if (scelta.custom) return `${label}: "${scelta.custom}" (tema libero)`;
  return `${label}: "${scelta.titolo || scelta.title}"
Angolo: ${scelta.angolo || 'analitico'}
Sommario Scout: ${scelta.sommario || scelta.summary}
DATI VERIFICATI SCOUT (usa SOLO questi):
${(scelta.dati_chiave || scelta.kpi_preview || []).map(d => '• ' + d).join('\n')}
FONTE PRIMARIA: ${scelta.fonte_principale || scelta.source}`;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
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

    const { data: editions } = await supabase.from('editions').select('*').eq('id', editionId).limit(1);
    if (!editions?.length) return res.status(404).json({ error: 'Bozza non trovata' });
    const draft = editions[0];

    // Leggi Wiki context
    const wikiContext = await getWikiContext();
    console.log(`Wiki context: ${wikiContext.length} caratteri`);

    // ── MODALITÀ: rigenera singola sezione ──────────────────────────────────
    if (regenSezione) {
      const sezIdx = { bilancio: 0, deal: 1, metrica: 2 }[regenSezione];
      if (sezIdx === undefined) return res.status(400).json({ error: 'Sezione non valida' });
      const sezLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
      const sezCorrente = draft.sections?.[sezIdx];
      if (!sezCorrente) return res.status(400).json({ error: 'Sezione non trovata' });

      // FASE 1: Writer
      const writerPrompt = `Riscrivi la sezione "${sezLabels[sezIdx]}" migliorando qualità e precisione.
TEMA ATTUALE: "${sezCorrente.title || sezCorrente.titolo}"
TESTO DA MIGLIORARE: ${JSON.stringify(sezCorrente)}

ISTRUZIONI: mantieni tema, migliora dati, aggiungi fonti se mancanti, rendi il verdict più incisivo.
Rispondi SOLO JSON: {"label":"${sezLabels[sezIdx]}","title":"...","body":"...","kpis":[{"label":"...","value":"...","sub":"..."},...],"verdict":"...","sources":["..."]}`;

      const writerRaw = await callClaude([{ role: 'user', content: writerPrompt }],
        `Sei il redattore senior di Valore Atteso.\n${wikiContext}`, 'claude-sonnet-4-6');

      // FASE 2: Editor
      const editorPrompt = `Revisiona criticamente questa sezione. Trova e correggi:
1. Dati non verificati → sostituisci con [dato da verificare]
2. Incoerenze con il tema
3. Linguaggio non professionale
4. KPI con valori inventati

SEZIONE DA REVISIONARE:
${writerRaw}

Rispondi SOLO JSON migliorato con stessa struttura.`;

      const editorRaw = await callClaude([{ role: 'user', content: editorPrompt }],
        `Sei il direttore editoriale di Valore Atteso. Il tuo compito è trovare errori e migliorare la qualità.\n${wikiContext}`,
        'claude-sonnet-4-6');

      const newSez = parseJSON(editorRaw);
      const sections = [...(draft.sections || [])];
      sections[sezIdx] = newSez;

      await supabase.from('editions').update({ sections }).eq('id', editionId);
      return res.status(200).json({ ok: true, id: editionId, sezione: regenSezione });
    }

    // ── MODALITÀ: genera bozza completa ────────────────────────────────────

    // ── FASE 1: OPUS WRITER ─────────────────────────────────────────────────
    console.log('Fase 1: Opus Writer...');
    const writerSystem = `Sei il redattore senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Pubblico: professionisti M&A, PE, consulenza, finanza.

REGOLE ASSOLUTE:
1. Usa SOLO i dati forniti dallo Scout — ZERO dati inventati
2. I KPI devono venire esclusivamente dai "DATI VERIFICATI SCOUT"
3. Le fonti devono corrispondere alle "FONTI PRIMARIE" dello Scout
4. Se un dato non è nei dati Scout scrivi [dato da verificare]
5. Sviluppa analiticamente i dati Scout, non aggiungerne di nuovi

TONO E STILE — INDEROGABILE:
6. Scrivi in modo analitico ma leggibile — non un report, non un comunicato stampa
7. I dati finanziari devono essere nel testo ma non devono soffocarlo — ogni numero deve avere contesto
8. Ogni sezione deve lasciare uno spunto di riflessione per un lettore M&A/PE/consulenza
9. Le tre sezioni non devono contraddirsi né ripetere gli stessi dati
10. Non citare mai Calcio e Finanza nel testo — è un competitor. Usa sempre le fonti primarie (bilanci ufficiali club, UEFA, FIGC, Deloitte, comunicati stampa)
11. Il body di ogni sezione deve essere 220-300 parole — leggibile in 60-90 secondi
12. Evita tecnicismi senza spiegazione — se usi un termine M&A (es. "basis point", "EBITDA"), contestualizzalo brevemente

${wikiContext}`;

    const writerPrompt = `Genera l'edizione #${draft.num} di Valore Atteso.

SEZIONI DA SVILUPPARE:
${sezionePrompt('IL BILANCIO', bilancio)}

${sezionePrompt('IL DEAL', deal)}

${sezionePrompt('LA METRICA', metrica)}

${hint ? `NOTA EDITORIALE: ${hint}` : ''}

Genera:
- Titolo principale (max 8 parole, incisivo)
- Sottotitolo (max 12 parole)
- Opener (2-3 righe che introducono il filo conduttore — DEVE essere coerente con le 3 sezioni, nessun riferimento a temi non presenti)
- 3 sezioni con body 200-280 parole, 3 KPI dai dati Scout, verdict incisivo, fonti reali

Rispondi SOLO JSON:
{
  "title": "...",
  "subtitle": "...",
  "opener": "...",
  "sections": [
    {"label":"Il Bilancio","title":"...","body":"...","kpis":[{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."},{"label":"...","value":"...","sub":"..."}],"verdict":"...","sources":["fonte reale"]},
    {"label":"Il Deal",...},
    {"label":"La Metrica",...}
  ]
}`;

    const writerRaw = await callClaude([{ role: 'user', content: writerPrompt }], writerSystem);
    console.log('Writer completato, lunghezza:', writerRaw.length);

    // ── FASE 2: OPUS EDITOR ─────────────────────────────────────────────────
    console.log('Fase 2: Opus Editor...');
    const editorSystem = `Sei il direttore editoriale di Valore Atteso. Il tuo compito NON è scrivere — è trovare problemi e correggere.

Analizza il testo ricevuto e correggi:
1. DATI INVENTATI: ogni numero deve avere una fonte. Se non c'è fonte → [dato da verificare]
2. INCOERENZE: l'opener parla di qualcosa non presente nelle sezioni? Correggilo
3. RIPETIZIONI: stessa frase o concetto ripetuto? Eliminalo
4. TONO: linguaggio da tabloid o gossip? Rendilo professionale
5. KPI: valori plausibili e coerenti con il testo? Se sembrano inventati → [da verificare]
6. STRUTTURA: ogni sezione ha apertura/sviluppo/KPI/verdict? Completa se manca

Dopo la revisione restituisci il JSON corretto e migliorato. Stessa struttura dell'input.

${wikiContext}`;

    const editorPrompt = `Revisiona criticamente questa bozza e restituisci il JSON corretto:

${writerRaw}

CHECKLIST OBBLIGATORIA:
- [ ] L'opener è coerente con tutte e 3 le sezioni?
- [ ] Ogni KPI ha un valore realistico con fonte?
- [ ] Nessun dato inventato senza [dato da verificare]?
- [ ] Il verdict di ogni sezione risponde a "cosa significa per un investitore"?
- [ ] Nessuna ripetizione tra le sezioni?

Rispondi SOLO con il JSON corretto, stesso formato dell'input.`;

    const editorRaw = await callClaude([{ role: 'user', content: editorPrompt }], editorSystem);
    console.log('Editor completato, lunghezza:', editorRaw.length);

    // ── Parse finale ────────────────────────────────────────────────────────
    let generated;
    try {
      generated = parseJSON(editorRaw);
      console.log('Parse Editor: OK');
    } catch(e) {
      console.warn('Parse Editor fallito, uso Writer:', e.message);
      generated = parseJSON(writerRaw);
    }

    // ── Salva bozza ──────────────────────────────────────────────────────────
    await supabase.from('editions').update({
      title:    generated.title,
      subtitle: generated.subtitle || '',
      opener:   generated.opener || '',
      sections: generated.sections,
      date:     date || draft.date,
    }).eq('id', editionId);

    console.log(`Bozza #${draft.num} generata.`);
    return res.status(200).json({
      ok: true,
      id: editionId,
      title: generated.title
    });

  } catch (e) {
    console.error('[genera-edizione]', e);
    return res.status(500).json({ error: e.message });
  }
};
