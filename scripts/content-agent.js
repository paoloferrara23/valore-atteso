// scripts/content-agent.js — Content Agent v3
// Gira: giovedì 08:00 IT (07:00 UTC)
// Output: calendario social settimanale (Instagram + LinkedIn) basato su edizione + Scout brief
// Usa il prompt Sonnet Adapter ufficiale di Valore Atteso

const { memGet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function supaFetch(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function callClaude(messages, system, model = 'claude-sonnet-4-6') {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: 6000, system, messages })
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const d = await r.json();
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ── PROMPT SONNET ADAPTER UFFICIALE ─────────────────────────────────────────
const SONNET_SYSTEM = `Sei il Social Media Strategist di Valore Atteso.

Valore Atteso è una newsletter italiana gratuita sul business del calcio europeo.
Tagline: "Il calcio dei numeri, non dei goal."
Tono: autorevole, analitico, diretto, premium. Stile The Economist applicato al calcio.
Zero gossip. Zero tifo. Zero emoji.

INSTAGRAM CAPTION:
- Italiano
- Max 120-150 parole
- Frasi brevi
- Un solo insight centrale
- Non sembrare marketing
- Chiudere con: "Il calcio dei numeri, non dei goal."
- Hashtag fissi: #valoreatteso #newsletter #footballbusiness #finanzasportiva #privateequity
- Se tema club specifico: aggiungi 1 hashtag club (es. #Juventus, #Inter)
- Non usare "leggi l'articolo completo"
- Usare "valoreatteso.com" solo se richiesto

LINKEDIN POST:
- Italiano
- 120-180 parole
- Più professionale della caption IG
- Apertura con insight forte
- Spiegare perché il dato è rilevante per business, finanza, media rights, governance o M&A
- Chiusura: "Ogni martedì, con il caffè, 8 minuti sul business del calcio europeo.\nvaloreatteso.com"
- Max 3 hashtag: #footballbusiness #sportsbusiness #corporatefinance
- No emoji
- No tono da creator
- No "link nei commenti" salvo istruzione specifica

VISUAL INSTAGRAM (1080x1350 px, 4:5):
Palette: Crema #F0EBE1 | Nero #1C1914 | Oro #C8A97A | Grigio caldo #6E675F
Logo: "VA" serif bold + linea verticale oro + "Valore Atteso" — solo in alto a sinistra
Immagini: stadi, coppe, architetture, skyline finanziari — B&N o seppia desaturato
Regole: un solo dato principale, un solo messaggio, poco testo, aspetto da rivista finanziaria premium
No calciatori in primo piano, no tifosi, no meme, no infografiche dense

Rispondi SEMPRE e SOLO in JSON valido senza markdown.`;

// ── GENERA POST PER UN TEMA SPECIFICO ───────────────────────────────────────
async function generaPost(tema, contesto, tipo) {
  const prompt = `Tipo post: ${tipo}
Tema: ${tema}
Contesto editoriale: ${contesto}

Genera il post per questo tema specifico. Rispondi SOLO in JSON:
{
  "instagram_caption": "...",
  "linkedin_post": "...",
  "visual": {
    "format": "1080x1350",
    "layout_type": "black_statement | cream_black_split | magazine_cover | carousel",
    "label": "...",
    "main_number": "...",
    "headline": "...",
    "subheadline": "...",
    "microcopy": "...",
    "footer": "Il calcio dei numeri, non dei goal.",
    "image_direction": "...",
    "avoid": ["logo in basso a destra", "calciatori", "emoji", "fonti nel visual", "troppo testo"]
  }
}`;

  const raw = await callClaude([{ role: 'user', content: prompt }], SONNET_SYSTEM);
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON non trovato nella risposta');
  return JSON.parse(match[0]);
}

// ── GENERA CALENDARIO SETTIMANALE ───────────────────────────────────────────
async function generaCalendario(edizione, scoutBrief) {
  const sezioni = (edizione.sections || []).map(s =>
    `${s.label}: ${s.title}\n${(s.body || '').slice(0, 300)}`
  ).join('\n\n');

  const temiScout = scoutBrief ?
    `Temi Scout della settimana: ${JSON.stringify(scoutBrief).slice(0, 500)}` : '';

  const prompt = `Edizione pubblicata:
Titolo: ${edizione.title}
${sezioni}

${temiScout}

Genera un calendario social settimanale con 4 post:
1. TEASER (lunedì prima dell'uscita) — anticipazione del tema principale
2. LANCIO (martedì — giorno uscita newsletter) — post principale sull'edizione
3. APPROFONDIMENTO (giovedì) — un dato o angolo specifico dell'edizione
4. SCOUT PREVIEW (sabato) — anticipazione tema prossima settimana da Scout brief

Per ogni post specifica: giorno, tipo, tema, instagram_caption, linkedin_post, visual.

Rispondi SOLO in JSON:
{
  "calendario": [
    {
      "giorno": "Lunedì",
      "data_relativa": "Giorno -1",
      "tipo": "TEASER",
      "tema": "...",
      "instagram_caption": "...",
      "linkedin_post": "...",
      "visual": {
        "format": "1080x1350",
        "layout_type": "...",
        "label": "...",
        "main_number": "...",
        "headline": "...",
        "subheadline": "...",
        "footer": "Il calcio dei numeri, non dei goal.",
        "image_direction": "...",
        "avoid": ["logo in basso a destra", "calciatori", "emoji"]
      }
    }
  ]
}`;

  const raw = await callClaude([{ role: 'user', content: prompt }], SONNET_SYSTEM, 'claude-opus-4-8');
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON calendario non trovato');
  return JSON.parse(match[0]);
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  console.log('Content Agent v3 avviato:', new Date().toISOString());

  // Leggi ultima edizione pubblicata
  const eds = await supaFetch('/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=*');
  if (!Array.isArray(eds) || !eds.length) throw new Error('Nessuna edizione pubblicata trovata');
  const edizione = eds[0];
  console.log('Edizione:', edizione.num, edizione.title);

  // Leggi Scout brief per preview prossima settimana
  let scoutBrief = null;
  try {
    const mem = await supaFetch('/rest/v1/agent_memory?key=eq.scout_brief&select=value');
    scoutBrief = mem?.[0]?.value || null;
  } catch(e) { console.warn('Scout brief non disponibile'); }

  // Genera calendario settimanale
  console.log('Generazione calendario settimanale...');
  const calendario = await generaCalendario(edizione, scoutBrief);
  const posts = calendario.calendario || [];

  // Salva calendario in Supabase (agent_memory)
  await supaFetch('/rest/v1/agent_memory', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      key: 'social_calendario',
      value: {
        edition_num: edizione.num,
        edition_title: edizione.title,
        generato: new Date().toISOString(),
        posts
      },
      updated_at: new Date().toISOString()
    })
  });

  // Aggiorna social_content con il post di lancio (martedì)
  const postLancio = posts.find(p => p.tipo === 'LANCIO') || posts[1] || posts[0];
  if (postLancio) {
    try {
      await supaFetch('/rest/v1/social_content', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          edition_num: edizione.num,
          edition_id: edizione.id,
          instagram_caption: postLancio.instagram_caption,
          linkedin_post: postLancio.linkedin_post,
          visual: postLancio.visual,
          created_at: new Date().toISOString()
        })
      });
    } catch(e) { console.warn('social_content update fallito:', e.message); }
  }

  // Prepara email con calendario completo
  const calRows = posts.map(p => [
    { value: p.giorno, bold: true },
    { value: p.tipo, mono: true, color: '#C8A97A' },
    { value: p.tema }
  ]);

  const sections = [
    {
      type: 'dark_cards',
      label: 'Edizione di riferimento',
      cards: [
        { label: 'Numero', value: `#${edizione.num}`, labelColor: '#9A9690', valueColor: '#C8A97A' },
        { label: 'Post generati', value: String(posts.length), labelColor: '#9A9690', valueColor: '#C8A97A' }
      ]
    },
    {
      type: 'table',
      label: 'Calendario settimanale',
      headers: [{ label: 'Giorno' }, { label: 'Tipo' }, { label: 'Tema' }],
      rows: calRows
    }
  ];

  // Aggiungi preview di ogni post
  posts.forEach(p => {
    sections.push({
      type: 'narrative',
      label: `${p.giorno} — ${p.tipo}`,
      text: `📸 INSTAGRAM\n${p.instagram_caption?.slice(0, 200)}...\n\n💼 LINKEDIN\n${p.linkedin_post?.slice(0, 200)}...`
    });
  });

  const html = agentEmail({
    agentName: 'Content Agent',
    agentKey: 'content',
    status: 'success',
    date: oggi,
    runTime: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    sections
  });

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM,
      to: APPROVAL_EMAIL,
      subject: `📱 Content VA · Calendario settimana · ${oggi}`,
      html
    })
  });

  await logRun('content', 'success',
    `Calendario ${posts.length} post generato per edizione #${edizione.num}`,
    { edition_num: edizione.num, posts_count: posts.length },
    Date.now() - start
  );

  console.log('Content Agent v3 completato. Post generati:', posts.length);
}

main().catch(async err => {
  console.error('Content Agent errore:', err.message);
  await logRun('content', 'error', err.message, {}, 0).catch(() => {});
  process.exit(1);
});
