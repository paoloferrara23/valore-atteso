// scripts/agent.js — Editoriale Agent v3 — pipeline 3 fasi: KPI lock → Writer → Validator
const { memGet, memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const RESEND_KEY     = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL       = process.env.SUPABASE_URL;
const SUPA_KEY       = process.env.SUPABASE_KEY;
const SITE           = 'https://valoreatteso.com';
const FROM           = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function callClaude(messages, system, model = 'claude-sonnet-4-6', maxTokens = 2500) {
  const r = await httpRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.text}`);
  const data = r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function supaGet(path) {
  return httpRequest(`${SUPA_URL}${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
}

async function supaPatch(path, body) {
  return httpRequest(`${SUPA_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body)
  });
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

// ── Wiki context da Supabase ──────────────────────────────────────────────────
async function getWikiContext() {
  try {
    const r = await supaGet('/rest/v1/editorial_wiki?select=categoria,chiave,valore&order=categoria.asc');
    if (!r.ok) return '';
    const rows = r.json();
    if (!rows?.length) return '';
    const stile    = rows.filter(r => r.categoria === 'stile').map(r => `• ${r.chiave}: ${r.valore}`).join('\n');
    const edizioni = rows.filter(r => r.categoria === 'edizione').slice(-8).map(r => r.valore).join('\n');
    const club     = rows.filter(r => r.categoria === 'club_analizzato').slice(-20).map(r => r.valore).join('\n');
    const errori   = rows.filter(r => r.categoria === 'errore').map(r => r.valore).join('\n');
    return `=== WIKI EDITORIALE ===\nSTILE:\n${stile}\nEDIZIONI PRECEDENTI:\n${edizioni}\nCLUB RECENTI:\n${club}\nERRORI:\n${errori}\n=== FINE WIKI ===`;
  } catch(e) {
    console.warn('Wiki non disponibile:', e.message);
    return '';
  }
}

async function getNextEditionNum() {
  const r = await fetch(`${SUPA_URL}/rest/v1/editions?select=num&published=eq.true&order=num.desc&limit=1`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  const rows = await r.json();
  return rows[0] ? String(parseInt(rows[0].num) + 1).padStart(3, '0') : '001';
}

async function bozzaEsistente(num) {
  const r = await fetch(`${SUPA_URL}/rest/v1/editions?num=eq.${num}&published=eq.false&select=id,num,sections`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const bozza = rows[0];
  const hasContent = (bozza.sections || []).some(s => s.body && s.body.length > 50);
  return hasContent ? bozza : null;
}

// ── FASE 1: KPI locking ───────────────────────────────────────────────────────
function fallbackKpis(dati) {
  return dati.slice(0, 3).map(d => {
    const valMatch = d.match(/(\d[\d.,]*\s*(?:M€|mld€?|mln€?|€|%|M\$|\$|K€)?)/i);
    const val = valMatch ? valMatch[1].trim() : '—';
    const label = d.replace(/—.*$/, '').replace(/\d[\d.,]*\s*(?:M€|mld€?|mln€?|€|%|M\$|\$|K€)?/gi, '').trim().slice(0, 30) || d.slice(0, 30);
    return { label, value: val, sub: '' };
  });
}

async function extractKpis(scelta) {
  if (!scelta) return [];
  const dati = scelta.dati_chiave || scelta.kpi_preview || [];
  if (!dati.length) return [];
  try {
    const raw = await callClaude(
      [{ role: 'user', content: `Estrai i 3 KPI principali. Usa SOLO valori numerici esatti presenti nei dati, senza modificarli.\nDati: ${JSON.stringify(dati)}\nRispondi SOLO JSON array: [{"label":"max 4 parole","value":"numero+unità esatto","sub":"max 4 parole di contesto"}]` }],
      'Rispondi esclusivamente con JSON array. Nessun testo aggiuntivo.',
      'claude-sonnet-4-6', 500
    );
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const kpis = JSON.parse(match[0]);
      if (Array.isArray(kpis) && kpis.length > 0) return kpis.slice(0, 3);
    }
  } catch(e) { console.warn('extractKpis fallback:', e.message); }
  return fallbackKpis(dati);
}

// ── FASE 2: Generazione sezione con KPI bloccati ──────────────────────────────
async function generaSezione(label, scelta, kpisLocked, wikiContext) {
  const kpisJson = JSON.stringify(kpisLocked);
  const datiChiave = (scelta.dati_chiave || scelta.kpi_preview || []).join('\n');
  const titleEscaped  = (scelta.titolo || scelta.title || '').replace(/"/g, '\\"');
  const sourceEscaped = (scelta.fonte_principale || scelta.source || 'fonte da verificare').replace(/"/g, '\\"');

  const system = `Sei il redattore senior di Valore Atteso, newsletter italiana sul business del calcio europeo.
Pubblico: professionisti M&A, PE, consulenza, finanza.
REGOLE ASSOLUTE:
1. I KPI sono BLOCCATI — riportali nel JSON esattamente come forniti, senza modificarli.
2. Scrivi SOLO body (180-250 parole) e verdict intorno ai KPI forniti.
3. Usa SOLO i dati dei "DATI VERIFICATI SCOUT". ZERO invenzioni.
4. Se un dato non è nei dati Scout: scrivi [dato da verificare].
5. Non citare mai "Calcio e Finanza" — usa le fonti primarie.
${wikiContext}`;

  const prompt = `Scrivi la sezione "${label}" per la newsletter Valore Atteso.

TEMA: "${titleEscaped}"
ANGOLO: ${scelta.angolo || 'analitico'}
SOMMARIO SCOUT: ${scelta.sommario || scelta.summary || ''}

DATI VERIFICATI SCOUT (usa SOLO questi numeri nel body):
${datiChiave}

FONTE PRIMARIA: ${sourceEscaped}

KPI BLOCCATI (includi esattamente così nel JSON — non modificare label, value, sub):
${kpisJson}

Rispondi SOLO JSON:
{"label":"${label}","title":"${titleEscaped}","body":"...180-250 parole, usa solo dati Scout...","kpis":${kpisJson},"verdict":"...1-2 frasi incisive...","sources":["${sourceEscaped}"]}`;

  const raw = await callClaude([{ role: 'user', content: prompt }], system, 'claude-sonnet-4-6', 2000);
  return parseJSON(raw);
}

// ── FASE 3: Validazione numerica (no AI) ──────────────────────────────────────
function normalizeNum(s) {
  return s.replace(/\s+/g, '').toLowerCase();
}

function validateSection(sec, datiChiave) {
  const warnings = [];
  const body = String(sec.body || '');
  const numRegex = /(\d[\d.,]*\s*(?:M€|mld€?|mln€?|€|%|M\$|\$|K€))/gi;
  let m;
  while ((m = numRegex.exec(body)) !== null) {
    const num = normalizeNum(m[1]);
    const found = datiChiave.some(d => normalizeNum(d).includes(num));
    if (!found) warnings.push(m[1].trim());
  }
  return { ok: warnings.length === 0, warnings: [...new Set(warnings)] };
}

function applyWarnings(sec, warnings) {
  if (!warnings.length) return sec;
  let body = String(sec.body || '');
  warnings.forEach(w => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(escaped, 'g'), `[VERIFICA: ${w}]`);
  });
  return { ...sec, body };
}

// ── Pipeline 3 fasi ───────────────────────────────────────────────────────────
async function generaEdizionePipeline(editionId, bilancio, deal, metrica, editionNum, wikiContext) {
  const labels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
  const scelte = [bilancio, deal, metrica];
  const allWarnings = [];

  // Fase 1: estrazione KPI in parallelo
  console.log('Pipeline Fase 1: estrazione KPI...');
  const kpisArr = await Promise.all(scelte.map(s => extractKpis(s)));
  console.log('KPI estratti:', kpisArr.map((k, i) => `${labels[i]}: [${k.map(kpi => kpi.value).join(', ')}]`).join(' | '));

  // Fase 2 + 3 per ogni sezione
  const sections = [];
  for (let i = 0; i < 3; i++) {
    if (!scelte[i]) { sections.push({}); continue; }
    console.log(`Pipeline Fase 2: genero ${labels[i]}...`);
    const sec = await generaSezione(labels[i], scelte[i], kpisArr[i], wikiContext);

    const datiChiave = scelte[i].dati_chiave || scelte[i].kpi_preview || [];
    const validation = validateSection(sec, datiChiave);
    if (!validation.ok) {
      console.warn(`Pipeline Fase 3: ${labels[i]} — ${validation.warnings.length} valore/i non tracciabile/i: ${validation.warnings.join(', ')}`);
      allWarnings.push({ sezione: labels[i], items: validation.warnings });
      sections.push(applyWarnings(sec, validation.warnings));
    } else {
      console.log(`Pipeline Fase 3: ${labels[i]} — ✓ verificato`);
      sections.push(sec);
    }
  }

  // Titolo e opener in una chiamata separata
  console.log('Pipeline: genera titolo/opener...');
  const metaRaw = await callClaude(
    [{ role: 'user', content: `Crea titolo, sottotitolo e opener per edizione #${editionNum}.\nTemi:\n- Bilancio: "${bilancio?.titolo || bilancio?.title}"\n- Deal: "${deal?.titolo || deal?.title}"\n- Metrica: "${metrica?.titolo || metrica?.title}"\nRispondi SOLO JSON: {"title":"...titolo breve e incisivo...","subtitle":"...sottotitolo...","opener":"...2-3 frasi introduttive..."}` }],
    'Sei il direttore editoriale di Valore Atteso. Crea titoli incisivi e concisi.',
    'claude-sonnet-4-6', 500
  );
  let meta = { title: `Bozza #${editionNum}`, subtitle: '', opener: '' };
  try { meta = parseJSON(metaRaw); } catch(e) { console.warn('Meta parse:', e.message); }

  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const patchRes = await supaPatch(`/rest/v1/editions?id=eq.${editionId}`, {
    title:    meta.title,
    subtitle: meta.subtitle || '',
    opener:   meta.opener || '',
    sections,
    date:     oggi
  });
  if (!patchRes.ok) throw new Error(`Supabase patch fallita: ${patchRes.status} — ${patchRes.text.slice(0, 200)}`);

  console.log(`Pipeline completata. ${allWarnings.length === 0 ? '✓ Nessuna eccezione' : `⚠ ${allWarnings.length} sezione/i con valori da verificare`}`);
  return { title: meta.title, allWarnings };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  console.log('Editoriale Agent v3 avviato:', new Date().toISOString());

  const [editionNum, wikiContext] = await Promise.all([getNextEditionNum(), getWikiContext()]);
  console.log(`Prossima edizione: #${editionNum} | Wiki: ${wikiContext.length} caratteri`);

  // ── Guardia: non sovrascrivere bozze con contenuto ────────────────────────
  const bozzaGiaPresente = await bozzaEsistente(editionNum);
  if (bozzaGiaPresente) {
    console.log(`⚠️  Bozza #${editionNum} già presente con contenuto. Skip.`);
    await logRun('editoriale', 'skipped', `Bozza #${editionNum} già presente — skip.`, { editionId: bozzaGiaPresente.id, num: editionNum }, Date.now()-start);
    return;
  }
  console.log(`Procedo con generazione bozza #${editionNum}`);

  const [scoutBrief, scoutSelezione, scoutPending, seoKeywords] = await Promise.all([
    memGet('scout_brief'), memGet('scout_selezione'), memGet('scout_pending'), memGet('seo_keywords')
  ]);

  let temiContext  = '';
  let modalita     = 'opzioni';
  let selectedTopics = null;

  if (scoutBrief) {
    const brief     = scoutBrief.value;
    const selezione = scoutSelezione?.value;
    const sameBrief = brief.brief_id
      && selezione?.brief_id
      && brief.brief_id === selezione.brief_id
      && selezione.stato === 'approved';

    if (sameBrief && brief.temi_per_sezione && selezione.selezionato_at) {
      const b = selezione.temi?.bilancio || brief.temi_per_sezione.bilancio?.[selezione.bilancio];
      const d = selezione.temi?.deal     || brief.temi_per_sezione.deal?.[selezione.deal];
      const m = selezione.temi?.metrica  || brief.temi_per_sezione.metrica?.[selezione.metrica];
      if (b && d && m) {
        modalita = 'diretta';
        selectedTopics = { bilancio: b, deal: d, metrica: m };
        temiContext = `\n\nPAOLO HA SELEZIONATO I TEMI (${new Date(selezione.selezionato_at).toLocaleDateString('it-IT')}):\n\nIL BILANCIO: "${b.titolo}"\n${b.sommario || b.summary}\nAngolo: ${b.angolo || ''}\nFonte: ${b.fonte_principale || b.source || ''}\n\nIL DEAL: "${d.titolo}"\n${d.sommario || d.summary}\nAngolo: ${d.angolo || ''}\nFonte: ${d.fonte_principale || d.source || ''}\n\nLA METRICA: "${m.titolo}"\n${m.sommario || m.summary}\nAngolo: ${m.angolo || ''}\nFonte: ${m.fonte_principale || m.source || ''}\n\nRACCOMANDAZIONE SCOUT: ${brief.raccomandazione?.tema || ''}${brief.note_editoriali ? `\nNOTE: ${brief.note_editoriali}` : ''}`;
        console.log('Modalità diretta — selezione di Paolo trovata');
      }
    }
    if (modalita === 'opzioni') {
      temiContext = `\n\nTEMI SCOUT:\n${JSON.stringify(brief.temi_per_sezione || brief.temi, null, 2)}\n\nCONSIGLIATO: ${brief.raccomandazione?.tema || ''}${brief.note_editoriali ? `\nNOTE: ${brief.note_editoriali}` : ''}`;
    }
  }

  const pendingIsNewer = scoutPending
    && (!scoutBrief || new Date(scoutPending.updated_at) > new Date(scoutBrief.updated_at));
  if (pendingIsNewer && !selectedTopics) {
    throw new Error('Il brief Scout più recente è ancora in attesa di selezione. Redazione non avviata per evitare di usare temi precedenti.');
  }

  if (seoKeywords) temiContext += `\n\nKEYWORD SEO:\n${JSON.stringify(seoKeywords.value, null, 2)}`;

  const haSelezione = !!selectedTopics;

  const systemOpzioni = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio.\n3 sezioni fisse: Il Bilancio, Il Deal, La Metrica.\nTono: analitico, diretto, dati verificabili, nessun gossip.\nPubblico: professionisti M&A, PE, consulenza, finanza.\nREGOLA: usa SOLO dati dai temi Scout. VIETATO inventare.\nKPI FORMAT: [{"label":"max 4 parole","value":"numero+unità","sub":"max 4 parole"}]\n${temiContext}\nRispondi SOLO in JSON valido:\n{"num":"${editionNum}","section_options":{"bilancio":[{"title":"...","summary":"...","kpi_preview":["..."],"source":"..."},...],"deal":[...],"metrica":[...]}}`;

  let options;
  if (haSelezione) {
    options = { num: editionNum };
  } else {
    const testo = await callClaude(
      [{ role: 'user', content: `Genera opzioni editoriali per edizione #${editionNum}. Per ogni sezione 3 opzioni con dati Scout reali.` }],
      systemOpzioni, 'claude-sonnet-4-6', 6000
    );
    try {
      const match = testo.match(/\{[\s\S]*\}/);
      options = JSON.parse(match[0].replace(/[\x00-\x1F\x7F]/g,' ').replace(/,(\s*[}\]])/g,'$1'));
    } catch { throw new Error('JSON opzioni non valido'); }
  }

  // ── MODALITÀ DIRETTA: pipeline 3 fasi inline ─────────────────────────────
  if (haSelezione && scoutBrief?.value?.temi_per_sezione) {
    const bilancio = selectedTopics.bilancio;
    const deal     = selectedTopics.deal;
    const metrica  = selectedTopics.metrica;

    if (bilancio && deal && metrica) {
      const saveRes = await fetch(`${SUPA_URL}/rest/v1/editions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({ num: options.num || editionNum, title: `Bozza #${options.num || editionNum}`, date: oggi, sections: [], section_options: scoutBrief.value.temi_per_sezione, published: false, tags: ['Il Bilancio', 'Il Deal', 'La Metrica', `scout:${scoutBrief.value.brief_id}`] })
      });
      const savedRows = await saveRes.json();
      const editionId = savedRows[0]?.id;

      if (editionId) {
        const { title, allWarnings } = await generaEdizionePipeline(
          editionId, bilancio, deal, metrica, options.num || editionNum, wikiContext
        );

        const emailSections = [
          {
            type: 'narrative', label: 'Bozza generata automaticamente', dark: true,
            text: `La bozza <strong>#${options.num || editionNum}</strong> è pronta in Control Room.${allWarnings.length ? ' ⚠ Alcune eccezioni richiedono verifica — vedi tabella sotto.' : ' ✓ Pipeline pulita — nessuna eccezione.'}`
          },
          {
            type: 'table', label: 'Temi selezionati',
            headers: [{ label: 'Sezione' }, { label: 'Tema' }],
            rows: [
              [{ value: '01 · Il Bilancio', mono: true, color: '#1B4332', bold: true }, { value: bilancio.titolo || bilancio.title }],
              [{ value: '02 · Il Deal',     mono: true, color: '#1B3A6B', bold: true }, { value: deal.titolo || deal.title }],
              [{ value: '03 · La Metrica',  mono: true, color: '#6B1B1B', bold: true }, { value: metrica.titolo || metrica.title }],
            ]
          },
        ];

        if (allWarnings.length > 0) {
          emailSections.push({
            type: 'table',
            label: '⚠ Numeri da verificare (marcati [VERIFICA] nel testo)',
            headers: [{ label: 'Sezione' }, { label: 'Valori' }],
            rows: allWarnings.map(w => [
              { value: w.sezione, bold: true },
              { value: w.items.join(' · '), mono: true, color: '#C8251D' }
            ])
          });
        } else {
          emailSections.push({
            type: 'narrative',
            label: 'Report validazione',
            text: '✓ Tutti i numeri nel testo sono tracciabili ai dati Scout originali. Nessun intervento manuale necessario.'
          });
        }

        emailSections.push({
          type: 'narrative', label: null, dark: true,
          text: `<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td><a href="${SITE}/?cr=redazione" style="display:inline-block;background:#C8A97A;color:#1A1A1A;font-family:Courier New,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:16px 40px;text-decoration:none">Apri Control Room →</a></td></tr></table>`
        });

        const html = agentEmail({
          agentName: 'Editoriale Agent',
          agentKey:  'editoriale',
          status:    allWarnings.length > 0 ? 'pending_approval' : 'success',
          date:      oggi,
          runTime:   `${((Date.now()-start)/1000).toFixed(1)}s`,
          sections:  emailSections
        });

        const subjectPrefix = allWarnings.length > 0 ? `⚠ ${allWarnings.length} eccezioni` : '✓ Pipeline pulita';
        await httpRequest('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Bozza VA #${options.num || editionNum} — ${subjectPrefix}`, html })
        });

        await logRun('editoriale', 'success', `Bozza #${options.num || editionNum} generata. ${allWarnings.length} sezione/i con eccezioni.`, { editionId, num: options.num || editionNum, warnings: allWarnings }, Date.now()-start);
        console.log('Editoriale completato — modalità diretta con pipeline 3 fasi.');
        return;
      }
    }
  }

  // ── MODALITÀ OPZIONI: salva e manda email con scelte ─────────────────────
  const saveRes = await fetch(`${SUPA_URL}/rest/v1/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=representation' },
    body: JSON.stringify({ num: options.num, title: `Bozza #${options.num} — in attesa di selezione`, subtitle: '', date: oggi, opener: '', sections: [], section_options: options.section_options, published: false, tags: ['Il Bilancio', 'Il Deal', 'La Metrica'] })
  });
  const saved = await saveRes.json();
  const editionId = saved[0]?.id;
  await memSet('last_draft', { id: editionId, num: options.num, date: oggi }, 'editoriale');

  const makeRows = (opts) => (opts||[]).map((o, i) => [
    { value: `${i+1}.`, mono: true, color: '#8E6B33', bold: true },
    { value: o.title, bold: true },
    { value: o.summary, color: '#4A4845' },
    { value: (o.kpi_preview||[]).join(' · '), mono: true, color: '#9A9690' },
  ]);

  const html = agentEmail({
    agentName: 'Editoriale Agent',
    agentKey:  'editoriale',
    status:    'pending_approval',
    date:      oggi,
    runTime:   `${((Date.now()-start)/1000).toFixed(1)}s`,
    sections: [
      { type: 'narrative', label: 'Scegli un tema per sezione', text: `Edizione <strong>#${options.num}</strong> — vai in Control Room → Redazione per selezionare e generare la bozza.`, dark: true },
      { type: 'table', label: '01 · Il Bilancio', headers: [{ label: '#' }, { label: 'Titolo' }, { label: 'Sommario' }, { label: 'Dati preview' }], rows: makeRows(options.section_options?.bilancio) },
      { type: 'table', label: '02 · Il Deal',     headers: [{ label: '#' }, { label: 'Titolo' }, { label: 'Sommario' }, { label: 'Dati preview' }], rows: makeRows(options.section_options?.deal) },
      { type: 'table', label: '03 · La Metrica',  headers: [{ label: '#' }, { label: 'Titolo' }, { label: 'Sommario' }, { label: 'Dati preview' }], rows: makeRows(options.section_options?.metrica) },
      { type: 'narrative', label: null, dark: true, text: `<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td><a href="${SITE}/?cr=redazione" style="display:inline-block;background:#C8A97A;color:#1A1A1A;font-family:Courier New,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:16px 40px;text-decoration:none">Vai in Control Room →</a></td></tr></table>` },
    ]
  });

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Scegli i temi VA #${options.num}`, html })
  });

  await logRun('editoriale', 'success', `Opzioni #${options.num} generate. Attende selezione.`, { editionId, num: options.num }, Date.now()-start);
  console.log('Editoriale completato — modalità opzioni.');
}

main().catch(async e => {
  console.error('ERRORE Editoriale:', e.message);
  await logRun('editoriale', 'error', e.message).catch(() => {});
  process.exit(1);
});
