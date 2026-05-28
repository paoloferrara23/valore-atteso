// scripts/content-agent.js — LinkedIn Content Agent v2
// Gira: giovedì 07:00 UTC (08:00 IT)
// Output: 3 bozze post LinkedIn ottimizzate per Paolo Ferrara

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
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const d = await r.json();
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function getPostHistory() {
  try {
    const posts = await supaFetch('/rest/v1/linkedin_posts?order=created_at.desc&limit=20&select=tipo,angolo,club,dato_chiave,hook');
    if (!Array.isArray(posts) || !posts.length) return 'Nessun post precedente.';
    return posts.map(p => `- [${p.tipo}] ${p.angolo}${p.club ? ' | Club: ' + p.club : ''}${p.dato_chiave ? ' | Dato: ' + p.dato_chiave : ''}`).join('\n');
  } catch(e) {
    console.warn('Storia post non disponibile:', e.message);
    return 'Nessun post precedente.';
  }
}

async function savePost(post) {
  try {
    await supaFetch('/rest/v1/linkedin_posts', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tipo: post.tipo,
        angolo: post.angolo,
        club: post.club || null,
        dato_chiave: post.dato_chiave || null,
        hook: post.testo?.split('\n')[0]?.slice(0, 100) || null,
        created_at: new Date().toISOString()
      })
    });
  } catch(e) {
    console.warn('Salvataggio post fallito:', e.message);
  }
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  console.log('Content Agent v2 avviato:', new Date().toISOString());

  // Leggi ultima edizione pubblicata
  const edizioni = await supaFetch('/rest/v1/editions?published=eq.true&order=num.desc&limit=1&select=*');
  const edizione = edizioni?.[0];
  if (!edizione) throw new Error('Nessuna edizione pubblicata trovata');
  console.log(`Edizione: #${edizione.num} — ${edizione.title}`);

  // Leggi storia post precedenti
  const storia = await getPostHistory();

  // Leggi scout brief per contesto settimana
  const scoutBrief = await memGet('scout_brief');
  const contestoScout = scoutBrief?.value?.brief_narrativo
    ? `\nCONTESTO SETTIMANA (Scout): ${scoutBrief.value.brief_narrativo}` : '';

  const sezioniEdizione = (edizione.sections || []).map(s =>
    `${s.label}: "${s.title}" — KPI: ${(s.kpis || []).map(k => `${k.label} ${k.value}`).join(', ')} — Verdict: ${s.verdict || ''}`
  ).join('\n');

  const system = `Sei il ghostwriter LinkedIn di Paolo Ferrara, M&A Manager e fondatore di Valore Atteso.

CHI È PAOLO:
- M&A Manager con background in sport advisory
- Fondatore di Valore Atteso, newsletter italiana sul business del calcio
- Parla come un professionista finance, non come un giornalista sportivo
- Tono: diretto, analitico, autorevole. Mai gossip, mai tifo.

TARGET LINKEDIN: professionisti M&A, PE, consulenza, finanza 28-45 anni Italia

OBIETTIVI (in ordine):
1. Iscritti alla newsletter (CTA principale)
2. Personal branding come esperto M&A/sport
3. Pipeline consulenza

REGOLE ASSOLUTE — VIOLAZIONE = POST INUTILIZZABILE:
1. USA SOLO dati presenti nell'edizione o nel brief Scout forniti sotto. MAI inventare numeri, date, risultati sportivi, classifiche, performance storiche.
2. Se non hai un dato verificato, usa un framework concettuale (es. "il wage ratio misura...") invece di un fatto specifico.
3. MAI citare: finali Champions, vittorie/sconfitte specifiche, stagioni sportive, trasferimenti, risultati di partite — a meno che non siano esplicitamente nei dati forniti.
4. Ogni numero nel post DEVE provenire dall'edizione o dal brief. Se non c'è il dato, non scriverlo.

STILE POST LINKEDIN:
1. HOOK (prima riga): deve fermare lo scroll. Max 12 parole. Usa dati dall'edizione, paradossi finanziari, o domande provocatorie. NON iniziare mai con "Oggi", "Ho pensato", "Vi racconto".
2. CORPO: 3-5 paragrafi brevi (max 3 righe ciascuno). Solo dati dall'edizione/Scout. Framework CF applicato al calcio. Spazi bianchi tra paragrafi.
3. CTA FINALE: sempre presente. Varia tra: "Link newsletter in bio", "Ti aspetto ogni martedì", "Iscriviti a Valore Atteso — link in bio", "Ne parlo nell'ultima edizione — link in bio"
4. HASHTAG: max 3, pertinenti, in fondo. Es. #calcioefinanza #mergersandacquisitions #sportsfinance
5. LUNGHEZZA: 150-250 parole totali. Mai oltre.
6. EMOJI: massimo 2, solo se aggiungono valore. Mai decorative.

FORMATI:
- TESTO PURO: per analisi, dati, domande retoriche
- CAROSELLO: solo per confronti multi-club o framework in 5+ step (indica "CAROSELLO" e dai le slide)

STORIA POST PRECEDENTI (NON ripetere angoli, dati o club già usati):
${storia}
${contestoScout}

Rispondi SOLO in JSON valido.`;

  const prompt = `Oggi è ${oggi}. Genera 3 bozze post LinkedIn per Paolo Ferrara.

EDIZIONE SETTIMANA (#${edizione.num} — ${edizione.title}):
${sezioniEdizione}

ATTENZIONE: usa SOLO i dati dell'edizione forniti sopra. Non aggiungere fatti storici, risultati sportivi o numeri che non siano presenti nei dati. Se un dato non è nei dati forniti, costruisci il post sul framework concettuale senza citare fatti specifici.

POST 1 — DATO SORPRENDENTE (dai dati dell'edizione):
Prendi il dato finanziario più impattante dai KPI o dal testo dell'edizione. Citalo esattamente come appare. Non aggiungere contesto storico non presente nei dati.
Formato: testo puro. CTA: iscrizione newsletter.

POST 2 — ANALISI CF EVERGREEN (framework concettuale):
Spiega un concetto di corporate finance applicato al calcio. Se usi un club come esempio, usa SOLO dati presenti nell'edizione o nel brief Scout. Se non hai dati su un club specifico, tratta il tema in modo generico senza citare club o stagioni specifiche.
Formato: testo puro o carosello (scegli tu). CTA: personal branding + newsletter.

POST 3 — DOMANDA RETORICA O CONFRONTO:
Una domanda che genera dibattito tra professionisti finance. Può essere astratta (es. "Quanto vale davvero un brand calcistico?") senza richiedere dati specifici.
Formato: testo puro. CTA leggera, non invasiva.

JSON:
{
  "posts": [
    {
      "tipo": "dato_sorprendente",
      "angolo": "descrizione breve dell'angolo (per memoria)",
      "club": "club citato o null",
      "dato_chiave": "il numero/dato principale",
      "formato": "testo_puro|carosello",
      "quando": "giorno e orario consigliato per pubblicare",
      "perche_ora": "motivazione editoriale (1 riga)",
      "testo": "testo completo del post pronto da copiare",
      "slide": ["slide1", "slide2"] // solo se carosello
    },
    { "tipo": "evergreen", ... },
    { "tipo": "domanda_retorica", ... }
  ]
}`;

  const raw = await callClaude([{ role: 'user', content: prompt }], system);
  const match = raw.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON non valido');

  let result;
  try {
    result = JSON.parse(match[0].replace(/[\x00-\x1F\x7F]/g, ' ').replace(/,(\s*[}\]])/g, '$1'));
  } catch(e) { throw new Error('Parse JSON fallito: ' + e.message); }

  const posts = result.posts || [];
  console.log(`Post generati: ${posts.length}`);

  // Salva in memoria
  for (const post of posts) await savePost(post);

  // ── Email HTML ────────────────────────────────────────────────────────────
  const tipoColors = {
    dato_sorprendente: ['#1B3A6B', '#E4ECF7', 'DATO SETTIMANA'],
    evergreen:         ['#1B4332', '#E4EDE7', 'EVERGREEN CF'],
    domanda_retorica:  ['#6B1B1B', '#F7E4E4', 'DOMANDA / CONFRONTO']
  };

  const postsHTML = posts.map((p, i) => {
    const [fg, bg, label] = tipoColors[p.tipo] || ['#4A4845', '#EDE9E0', 'POST'];
    const testoEsc = (p.testo || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const slideHTML = p.slide?.length ? `
      <div style="margin-top:12px;padding:10px 14px;background:#1A1A1A">
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#C8A97A;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Slide carosello</div>
        ${p.slide.map((s, si) => `<div style="font-family:Georgia,serif;font-size:11px;color:#FFFDF8;margin-bottom:6px;padding-left:8px;border-left:2px solid #C8A97A"><strong>${si+1}.</strong> ${s.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>`).join('')}
      </div>` : '';

    return `
    <div style="margin-bottom:20px;border:2px solid ${fg}">
      <div style="background:${fg};padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-family:'Courier New',monospace;font-size:9px;font-weight:700;color:#fff;letter-spacing:.1em">${label}</span>
        <span style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.6)">${p.formato?.replace('_',' ').toUpperCase() || 'TESTO'} · ${p.quando || ''}</span>
      </div>
      <div style="background:${bg};padding:10px 16px;border-bottom:1px solid ${fg}">
        <div style="font-family:'Courier New',monospace;font-size:9px;color:${fg}">Angolo: ${p.angolo || ''}</div>
        ${p.dato_chiave ? `<div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:${fg};margin-top:4px">${p.dato_chiave}</div>` : ''}
      </div>
      <div style="padding:14px 16px;background:#F5F2EB">
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Testo pronto da copiare</div>
        <div style="font-family:Georgia,serif;font-size:13px;color:#1A1A1A;line-height:1.7;white-space:pre-wrap">${testoEsc}</div>
        ${slideHTML}
      </div>
      <div style="padding:8px 16px;background:#EDE9E0;border-top:1px solid #D0CBC0">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;font-style:italic">${p.perche_ora || ''}</div>
      </div>
    </div>`;
  }).join('');

  const tipoConfig = {
    dato_sorprendente: { label: 'DATO SETTIMANA',       labelBg: '#1B3A6B', labelFg: '#fff' },
    evergreen:         { label: 'EVERGREEN CF',          labelBg: '#1B4332', labelFg: '#fff' },
    domanda_retorica:  { label: 'DOMANDA / CONFRONTO',  labelBg: '#6B1B1B', labelFg: '#fff' },
  };

  const html = agentEmail({
    agentName: 'Content Agent',
    agentKey: 'content',
    status: 'success',
    date: oggi,
    sections: [
      { type: 'narrative', label: 'Bozze da edizione', text: `<strong>#${edizione.num}</strong> — ${edizione.title}<br><span style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690">3 bozze pronte · usale quando vuoi, nell'ordine che vuoi</span>`, dark: true },
      ...posts.map(p => ({
        type: 'post_card',
        tipo: p.tipo,
        label: tipoConfig[p.tipo]?.label || 'POST',
        labelBg: tipoConfig[p.tipo]?.labelBg || '#1A1A1A',
        labelFg: tipoConfig[p.tipo]?.labelFg || '#fff',
        angolo: p.angolo,
        datoPrincipale: p.dato_chiave,
        testo: p.testo,
        quando: p.quando,
        perche: p.perche_ora,
        slide: p.slide,
      })),
    ]
  });

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM, to: APPROVAL_EMAIL,
      subject: `LinkedIn VA · 3 bozze pronte · ${edizione.title}`,
      html
    })
  });

  if (!emailRes.ok) throw new Error(`Resend: ${emailRes.status}`);

  await logRun('content-agent', 'success',
    `3 bozze LinkedIn generate da edizione #${edizione.num}`,
    { posts: posts.length, edizione: edizione.num },
    Date.now() - start
  );

  console.log(`Content Agent completato in ${Date.now()-start}ms.`);
}

main().catch(async e => {
  console.error('ERRORE Content Agent:', e.message);
  await logRun('content-agent', 'error', e.message).catch(() => {});
  process.exit(1);
});


