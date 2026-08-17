// scripts/factcheck-agent.js — Fact-Check Agent (barriera 3)
// Prende una bozza (edizione published=false), estrae ogni affermazione fattuale
// verificabile e la controlla con web search contro fonti reali. Scrive l'esito su
// editions.factcheck. Le contraddizioni diventano un blocker in lib/preflight, quindi
// impediscono l'invio finché non sono risolte.
//
// Selezione bozza (in ordine): env EDITION_ID > env EDITION_NUM > ultima bozza non pubblicata.
// Uso locale/manuale:  EDITION_NUM=016 node scripts/factcheck-agent.js

const { supaFetch, logRun } = require('./memory');
const { logUsage } = require('../lib/ai-usage');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const MODEL          = 'claude-opus-4-8';
const FROM           = 'Valore Atteso <info@valoreatteso.com>';
const SECTION_LABELS = ['Il Bilancio', 'Il Deal', 'La Metrica'];

// ── Chiamata Anthropic con web search ────────────────────────────────────────
async function callClaude(messages, system, useSearch = true, model = MODEL) {
  const body = { model, max_tokens: 5000, system, messages };
  if (useSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
    body.tool_choice = { type: 'auto' };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Anthropic ${r.status}: ${t.slice(0, 300)}`); }
  const data = await r.json();
  logUsage('factcheck', model, data.usage);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// Estrae l'ultimo array JSON dal testo (il modello prima cerca, poi conclude col JSON).
function extractJsonArray(text) {
  const cleaned = text.replace(/```json|```/g, '');
  let depth = 0, start = -1, last = null;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '[') { if (depth === 0) start = i; depth++; }
    else if (c === ']') { depth--; if (depth === 0 && start !== -1) last = cleaned.slice(start, i + 1); }
  }
  if (!last) throw new Error('Nessun array JSON nella risposta');
  return JSON.parse(last.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ').replace(/,(\s*[}\]])/g, '$1'));
}

// ── Carica la bozza da controllare ───────────────────────────────────────────
async function loadDraft() {
  let filter;
  if (process.env.EDITION_ID) filter = `id=eq.${process.env.EDITION_ID}`;
  else if (process.env.EDITION_NUM) filter = `num=eq.${String(process.env.EDITION_NUM).padStart(3, '0')}`;
  else filter = `published=eq.false`;
  const rows = await supaFetch(
    `/rest/v1/editions?${filter}&select=id,num,title,sections&order=created_at.desc&limit=1`
  );
  return Array.isArray(rows) ? rows[0] : null;
}

// ── Verifica una sezione ─────────────────────────────────────────────────────
async function checkSection(sec, label) {
  const body = Array.isArray(sec.body) ? sec.body.join('\n\n') : String(sec.body || '');
  const kpis = (sec.kpis || sec.kpi_rows || []).map(k => `${k.label}: ${k.value}${k.sub ? ' (' + k.sub + ')' : ''}`).join('; ');
  const sources = (sec.sources || []).join(' | ');

  const system = `Sei il Fact-Checker di Valore Atteso, newsletter finanziaria sul business del calcio.
Ti do UNA sezione di una bozza. Il tuo compito: estrarre OGNI affermazione fattuale verificabile e controllarla con web search contro fonti reali. NON fidarti del testo: verificalo davvero.

COSA ESTRARRE come claim distinti:
- ogni numero con il suo significato (ricavi, valutazioni, multipli, percentuali, prezzi, date, quote)
- ogni affermazione su COMPETIZIONE/STAGIONE di un club (es. "il club X gioca la Champions 2026/27"): è la classe di errore più frequente, verificala sempre
- ogni attribuzione di fonte (es. "secondo Sportico...")
- ogni nome proprio associato a un ruolo/fatto (persone, fondi, società)

GERARCHIA FONTI per la verifica:
- Tier 1 (primarie): bilanci e comunicati ufficiali dei club, filing di borsa, UEFA/FIFA/FIGC/leghe, report Deloitte/KPMG/PwC.
- Tier 2 (autorevoli): Reuters, FT, Bloomberg, The Athletic, BBC, Sportico, SportsPro.
- Calcio e Finanza e Transfermarkt sono ammesse come RISCONTRO, ma per le cifre di mercato non devono essere l'unica prova: cerca conferma altrove.
- Blog di tifosi, forum, aggregatori di rumor: non valgono come prova.

REGOLE DI GIUDIZIO (sii conservativo):
- "VERIFIED": trovi riscontro chiaro su fonte affidabile.
- "CONTRADICTED": una fonte affidabile dà un valore diverso. Indica il valore corretto in "correct" e la fonte in "source".
- "UNVERIFIABLE": non trovi riscontro affidabile. NON marcare VERIFIED per fiducia nel testo.
- "severity": "high" se il claim è centrale (cifra chiave, competizione/stagione, nome dell'operazione) o se sbagliato comprometterebbe il pezzo; "low" se marginale.
- Le stime dichiarate tali nel testo (es. "IRR implicito ~18%") non sono errori se il calcolo è coerente: valutane la ragionevolezza, non pretendere una fonte puntuale.

Concludi SEMPRE con SOLO un array JSON valido (niente altro testo dopo), max 12 claim, i più importanti:
[{"claim":"...","type":"number|competition|attribution|date|entity","status":"VERIFIED|CONTRADICTED|UNVERIFIABLE","found":"cosa dicono le fonti","correct":"valore corretto se CONTRADICTED, altrimenti null","source":"testata + url","severity":"high|low"}]`;

  const user = `SEZIONE "${label}" — titolo: ${sec.title || ''}

CORPO:
${body}

KPI: ${kpis || '(nessuno)'}
FONTI DICHIARATE: ${sources || '(nessuna)'}

Verifica ogni affermazione con web search e concludi con l'array JSON.`;

  let text;
  try {
    text = await callClaude([{ role: 'user', content: user }], system, true);
  } catch (e) {
    console.error(`[${label}] errore chiamata:`, e.message);
    return [{ claim: `Verifica sezione ${label} non riuscita`, type: 'entity', status: 'UNVERIFIABLE', found: e.message, correct: null, source: '', severity: 'low' }];
  }

  try {
    return extractJsonArray(text);
  } catch (e) {
    // Retry: chiedi solo il JSON, senza search
    try {
      const retry = await callClaude(
        [{ role: 'user', content: user }, { role: 'assistant', content: text }, { role: 'user', content: 'Rispondi SOLO con l\'array JSON dei claim, nessun altro testo.' }],
        system, false
      );
      return extractJsonArray(retry);
    } catch (e2) {
      console.error(`[${label}] JSON non parsabile:`, e2.message);
      return [{ claim: `Output non strutturato per ${label}`, type: 'entity', status: 'UNVERIFIABLE', found: text.slice(0, 200), correct: null, source: '', severity: 'low' }];
    }
  }
}

// ── Email di alert solo se ci sono contraddizioni ────────────────────────────
async function sendAlert(edition, factcheck) {
  if (!RESEND_KEY || !APPROVAL_EMAIL || !factcheck.contradictions.length) return;
  const rows = factcheck.contradictions.map(c =>
    `<tr><td style="padding:10px 14px;border-bottom:1px solid #E2DDD4;font-family:Georgia,serif;font-size:13px;color:#1A1A1A">
      <div style="font-weight:700">${c.section}</div>
      <div style="color:#8E2B2B;margin:4px 0">${c.claim}</div>
      <div style="font-size:12px;color:#4A4845">Corretto: <b>${c.correct || 'n/d'}</b>${c.source ? ' · ' + c.source : ''}</div>
    </td></tr>`).join('');
  const html = `<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif">
    <div style="background:#1C1914;color:#E8C87A;padding:18px 20px;font-family:'Courier New',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase">Fact-Check · #${edition.num}</div>
    <div style="padding:18px 20px;background:#F0EBE1;color:#1A1A1A;font-size:14px">
      Trovate <b>${factcheck.contradictions.length}</b> contraddizioni nella bozza <b>#${edition.num}</b>. L'invio è bloccato finché non le risolvi.
    </div>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#F7F4EF">${rows}</table>
    <div style="padding:14px 20px;font-family:'Courier New',monospace;font-size:10px;color:#9A9690">Verificate ${factcheck.totals.claims} affermazioni: ${factcheck.totals.verified} ok, ${factcheck.totals.contradicted} smentite, ${factcheck.totals.unverifiable} non verificabili.</div>
  </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Fact-Check #${edition.num}: ${factcheck.contradictions.length} da correggere`, html })
    });
  } catch (e) { console.warn('Alert email fallita:', e.message); }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY mancante');

  const edition = await loadDraft();
  if (!edition) throw new Error('Nessuna bozza da controllare');
  const sections = Array.isArray(edition.sections) ? edition.sections : [];
  if (!sections.length) throw new Error(`Edizione #${edition.num} senza sezioni`);

  console.log(`Fact-Check #${edition.num} — ${sections.length} sezioni`);

  const perSection = await Promise.all(
    sections.map((sec, i) => checkSection(sec, sec.label || SECTION_LABELS[i] || `Sezione ${i + 1}`)
      .then(claims => ({ label: sec.label || SECTION_LABELS[i] || `Sezione ${i + 1}`, claims })))
  );

  const allClaims = perSection.flatMap(s => s.claims.map(c => ({ ...c, section: s.label })));
  const contradicted = allClaims.filter(c => c.status === 'CONTRADICTED');
  const unverifiable = allClaims.filter(c => c.status === 'UNVERIFIABLE');
  const verified = allClaims.filter(c => c.status === 'VERIFIED');

  const factcheck = {
    checked_at: new Date().toISOString(),
    model: MODEL,
    status: contradicted.length ? 'contradictions' : (unverifiable.length ? 'unverifiable_present' : 'clean'),
    totals: { claims: allClaims.length, verified: verified.length, contradicted: contradicted.length, unverifiable: unverifiable.length },
    contradictions: contradicted.map(c => ({ section: c.section, claim: c.claim, correct: c.correct, source: c.source })),
    sections: perSection,
  };

  await supaFetch(`/rest/v1/editions?id=eq.${edition.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ factcheck })
  });

  await sendAlert(edition, factcheck);

  const summary = `#${edition.num}: ${factcheck.totals.claims} claim — ${verified.length} ok, ${contradicted.length} smentiti, ${unverifiable.length} non verificabili. Stato: ${factcheck.status}.`;
  await logRun('factcheck', contradicted.length ? 'contradictions' : 'success', summary, factcheck, Date.now() - start);
  console.log(summary);
}

main().catch(async e => {
  console.error('ERRORE Fact-Check:', e.message);
  await logRun('factcheck', 'error', e.message).catch(() => {});
  process.exit(1);
});
