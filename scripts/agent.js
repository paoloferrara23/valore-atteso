// scripts/agent.js — Editoriale Agent v2 con nuovo template email
const { memGet, memSet, logRun } = require('./memory');
const { agentEmail } = require('./email-template');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY    = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL      = process.env.SUPABASE_URL;
const SUPA_KEY      = process.env.SUPABASE_KEY;
const SITE          = 'https://valoreatteso.com';
const FROM          = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function callClaude(messages, system) {
  const r = await httpRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 6000, system, messages })
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

async function bozzaEsistente(num) {
  // Controlla se esiste già una bozza non pubblicata per questo numero
  const r = await fetch(`${SUPA_URL}/rest/v1/editions?num=eq.${num}&published=eq.false&select=id,num,sections`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const bozza = rows[0];
  // Considera bozza "con contenuto" se ha almeno una sezione con body non vuoto
  const hasContent = (bozza.sections || []).some(s => s.body && s.body.length > 50);
  return hasContent ? bozza : null;
}

async function main() {
  const start = Date.now();
  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  console.log('Editoriale Agent v2 avviato:', new Date().toISOString());

  // ── GUARDIA: non sovrascrivere bozze con contenuto già presente ────────────
  const editionNum = await getNextEditionNum();
  const bozzaGiaPresente = await bozzaEsistente(editionNum);
  if (bozzaGiaPresente) {
    console.log(`⚠️  Bozza #${editionNum} già presente con contenuto. Agente non sovrascrive. ID: ${bozzaGiaPresente.id}`);
    await logRun('editoriale', 'skipped', `Bozza #${editionNum} già presente — skip per non sovrascrivere contenuto esistente.`, { editionId: bozzaGiaPresente.id, num: editionNum }, Date.now()-start);
    return;
  }
  console.log(`Procedo con generazione bozza #${editionNum}`);

  const scoutBrief    = await memGet('scout_brief');
  const scoutSelezione = await memGet('scout_selezione');
  const seoKeywords   = await memGet('seo_keywords');

  let temiContext = '';
  let modalita = 'opzioni'; // default

  if (scoutBrief) {
    const brief = scoutBrief.value;
    const selezione = scoutSelezione?.value;

    if (selezione && brief.temi_per_sezione && selezione.selezionato_at) {
      const b = brief.temi_per_sezione.bilancio?.[selezione.bilancio];
      const d = brief.temi_per_sezione.deal?.[selezione.deal];
      const m = brief.temi_per_sezione.metrica?.[selezione.metrica];
      if (b && d && m) {
        modalita = 'diretta';
        temiContext = `\n\nPAOLO HA SELEZIONATO I TEMI (${new Date(selezione.selezionato_at).toLocaleDateString('it-IT')}):\n\nIL BILANCIO: "${b.titolo}"\n${b.sommario || b.summary}\nAngolo: ${b.angolo || ''}\nFonte: ${b.fonte_principale || b.source || ''}\n\nIL DEAL: "${d.titolo}"\n${d.sommario || d.summary}\nAngolo: ${d.angolo || ''}\nFonte: ${d.fonte_principale || d.source || ''}\n\nLA METRICA: "${m.titolo}"\n${m.sommario || m.summary}\nAngolo: ${m.angolo || ''}\nFonte: ${m.fonte_principale || m.source || ''}\n\nRACCOMANDAZIONE SCOUT: ${brief.raccomandazione?.tema || ''}${brief.note_editoriali ? `\nNOTE: ${brief.note_editoriali}` : ''}`;
        console.log('Modalità diretta — selezione di Paolo trovata');
      }
    }
    if (modalita === 'opzioni') {
      temiContext = `\n\nTEMI SCOUT:\n${JSON.stringify(brief.temi_per_sezione || brief.temi, null, 2)}\n\nCONSIGLIATO: ${brief.raccomandazione?.tema || ''}${brief.note_editoriali ? `\nNOTE: ${brief.note_editoriali}` : ''}`;
    }
  }

  if (seoKeywords) temiContext += `\n\nKEYWORD SEO:\n${JSON.stringify(seoKeywords.value, null, 2)}`;

  // editionNum già calcolato nella guardia iniziale
  const haSelezione = scoutSelezione?.value?.selezionato_at && scoutBrief?.value?.temi_per_sezione && scoutSelezione.value.bilancio != null;

  const system = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio.\n3 sezioni fisse: Il Bilancio, Il Deal, La Metrica.\nTono: analitico, diretto, dati verificabili, nessun gossip.\nPubblico: professionisti M&A, PE, consulenza, finanza.\nREGOLA: usa SOLO dati dai temi Scout. VIETATO inventare.\nKPI FORMAT: [{"label":"max 4 parole","value":"numero+unità","sub":"max 4 parole"}]\n${temiContext}\nRispondi SOLO in JSON valido:\n{"num":"${editionNum}","section_options":{"bilancio":[{"title":"...","summary":"...","kpi_preview":["..."],"source":"..."},...],"deal":[...],"metrica":[...]}}`;

  const testo = await callClaude([{ role: 'user', content: `Genera opzioni editoriali per edizione #${editionNum}. Per ogni sezione 3 opzioni con dati Scout reali.` }], system);

  let options;
  try {
    const match = testo.match(/\{[\s\S]*\}/);
    options = JSON.parse(match[0].replace(/[\x00-\x1F\x7F]/g,' ').replace(/,(\s*[}\]])/g,'$1'));
  } catch { throw new Error('JSON opzioni non valido'); }

  // ── MODALITÀ DIRETTA: selezione già fatta ────────────────────────────────
  if (haSelezione && scoutBrief?.value?.temi_per_sezione) {
    const sel = scoutSelezione.value;
    const ts  = scoutBrief.value.temi_per_sezione;
    const bilancio = ts.bilancio?.[sel.bilancio];
    const deal     = ts.deal?.[sel.deal];
    const metrica  = ts.metrica?.[sel.metrica];

    if (bilancio && deal && metrica) {
      const saveRes = await fetch(`${SUPA_URL}/rest/v1/editions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({ num: options.num || editionNum, title: `Bozza #${options.num || editionNum}`, date: oggi, sections: [], section_options: ts, published: false, tags: ['Il Bilancio', 'Il Deal', 'La Metrica'] })
      });
      const savedRows = await saveRes.json();
      const editionId = savedRows[0]?.id;

      if (editionId) {
        const genRes = await httpRequest(`${SITE}/api/genera-edizione`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cr-token': process.env.CR_PASSWORD || 'valopro2025' },
          body: JSON.stringify({ editionId, bilancio, deal, metrica, date: oggi })
        });

        if (genRes.ok) {
          const html = agentEmail({
            agentName: 'Editoriale Agent',
            agentKey: 'editoriale',
            status: 'success',
            date: oggi,
            runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
            sections: [
              { type: 'narrative', label: 'Bozza generata automaticamente', text: `La bozza <strong>#${options.num || editionNum}</strong> è pronta in Control Room. Temi selezionati sabato — generata automaticamente lunedì.`, dark: true },
              { type: 'table', label: 'Temi selezionati', headers: [{ label: 'Sezione' }, { label: 'Tema' }], rows: [
                [{ value: '01 · Il Bilancio', mono: true, color: '#1B4332', bold: true }, { value: bilancio.titolo }],
                [{ value: '02 · Il Deal',     mono: true, color: '#1B3A6B', bold: true }, { value: deal.titolo }],
                [{ value: '03 · La Metrica',  mono: true, color: '#6B1B1B', bold: true }, { value: metrica.titolo }],
              ]},
              { type: 'narrative', label: null, dark: true, text: `<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td><a href="${SITE}/?cr=redazione" style="display:inline-block;background:#C8A97A;color:#1A1A1A;font-family:Courier New,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:16px 40px;text-decoration:none">Apri Control Room →</a></td></tr></table>` },
            ]
          });

          await httpRequest('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `✓ Bozza VA #${options.num || editionNum} pronta — revisiona e approva`, html })
          });

          await logRun('editoriale', 'success', `Bozza #${options.num || editionNum} generata automaticamente.`, { editionId, num: options.num || editionNum }, Date.now()-start);
          console.log('Editoriale completato — modalità diretta.');
          return;
        }
      }
    }
  }

  // ── MODALITÀ OPZIONI: salva e manda email con scelte ────────────────────
  const saveRes = await fetch(`${SUPA_URL}/rest/v1/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'return=representation' },
    body: JSON.stringify({ num: options.num, title: `Bozza #${options.num} — in attesa di selezione`, subtitle: '', date: oggi, opener: '', sections: [], section_options: options.section_options, published: false, tags: ['Il Bilancio', 'Il Deal', 'La Metrica'] })
  });
  const saved = await saveRes.json();
  const editionId = saved[0]?.id;
  await memSet('last_draft', { id: editionId, num: options.num, date: oggi }, 'editoriale');

  // Costruisci righe per ogni sezione
  const makeRows = (opts) => (opts||[]).map((o, i) => [
    { value: `${i+1}.`, mono: true, color: '#8E6B33', bold: true },
    { value: o.title, bold: true },
    { value: o.summary, color: '#4A4845' },
    { value: (o.kpi_preview||[]).join(' · '), mono: true, color: '#9A9690' },
  ]);

  const html = agentEmail({
    agentName: 'Editoriale Agent',
    agentKey: 'editoriale',
    status: 'pending_approval',
    date: oggi,
    runTime: `${((Date.now()-start)/1000).toFixed(1)}s`,
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
