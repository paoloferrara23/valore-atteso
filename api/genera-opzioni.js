// api/genera-opzioni.js — Genera 3 opzioni per sezione (auto da Scout o tematiche manuali)
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

async function callClaude(messages, system) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, system, messages })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Anthropic: ${r.status} ${t}`); }
  const data = await r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  if (req.headers['x-cr-token'] !== CR_TOKEN) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const { hint, editionNum, oggi, tematiche } = req.body;
    let customSections = req.body.custom_sections || null;

    // Leggi Scout e SEO dalla memoria
    const [scoutRow, seoRow, selRow] = await Promise.all([
      supabase.from('agent_memory').select('value,updated_at').eq('key', 'scout_brief').single(),
      supabase.from('agent_memory').select('value').eq('key', 'seo_keywords').single(),
      supabase.from('agent_memory').select('value,updated_at').eq('key', 'scout_selezione').single()
    ]);
    const scout = scoutRow.data?.value;
    const seo = seoRow.data?.value;
    // Selezione fatta da Paolo dalla pagina scout-select.html
    const scoutSel = selRow.data?.value;

    let contextBlock = '';
    let modeLabel = '';

    if (tematiche) {
      // MODALITÀ MANUALE: tematiche libere da Paolo
      modeLabel = 'tematiche manuali';
      contextBlock = `
TEMATICHE INSERITE DALL'EDITORE (obbligatorie — non cambiarle):
- IL BILANCIO: "${tematiche.bilancio}"
- IL DEAL: "${tematiche.deal}"
- LA METRICA: "${tematiche.metrica}"

Per ognuna genera 3 angoli diversi di analisi (non 3 temi diversi — il tema è fisso).
Devi variare l'angolo: es. per il Bilancio puoi avere angolo "ricavi", angolo "debito", angolo "player trading".
${hint ? `NOTA EDITORIALE: ${hint}` : ''}`;
    } else {
      // MODALITÀ AUTO: Scout + SEO
      modeLabel = 'automatico da Scout';
      const validSelection = scout
        && scoutSel?.stato === 'approved'
        && scout.brief_id
        && scout.brief_id === scoutSel.brief_id
        && scoutSel.temi?.bilancio
        && scoutSel.temi?.deal
        && scoutSel.temi?.metrica;
      if (!validSelection) {
        return res.status(409).json({ error: 'Nessuna selezione Scout valida per il brief corrente. Conferma prima i tre temi dal link Scout.' });
      }
      if (scout) {
        contextBlock += `\nTEMI SCOUT (aggiornati ${scoutRow.data?.updated_at?.slice(0,10)}):\n`;
        contextBlock += JSON.stringify(scoutSel.temi, null, 2);
        if (scout.tema_consigliato) contextBlock += `\nTEMA CONSIGLIATO: ${scout.tema_consigliato}`;
        if (scout.note_editoriali) contextBlock += `\nNOTE: ${scout.note_editoriali}`;
      } else {
        contextBlock = '\nNessun brief Scout disponibile — usa notizie recenti del calcio europeo (Serie A, Premier, Liga, Bundesliga, Ligue 1).';
      }
      if (seo?.keywords) contextBlock += `\nKEYWORD SEO: ${seo.keywords.slice(0,5).join(', ')}`;
      if (hint) contextBlock += `\nHINT EDITORIALE: ${hint}`;
      customSections = {
        bilancio: scoutSel.temi.bilancio.titolo || scoutSel.temi.bilancio.custom,
        deal: scoutSel.temi.deal.titolo || scoutSel.temi.deal.custom,
        metrica: scoutSel.temi.metrica.titolo || scoutSel.temi.metrica.custom,
        ...(customSections || {})
      };
      contextBlock += `\n\nTEMI SELEZIONATI DA PAOLO (obbligatori: genera 3 angoli diversi per ogni tema, non sostituire i temi):
- IL BILANCIO: "${customSections.bilancio}"
- IL DEAL: "${customSections.deal}"
- LA METRICA: "${customSections.metrica}"`;
    }

    const system = `Sei il redattore senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Pubblico: professionisti M&A, PE, consulenza, finanza. Tono: analitico, diretto, dati verificabili — e soprattutto CHIARO E SEMPLICE (il tratto distintivo di Valore Atteso: si capisce in 8 minuti). Frasi brevi, niente gergo non spiegato, semplice senza essere superficiale.

REGOLE ASSOLUTE:
1. Ogni dato/numero DEVE avere una fonte reale (bilancio club, comunicato ufficiale, UEFA, Deloitte, calcioefinanza.it, SwissRamble, FT, Reuters)
2. VIETATO inventare dati, multipli o statistiche
3. Se non hai dati sufficienti per un tema, dillo nel source: "dati parziali — da verificare"
4. Ogni opzione deve avere un angolo editoriale chiaro (cosa rende questo tema interessante per un professionista finance?)

${contextBlock}

Rispondi SOLO in JSON valido:
{
  "section_options": {
    "bilancio": [
      {"title": "titolo editoriale preciso","summary": "2-3 righe: angolo di analisi, perché è rilevante ora, cosa si può misurare","kpi_preview": ["metrica1: valore","metrica2: valore"],"source": "fonte principale verificabile","angolo": "es. redditività / indebitamento / player trading"},
      {...opzione 2...},
      {...opzione 3...}
    ],
    "deal": [...3 opzioni...],
    "metrica": [...3 opzioni...]
  }
}`;

    const testo = await callClaude([{
      role: 'user',
      content: `Genera le opzioni editoriali per l'edizione #${editionNum} di Valore Atteso (${oggi}).
Modalità: ${modeLabel}.
Per ogni sezione proponi 3 opzioni con angoli diversi. Solo dati verificabili e fonti reali.`
    }], system);

    let opts;
    try {
      const match = testo.match(/\{[\s\S]*\}/);
      opts = JSON.parse(match[0]);
    } catch { throw new Error('JSON non valido dalla AI'); }

    // Salva bozza su Supabase
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
