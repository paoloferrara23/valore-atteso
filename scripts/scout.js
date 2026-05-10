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
    body['anthropic-beta'] = 'web-search-2025-03-05';
  }

  const r = await httpRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      ...(useSearch ? { 'anthropic-beta': 'web-search-2025-03-05' } : {})
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.text}`);
  const data = r.json();
  // Estrai solo i blocchi di testo dalla risposta (ignora tool_use e tool_result)
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function main() {
  const start = Date.now();
  console.log('Scout avviato:', new Date().toISOString());

  const system = `Sei lo Scout di Valore Atteso, newsletter italiana sul business del calcio.
Il tuo compito: trovare le 5 notizie più rilevanti della settimana sul business del calcio dal punto di vista del corporate finance.

Criteri di selezione:
- Rilevanza economica: bilanci, acquisizioni, diritti TV, valutazioni, debito
- Dati verificabili: SOLO notizie con numeri concreti e fonti primarie identificabili
- Angolo CF: ogni notizia deve avere un'analisi finanziaria possibile

REGOLA ASSOLUTA — FONTI OBBLIGATORIE:
- Il campo "fonti" è OBBLIGATORIO per ogni tema. Se non hai la fonte esatta, NON includere la notizia.
- La fonte deve essere il link DIRETTO all'articolo, comunicato o documento specifico — NON la homepage del sito
- Esempi corretti: "https://www.gazzetta.it/Calcio/Serie-A/juventus-bilancio-2024.html", "https://www.juventus.com/it/comunicati/comunicato-risultati-finanziari-2024"
- Esempi SBAGLIATI: "UEFA.com", "SerieA.it", "Gazzetta.it" — homepage generiche non accettate
- Se non hai il link diretto all'articolo specifico, NON includere quella notizia
- Per bilanci societari: link al comunicato ufficiale del club o alla pagina CCIAA
- Per dati Deloitte/KPMG: link al report specifico scaricabile

Escludi:
- Notizie senza fonte verificabile
- Gossip di mercato
- Risultati sportivi senza implicazioni economiche

Rispondi SOLO in JSON valido, nessun testo prima o dopo:
{
  "settimana": "DD/MM/YYYY",
  "temi": [
    {
      "titolo": "...",
      "notizia": "...",
      "angolo_cf": "Angolo di analisi: ...",
      "sezione_suggerita": "bilancio|deal|metrica",
      "priorita": 1,
      "dati_chiave": ["dato1 con numero", "dato2 con numero"],
      "fonti": [
        "Testata — titolo articolo specifico — data — https://link-diretto-articolo.com/pagina-specifica"
      ]
    }
  ],
  "tema_consigliato": "...",
  "note_editoriali": "..."
}`;

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
