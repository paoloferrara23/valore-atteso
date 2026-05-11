// api/genera-edizione.js — Genera edizione newsletter via Vercel (usa ANTHROPIC_KEY dal server)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const SUPA_URL = 'https://xxnmkiwnjpppfzrftvuv.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bm1raXduanBwcGZ6cmZ0dnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MTkwNTUsImV4cCI6MjA5MTk5NTA1NX0.2EePZNm_OCc9WscYSG7CL_mbFV6E8ifwV9sP2WxkUo4';

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY non configurata su Vercel' });
  }

  const { hint, mode, editionNum, oggi } = req.body || {};

  // Legge temi Scout e SEO da Supabase
  let temiContext = '';
  let seoContext = '';
  try {
    const memR = await fetch(`${SUPA_URL}/rest/v1/agent_memory?key=in.(scout_brief,seo_keywords)&select=key,value,updated_at`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    const mem = await memR.json();
    if (Array.isArray(mem)) {
      const scout = mem.find(m => m.key === 'scout_brief');
      const seo = mem.find(m => m.key === 'seo_keywords');
      if (scout) {
        temiContext = `\n\nTEMI TROVATI DALLO SCOUT (aggiornati ${scout.updated_at}):\n` + JSON.stringify(scout.value, null, 2);
      }
      if (seo) {
        seoContext = `\n\nKEYWORD SEO:\n` + JSON.stringify(seo.value, null, 2);
      }
    }
  } catch(e) {
    console.error('Errore lettura memoria Scout:', e.message);
  }

  const hintText = hint ? `\n\nHINT EDITORIALE: ${hint}` : '';

  const system = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio.
Ogni edizione ha 3 sezioni fisse: Il Bilancio, Il Deal, La Metrica.
Tono: analitico, diretto, dati verificabili, nessun gossip.
Pubblico: professionisti M&A, PE, consulenza, finanza.

REGOLA ASSOLUTA — USA SOLO I DATI DELLO SCOUT:
- Ogni numero, dato finanziario, statistica DEVE provenire dai temi che lo Scout ha trovato con web search
- Se lo Scout non ha trovato un dato specifico, NON inventarlo
- VIETATO usare dati dalla memoria di Claude: il training data è spesso obsoleto
- VIETATO inventare fonti: ogni fonte nel campo "sources" deve essere una di quelle trovate dallo Scout
- Se non hai abbastanza dati verificati per una sezione, semplifica il testo piuttosto che inventare numeri
- Il campo "sources" deve contenere SOLO le fonti reali citate nei temi Scout, con nome testata + data
${temiContext}
${seoContext}
${hintText}

Rispondi SOLO in JSON valido:
{
  "num": "${editionNum}",
  "title": "titolo principale edizione",
  "subtitle": "sottotitolo",
  "date": "${oggi}",
  "opener": "frase di apertura 2-3 righe",
  "sections": [
    {
      "label": "Il Bilancio",
      "title": "titolo sezione",
      "body": "corpo testo 150-200 parole con SOLO dati dallo Scout",
      "kpis": [{"key": "metrica", "value": "valore verificato dallo Scout"}],
      "verdict": "verdetto finale",
      "sources": ["fonte esatta dallo Scout — testata — data"]
    },
    {
      "label": "Il Deal",
      "title": "titolo sezione",
      "body": "corpo testo 150-200 parole",
      "kpis": [{"key": "metrica", "value": "valore"}],
      "verdict": "verdetto finale",
      "sources": ["fonte esatta dallo Scout — testata — data"]
    },
    {
      "label": "La Metrica",
      "title": "titolo sezione",
      "body": "corpo testo 150-200 parole",
      "kpis": [{"key": "metrica", "value": "valore"}],
      "verdict": "verdetto finale",
      "sources": ["fonte esatta dallo Scout — testata — data"]
    }
  ],
  "tags": ["tag1", "tag2", "tag3"]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 3000,
        system,
        messages: [{
          role: 'user',
          content: `Genera l'edizione #${editionNum} di Valore Atteso per ${oggi}. Usa ESCLUSIVAMENTE i dati e le fonti presenti nei temi dello Scout. Non aggiungere dati dalla tua memoria. Non inventare fonti.`
        }]
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: `Anthropic error: ${r.status}`, detail: err });
    }

    const data = await r.json();
    const testo = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // Pulisce e parsea JSON
    let raw = testo.replace(/```json|```/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'JSON non valido dalla risposta' });

    let json = match[0];
    json = json.replace(/[\x00-\x1F\x7F]/g, ' ');
    json = json.replace(/,(\s*[}\]])/g, '$1');

    const edition = JSON.parse(json);
    return res.status(200).json({ ok: true, edition });

  } catch(e) {
    console.error('Errore genera-edizione:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
