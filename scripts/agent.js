// scripts/agent.js — Genera 3 opzioni per sezione invece di 1
const { memGet, memSet, logRun } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;
const SITE = 'https://valoreatteso.com';
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

async function main() {
  const start = Date.now();
  console.log('Editoriale Agent avviato:', new Date().toISOString());

  const scoutBrief = await memGet('scout_brief');
  const scoutSelezione = await memGet('scout_selezione');
  const seoKeywords = await memGet('seo_keywords');

  let temiContext = '';
  if (scoutBrief) {
    const brief = scoutBrief.value;
    const selezione = scoutSelezione?.value;

    // Se Paolo ha selezionato i temi → usa quelli, non generare opzioni
    if (selezione && brief.temi_per_sezione && selezione.selezionato_at) {
      const b = brief.temi_per_sezione.bilancio?.[selezione.bilancio];
      const d = brief.temi_per_sezione.deal?.[selezione.deal];
      const m = brief.temi_per_sezione.metrica?.[selezione.metrica];

      if (b && d && m) {
        temiContext = `\n\nPAOLO HA GIÀ SELEZIONATO I TEMI (selezione del ${new Date(selezione.selezionato_at).toLocaleDateString('it-IT')}):` +
          `\n\nIL BILANCIO: "${b.titolo}"\n${b.sommario || b.summary}\nAngolo: ${b.angolo || ''}\nFonte: ${b.fonte_principale || b.source || ''}` +
          `\n\nIL DEAL: "${d.titolo}"\n${d.sommario || d.summary}\nAngolo: ${d.angolo || ''}\nFonte: ${d.fonte_principale || d.source || ''}` +
          `\n\nLA METRICA: "${m.titolo}"\n${m.sommario || m.summary}\nAngolo: ${m.angolo || ''}\nFonte: ${m.fonte_principale || m.source || ''}` +
          `\n\nRACCOMANDAZIONE SCOUT: ${brief.raccomandazione?.tema || brief.tema_consigliato || ''}` +
          (brief.note_editoriali ? `\nNOTE: ${brief.note_editoriali}` : '');

        console.log('Selezione Paolo trovata — genero bozza diretta senza chiedere opzioni');
      }
    } else {
      // Fallback: nessuna selezione → genera opzioni come prima
      temiContext = `\n\nTEMI SCOUT (aggiornati ${scoutBrief.updated_at}):\n` +
        JSON.stringify(brief.temi_per_sezione || brief.temi, null, 2) +
        `\n\nTEMA CONSIGLIATO: ${brief.raccomandazione?.tema || brief.tema_consigliato || ''}` +
        (brief.note_editoriali ? `\nNOTE: ${brief.note_editoriali}` : '');
    }
  }

  let seoContext = '';
  if (seoKeywords) {
    seoContext = `\n\nKEYWORD SEO:\n${JSON.stringify(seoKeywords.value, null, 2)}`;
  }

  const editionNum = await getNextEditionNum();
  const haSelezione = scoutSelezione?.value?.selezionato_at &&
    scoutBrief?.value?.temi_per_sezione &&
    scoutSelezione.value.bilancio != null;
  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

  const system = `Sei il redattore di Valore Atteso, newsletter italiana sul business del calcio.
Ogni edizione ha 3 sezioni fisse: Il Bilancio, Il Deal, La Metrica.
Tono: analitico, diretto, dati verificabili, nessun gossip.
Pubblico: professionisti M&A, PE, consulenza, finanza.

REGOLA ASSOLUTA — USA SOLO I DATI DELLO SCOUT:
- Ogni numero, dato finanziario, statistica DEVE provenire dai temi che lo Scout ha trovato
- VIETATO inventare dati o fonti
- Se non hai abbastanza dati, semplifica piuttosto che inventare

FORMATO KPI OBBLIGATORIO per ogni sezione:
[{"label":"nome breve","value":"numero con unità","sub":"contesto 3-4 parole"}]
${temiContext}
${seoContext}

Rispondi SOLO in JSON valido con questa struttura:
{
  "num": "${editionNum}",
  "section_options": {
    "bilancio": [
      {
        "title": "titolo opzione 1",
        "summary": "2-3 righe che spiegano l'angolo di analisi",
        "kpi_preview": ["dato chiave 1", "dato chiave 2"],
        "source": "fonte principale"
      },
      { ... opzione 2 ... },
      { ... opzione 3 ... }
    ],
    "deal": [ ... 3 opzioni ... ],
    "metrica": [ ... 3 opzioni ... ]
  }
}`;

  const testo = await callClaude([{
    role: 'user',
    content: `Genera le opzioni editoriali per l'edizione #${editionNum} di Valore Atteso.
Per ogni sezione (Il Bilancio, Il Deal, La Metrica) proponi 3 opzioni diverse basate sui temi dello Scout.
Ogni opzione deve avere: titolo, sommario 2-3 righe, 2 dati chiave preview, fonte principale.
USA SOLO dati dai temi Scout. Non inventare.`
  }], system);

  let options;
  try {
    const match = testo.match(/\{[\s\S]*\}/);
    options = JSON.parse(match[0]);
  } catch {
    throw new Error('JSON opzioni non valido');
  }

  // Se Paolo ha già selezionato i temi → chiama direttamente genera-edizione
  if (haSelezione && scoutBrief?.value?.temi_per_sezione) {
    const sel = scoutSelezione.value;
    const ts = scoutBrief.value.temi_per_sezione;
    const bilancio = ts.bilancio?.[sel.bilancio];
    const deal = ts.deal?.[sel.deal];
    const metrica = ts.metrica?.[sel.metrica];

    if (bilancio && deal && metrica) {
      console.log('Modalità diretta: genero bozza con selezione di Paolo...');

      // Prima salva la bozza con section_options
      const saveRes = await fetch(`${SUPA_URL}/rest/v1/editions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          num: options.num || editionNum,
          title: `Bozza #${options.num || editionNum}`,
          date: oggi,
          sections: [],
          section_options: ts,
          published: false,
          tags: ['Il Bilancio', 'Il Deal', 'La Metrica']
        })
      });
      const savedRows = await saveRes.json();
      const editionId = savedRows[0]?.id;

      if (editionId) {
        // Chiama genera-edizione direttamente
        const genRes = await httpRequest(`${SITE}/api/genera-edizione`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cr-token': process.env.CR_PASSWORD || 'valopro2025'
          },
          body: JSON.stringify({ editionId, bilancio, deal, metrica, date: oggi })
        });

        if (genRes.ok) {
          const genData = genRes.json();
          console.log('Bozza generata automaticamente:', genData.title);

          // Email con bozza pronta (non opzioni)
          const html = `
            <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB">
              <tr><td style="padding:20px 24px;background:#1A1A1A">
                <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#fff">Valore Atteso</div>
                <div style="font-family:'Courier New',monospace;font-size:9px;color:#1B6B3A;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">✓ Bozza pronta — ${oggi}</div>
              </td></tr>
              <tr><td style="padding:16px 24px;background:#E4EDE7;border-bottom:1px solid #C8DDD0">
                <div style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#1B4332">La bozza #${options.num || editionNum} è già pronta in Control Room</div>
                <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;margin-top:6px">Temi selezionati sabato · Bozza generata automaticamente</div>
              </td></tr>
              <tr><td style="padding:16px 24px">
                <div style="font-family:'Courier New',monospace;font-size:10px;color:#8E6B33;margin-bottom:4px">IL BILANCIO</div>
                <div style="font-family:Georgia,serif;font-size:13px;font-weight:700;margin-bottom:12px">${bilancio.titolo}</div>
                <div style="font-family:'Courier New',monospace;font-size:10px;color:#8E6B33;margin-bottom:4px">IL DEAL</div>
                <div style="font-family:Georgia,serif;font-size:13px;font-weight:700;margin-bottom:12px">${deal.titolo}</div>
                <div style="font-family:'Courier New',monospace;font-size:10px;color:#8E6B33;margin-bottom:4px">LA METRICA</div>
                <div style="font-family:Georgia,serif;font-size:13px;font-weight:700">${metrica.titolo}</div>
              </td></tr>
              <tr><td style="padding:20px 24px;text-align:center;border-top:2px solid #1A1A1A">
                <a href="${SITE}/?cr=redazione" style="background:#C8251D;color:#fff;padding:14px 32px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Apri Control Room →</a>
              </td></tr>
            </table>`;

          await httpRequest('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `✓ Bozza VA #${options.num || editionNum} pronta — revisiona e approva`, html })
          });

          await logRun('editoriale', 'success',
            `Bozza #${options.num || editionNum} generata automaticamente da selezione di Paolo.`,
            { editionId, num: options.num || editionNum }, Date.now() - start);

          console.log('Editoriale Agent completato — bozza diretta generata.');
          return;
        }
      }
    }
  }

  // Salva bozza su Supabase con section_options ma senza sections (ancora da scegliere)
  const saveRes = await fetch(`${SUPA_URL}/rest/v1/editions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      num: options.num,
      title: `Bozza #${options.num} — in attesa di selezione`,
      subtitle: '',
      date: oggi,
      opener: '',
      sections: [],
      section_options: options.section_options,
      published: false,
      tags: ['Il Bilancio', 'Il Deal', 'La Metrica']
    })
  });
  const saved = await saveRes.json();
  const editionId = saved[0]?.id;

  await memSet('last_draft', { id: editionId, num: options.num, date: oggi }, 'editoriale');

  // Email di approvazione con le opzioni
  const makeOptionHtml = (opts, label) => `
    <div style="margin-bottom:16px">
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">${label}</div>
      ${opts.map((o, i) => `
        <div style="background:${i===0?'#F5F2EB':'#EDE9E0'};padding:10px 14px;border-bottom:1px solid #D0CBC0">
          <div style="font-family:Georgia,serif;font-size:13px;font-weight:700;margin-bottom:4px">${i+1}. ${o.title}</div>
          <div style="font-family:Georgia,serif;font-size:12px;color:#4A4845;margin-bottom:4px">${o.summary}</div>
          <div style="font-family:'Courier New',monospace;font-size:10px;color:#888480">${o.kpi_preview?.join(' · ')} — ${o.source}</div>
        </div>
      `).join('')}
    </div>`;

  const approveUrl = `${SITE}/?cr=redazione`;
  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB">
      <tr><td style="padding:20px 24px;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">Editoriale Agent · Seleziona i temi #${options.num}</div>
      </td></tr>
      <tr><td style="padding:14px 24px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
        <div style="font-family:Georgia,serif;font-size:14px;color:#4A4845">
          Per ogni sezione trovi 3 opzioni. Vai in Control Room → Redazione per scegliere e generare la bozza.
        </div>
      </td></tr>
      <tr><td style="padding:16px 24px">
        ${makeOptionHtml(options.section_options.bilancio, '01 · IL BILANCIO')}
        ${makeOptionHtml(options.section_options.deal, '02 · IL DEAL')}
        ${makeOptionHtml(options.section_options.metrica, '03 · LA METRICA')}
      </td></tr>
      <tr><td style="padding:20px 24px;text-align:center;border-top:2px solid #1A1A1A">
        <a href="${approveUrl}" style="background:#C8251D;color:#fff;padding:14px 32px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;display:inline-block">Vai in Control Room →</a>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Scegli i temi VA #${options.num}`, html })
  });

  await logRun('editoriale', 'success', `Opzioni #${options.num} generate. Attende selezione in Control Room.`, { editionId, num: options.num }, Date.now() - start);
  console.log('Editoriale Agent completato. Opzioni:', options.num);
}

main().catch(async e => {
  console.error('ERRORE Editoriale:', e.message);
  await logRun('editoriale', 'error', e.message).catch(() => {});
  process.exit(1);
});

