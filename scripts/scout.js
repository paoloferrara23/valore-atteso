// scout.js — Cerca notizie CF calcio, salva su memoria condivisa
// Gira: sabato 7:00 | Scrive: scout_brief, scout_themes

const { memSet, logRun } = require('./memory');

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_KEY;
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
const FROM = 'Valore Atteso <info@valoreatteso.com>';

async function httpRequest(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: () => JSON.parse(text) };
}

async function callClaude(messages, system, useSearch = false) {
  const body = {
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    system,
    messages
  };

  if (useSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  const r = await httpRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.text}`);
  const data = r.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function main() {
  const start = Date.now();
  console.log('Scout avviato:', new Date().toISOString());

  // Legge biblioteca fonti da Supabase
  let bibliotecaContext = '';
  try {
    const bibRes = await fetch(`${SUPA_URL}/rest/v1/sources_library?select=nome,tipo,soggetto,stagione,dati_chiave,testo_estratto&order=created_at.desc&limit=20`, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    });
    const fonti = await bibRes.json();
    if (Array.isArray(fonti) && fonti.length > 0) {
      bibliotecaContext = '\n\nBIBLIOTECA FONTI VERIFICATE (usa questi dati come base primaria):\n' +
        fonti.map(f => {
          const kpi = f.dati_chiave ? Object.entries(f.dati_chiave)
            .filter(([k,v]) => v && v !== 'null')
            .map(([k,v]) => '  ' + k + ': ' + v)
            .join('\n') : '';
          return '\n--- ' + f.nome + ' (' + (f.soggetto||'') + ' ' + (f.stagione||'') + ') ---\n' + kpi + '\n' + (f.testo_estratto ? f.testo_estratto.slice(0, 600) : '');
        }).join('\n');
      console.log('Biblioteca caricata:', fonti.length, 'documenti');
    }
  } catch(e) {
    console.error('Errore lettura biblioteca:', e.message);
  }

  const system = 'Sei lo Scout di Valore Atteso, newsletter italiana sul business del calcio.\n' +
    'Hai le competenze di un senior analyst CF specializzato nel calcio europeo.\n' +
    'Compito: trovare le 5 notizie piu rilevanti della settimana e analizzarle con rigore finanziario.\n\n' +
    'METODOLOGIA CF OBBLIGATORIA per ogni tema:\n' +
    '- Calcola o cita multipli reali: EV/Revenue, EV/EBITDA, Price/Sales\n' +
    '- Confronta salary ratio con benchmark (Premier 64%, Bundesliga 58%, Serie A 64%)\n' +
    '- Analizza debt/EBITDA se il tema riguarda debito\n' +
    '- Valuta impatto FFP/PSR: limite 60M perdite triennio UEFA\n' +
    '- Scomponi i ricavi: matchday / broadcasting / commercial\n' +
    '- Per deal: struttura (equity/debt), earn-out, clausole governance\n\n' +
    'PRIORITA FONTI:\n' +
    '1. BIBLIOTECA VA (dati gia verificati - usa sempre se disponibili)\n' +
    '2. Web search (per notizie recenti - verifica con fonti primarie)\n' +
    '3. Mai inventare dati - se non hai la fonte, non includere il dato\n' +
    bibliotecaContext +
    '\n\nREGOLA FONTI: link diretto allaarticolo, non homepage. Per biblioteca cita "Biblioteca VA - [nome doc]".\n' +
    'Escludi: gossip mercato, risultati sportivi senza implicazioni economiche.\n\n' +
    'Rispondi SOLO in JSON valido:\n' +
    '{\n' +
    '  "settimana": "DD/MM/YYYY",\n' +
    '  "temi": [\n' +
    '    {\n' +
    '      "titolo": "...",\n' +
    '      "notizia": "...",\n' +
    '      "analisi_cf": "multipli, ratios, implicazioni finanziarie",\n' +
    '      "sezione_suggerita": "bilancio|deal|metrica",\n' +
    '      "priorita": 1,\n' +
    '      "dati_chiave": ["dato verificato con fonte"],\n' +
    '      "fonti": ["Testata - titolo - data - https://url-diretto"]\n' +
    '    }\n' +
    '  ],\n' +
    '  "tema_consigliato": "...",\n' +
    '  "note_editoriali": "..."\n' +
    '}'

  const oggi = new Date().toLocaleDateString('it-IT');
  // Fase 1: ricerca web delle notizie della settimana
  console.log('Ricerca notizie con web search...');
  const testoRicerca = await callClaude([{
    role: 'user',
    content: `Oggi è ${oggi}. Cerca le notizie più rilevanti degli ultimi 7 giorni sul business del calcio europeo (bilanci, acquisizioni, diritti TV, deal finanziari). Per ogni notizia trovata includi il link DIRETTO all'articolo specifico. Poi genera il brief JSON per Valore Atteso con fonti verificabili e link diretti agli articoli. IMPORTANTE: per ogni tema includi il campo "fonti" con il link esatto all'articolo o documento, non la homepage del sito.`
  }], system, true); // useSearch = true

  const testo = testoRicerca;

  let brief;
  try {
    const raw = testo.replace(/```json|```/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');
    let json = match[0];
    // Rimuove caratteri di controllo
    json = json.replace(/[\x00-\x1F\x7F]/g, ' ');
    // Fix trailing commas
    json = json.replace(/,(\s*[}\]])/g, '$1');
    brief = JSON.parse(json);
  } catch(e) {
    // Retry con istruzioni più semplici
    const retry = await callClaude([
      { role: 'user', content: `Oggi è ${oggi}. Genera il brief Scout per Valore Atteso. IMPORTANTE: rispondi SOLO con JSON valido, nessun testo aggiuntivo.` },
      { role: 'assistant', content: testo },
      { role: 'user', content: 'Il JSON era malformato. Rispondi SOLO con JSON valido. Usa stringhe semplici senza caratteri speciali. Campo fonti: array di stringhe nel formato "Testata — tipo — data — url".' }
    ], system);
    const raw2 = retry.replace(/```json|```/g, '').trim();
    const match2 = raw2.match(/\{[\s\S]*\}/);
    if (!match2) throw new Error('JSON non valido dallo Scout');
    let json2 = match2[0].replace(/[\x00-\x1F\x7F]/g, ' ').replace(/,(\s*[}\]])/g, '$1');
    brief = JSON.parse(json2);
  }

  // Valida fonti — rimuovi temi senza fonti
  const temiConFonti = (brief.temi || []).filter(t => {
    if (!t.fonti || t.fonti.length === 0) return false;
    const prima = t.fonti[0];
    if (typeof prima === 'string') return prima !== '';
    return prima.nome && prima.nome !== '';
  });
  const temiSenzaFonti = (brief.temi || []).length - temiConFonti.length;
  if (temiSenzaFonti > 0) {
    console.log(`⚠ Rimossi ${temiSenzaFonti} temi senza fonti`);
  }
  brief.temi = temiConFonti;
  console.log(`Temi con fonti: ${brief.temi.length}`);

  // Salva nella memoria condivisa per l'Editoriale Agent
  await memSet('scout_brief', brief, 'scout');
  await memSet('scout_themes', brief.temi, 'scout');
  await memSet('scout_last_run', { date: oggi, tema_consigliato: brief.tema_consigliato }, 'scout');

  console.log('Brief salvato su Supabase. Temi trovati:', brief.temi.length);

  // Email a Paolo
  const temasHTML = brief.temi.map((t, i) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #E2DDD4;vertical-align:top">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">
          #${i+1} · ${t.sezione_suggerita.toUpperCase()} · Priorità ${t.priorita}/5
        </div>
        <div style="font-family:Georgia,serif;font-size:14px;font-weight:700;margin-bottom:6px">${t.titolo}</div>
        <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;line-height:1.6;margin-bottom:8px">${t.notizia}</div>
        <div style="font-family:'Courier New',monospace;font-size:10px;color:#1B4332;background:#E4EDE7;padding:8px 10px">
          CF: ${t.angolo_cf}
        </div>
        ${t.dati_chiave?.length ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:#9A9690;margin-top:6px">Dati: ${t.dati_chiave.join(' · ')}</div>` : ''}
        ${t.fonti?.length ? `<div style="font-family:'Courier New',monospace;font-size:8px;color:#1B4332;background:#E4EDE7;padding:6px 10px;margin-top:6px;border-left:2px solid #1B4332">Fonti: ${t.fonti.map(f => {
          if (typeof f !== 'string') return JSON.stringify(f);
          const urlMatch = f.match(/https?:\/\/[^\s]+/);
          const label = f.replace(/\s*—\s*https?:\/\/[^\s]+/, '').trim();
          return urlMatch ? `<a href="${urlMatch[0]}" style="color:#1B4332;text-decoration:underline">${label}</a>` : label;
        }).join(' · ')}</div>` : '<div style="font-family:\'Courier New\',monospace;font-size:8px;color:#C8251D;padding:4px 10px;margin-top:4px">⚠ Fonti mancanti</div>'}
      </td>
    </tr>`).join('');

  const html = `
    <table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif">
      <tr><td style="padding:20px 24px;border-bottom:2px solid #1A1A1A;background:#1A1A1A">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-1px;color:#fff">Valore Atteso</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">Scout · Brief Settimanale · ${oggi}</div>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#EDE9E0;border-bottom:1px solid #D0CBC0">
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#C8251D;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Tema consigliato per l'edizione</div>
        <div style="font-family:Georgia,serif;font-size:15px;font-weight:700">${brief.tema_consigliato}</div>
        ${brief.note_editoriali ? `<div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;font-weight:300;margin-top:6px;font-style:italic">${brief.note_editoriali}</div>` : ''}
      </td></tr>
      <tr><td style="padding:0">
        <table width="100%" style="border-collapse:collapse">${temasHTML}</table>
      </td></tr>
      <tr><td style="padding:12px 24px;border-top:1px solid #D0CBC0;text-align:center">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690">Scout · Valore Atteso · Temi salvati su Supabase per l'Editoriale Agent</div>
      </td></tr>
    </table>`;

  await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: APPROVAL_EMAIL, subject: `Scout VA · ${brief.tema_consigliato}`, html })
  });

  await logRun('scout', 'success', `${brief.temi.length} temi trovati. Consigliato: ${brief.tema_consigliato}`, brief, Date.now() - start);
  console.log('Scout completato.');
}

main().catch(async e => {
  console.error('ERRORE Scout:', e.message);
  await logRun('scout', 'error', e.message).catch(() => {});
  process.exit(1);
});
