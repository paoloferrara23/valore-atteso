// agent.js — Genera edizione leggendo i temi dello Scout
// Gira: lunedì 8:00 | Legge: scout_brief, scout_themes, seo_keywords

const { memGet, memSet, logRun } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;
const SITE = 'https://valore-atteso.vercel.app';
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function callClaude(messages, system) {
  const r = await httpRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4000, system, messages })
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.text}`);
  const data = r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function getNextEditionNum() {
  const r = await fetch(`${SUPA_URL}/rest/v1/editions?select=num&published=eq.true&order=num.desc&limit=1`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  const rows = await r.json();
  return rows[0] ? String(parseInt(rows[0].num) + 1).padStart(3, '0') : '001';
}

async function main() {
  const start = Date.now();
  console.log('Editoriale Agent avviato:', new Date().toISOString());

  // Legge memoria condivisa
  const scoutBrief = await memGet('scout_brief');
  const seoKeywords = await memGet('seo_keywords');

  let temiContext = '';
  if (scoutBrief) {
    const brief = scoutBrief.value;
    temiContext = `\n\nLO SCOUT HA TROVATO QUESTI TEMI (aggiornati ${scoutBrief.updated_at}):\n` +
      JSON.stringify(brief.temi, null, 2) +
      `\n\nTEMA CONSIGLIATO DALLO SCOUT: ${brief.tema_consigliato}` +
      (brief.note_editoriali ? `\nNOTE EDITORIALI: ${brief.note_editoriali}` : '');
    console.log('Temi Scout caricati:', brief.temi?.length);
  } else {
    console.log('Nessun brief Scout disponibile, procedo in autonomia');
  }

  let seoContext = '';
  if (seoKeywords) {
    seoContext = `\n\nKEYWORD SEO DA PRESIDIARE (SEO Agent):\n${JSON.stringify(seoKeywords.value, null, 2)}`;
    console.log('Keyword SEO caricate');
  }

  const editionNum = await getNextEditionNum();
  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

  const system = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio.
Ogni edizione ha 3 sezioni fisse: Il Bilancio, Il Deal, La Metrica.
Tono: analitico, diretto, dati verificabili, nessun gossip.
Pubblico: professionisti M&A, PE, consulenza, finanza.

REGOLA ASSOLUTA — USA SOLO I DATI DELLO SCOUT:
- Ogni numero, dato finanziario, statistica DEVE provenire dai temi che lo Scout ha trovato con web search
- Se lo Scout non ha trovato un dato specifico, NON inventarlo — scrivi solo quello che è nei temi Scout
- VIETATO usare dati dalla memoria di Claude: il training data è spesso obsoleto e non verificato
- VIETATO inventare fonti: ogni fonte nel campo "sources" deve essere una di quelle trovate dallo Scout
- Se non hai abbastanza dati verificati per una sezione, semplifica il testo piuttosto che inventare numeri
- Il campo "sources" deve contenere SOLO le fonti reali citate nei temi Scout, con nome testata + data

CONSEGUENZE DELL'INVENZIONE DI DATI:
- Dati sbagliati pubblicati a professionisti M&A e PE distruggono la credibilità di Valore Atteso
- È preferibile un'analisi più breve con 3 dati certi che un'analisi lunga con 10 dati inventati
${temiContext}
${seoContext}

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
    { "label": "Il Deal", ... },
    { "label": "La Metrica", ... }
  ]
}`;

  const testo = await callClaude([{
    role: 'user',
    content: `Genera l'edizione #${editionNum} di Valore Atteso per ${oggi}.

IMPORTANTE: usa ESCLUSIVAMENTE i dati e le fonti presenti nei temi dello Scout qui sopra.
Non aggiungere dati dalla tua memoria. Non inventare fonti.
Se un dato non è nei temi Scout, non includerlo.
Le fonti nel campo "sources" devono essere SOLO quelle citate nei temi Scout.`
  }], system);

  let edition;
  try {
    const match = testo.match(/\{[\s\S]*\}/);
    edition = JSON.parse(match[0]);
  } catch {
    throw new Error('JSON edizione non valido');
  }

  // Salva bozza su Supabase (non pubblicata)
  const saveRes = await fetch(`${SUPA_URL}/rest/v1/editions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ ...edition, published: false, tags: edition.sections.map(s => s.label) })
  });
  const saved = await saveRes.json();
  const editionId = saved[0]?.id;

  // Salva in memoria condivisa
  await memSet('last_draft', { id: editionId, num: editionNum, title: edition.title, date: oggi }, 'editoriale');

  // Email di approvazione
  const secsHTML = edition.sections.map((s, i) => `
    <div style="padding:16px 24px;border-bottom:1px solid #D0CBC0">
      <div style="font-family:'Courier New',monospace;font-size:8px;color:#C8251D;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px">0${i+1} · ${s.label}</div>
      <div style="font-family:Georgia,serif;font-size:15px;font-weight:700;margin-bottom:8px">${s.title}</div>
      <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.7">${s.body}</div>
      ${s.kpis?.length ? `<table style="width:100%;margin-top:10px;font-family:'Courier New',monospace;font-size:10px;border-collapse:collapse">
        <tr style="background:#1A1A1A"><td colspan="2" style="padding:7px 10px;font-size:9px;color:#fff;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Dati chiave</td></tr>
        ${s.kpis.map((k,i) => `<tr style="background:${i%2===0?'#F5F2EB':'#EDE9E0'}"><td style="padding:7px 10px;color:#4A4845;font-size:11px">${k.key}</td><td style="padding:7px 10px;text-align:right;color:#111;font-weight:900;font-size:12px">${k.value}</td></tr>`).join('')}
      </table>` : ''}
      <div style="margin-top:10px">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px">Il verdetto</div>
        <div style="font-family:Georgia,serif;font-size:13px;color:#C8251D;font-style:italic">→ ${s.verdict}</div>
      ${s.sources?.length ? `<div style="margin-top:10px;padding:8px 12px;background:#F5F2EB;border-left:2px solid #D0CBC0">
        <span style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.1em;text-transform:uppercase">Fonti: </span>
        <span style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690">${s.sources.join(' · ')}</span>
      </div>` : ''}
      </div>
    </div>`).join('');

  const approveUrl = `${SITE}/approva.html?id=${editionId}`;
  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB">
      <tr><td style="padding:20px 24px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">Editoriale Agent · Bozza #${editionNum}</div>
      </td></tr>
      ${scoutBrief ? `<tr><td style="padding:10px 24px;background:#E4EDE7;border-bottom:1px solid #D0CBC0"><div style="font-family:'Courier New',monospace;font-size:9px;color:#1B4332">Generata dai temi dello Scout del ${new Date(scoutBrief.updated_at).toLocaleDateString('it-IT')}</div></td></tr>` : ''}
      <tr><td style="padding:14px 24px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
        <div style="font-family:Georgia,serif;font-size:18px;font-weight:900">${edition.title}</div>
        <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;font-style:italic;margin-top:4px">${edition.opener}</div>
      </td></tr>
      ${secsHTML}
      <tr><td style="padding:20px 24px;text-align:center;border-top:2px solid #1A1A1A">
        <a href="${approveUrl}" style="background:#C8251D;color:#fff;padding:14px 32px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Approva e pubblica →</a>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin-top:12px">Clicca per approvare, pubblicare e inviare a tutti gli iscritti</div>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Approva VA #${editionNum}: ${edition.title}`, html })
  });

  await logRun('editoriale', 'success', `Bozza #${editionNum} generata: ${edition.title}`, { editionId, num: editionNum }, Date.now() - start);
  console.log('Editoriale Agent completato. Bozza:', editionNum);
}

main().catch(async e => {
  console.error('ERRORE Editoriale:', e.message);
  await logRun('editoriale', 'error', e.message).catch(() => {});
  process.exit(1);
});
