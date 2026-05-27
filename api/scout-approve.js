// api/scout-approve.js — Gestisce approvazione/rifiuto brief Scout via link email
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function handler(req, res) {
  const { token, action } = req.query || {};

  if (!token || !action) {
    return res.status(400).send(page('Errore', 'Parametri mancanti.', '#C8251D'));
  }

  try {
    // Leggi il brief in pending
    const { data: row } = await supabase
      .from('agent_memory')
      .select('value, updated_at')
      .eq('key', 'scout_pending')
      .single();

    if (!row?.value) {
      return res.status(404).send(page('Non trovato', 'Nessun brief in attesa di approvazione. Potrebbe essere già stato processato.', '#C8251D'));
    }

    const brief = row.value;
    const isApprove = action === 'approve' && token === brief.approval_token;
    const isReject  = action === 'reject'  && token === brief.reject_token;

    if (!isApprove && !isReject) {
      return res.status(403).send(page('Token non valido', 'Il link è scaduto o non valido.', '#C8251D'));
    }

    if (isReject) {
      // Marca come rifiutato, non salva i temi
      await supabase.from('agent_memory').upsert({
        key: 'scout_pending',
        value: { ...brief, stato: 'rifiutato', rifiutato_at: new Date().toISOString() },
        written_by: 'scout',
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

      await supabase.from('agent_runs').insert({
        agent: 'scout',
        status: 'rejected',
        summary: `Brief rifiutato da Paolo. ${brief.temi?.length || 0} temi non salvati.`,
        data: { temi: brief.temi?.length }
      });

      return res.status(200).send(page(
        '✗ Brief rifiutato',
        'I temi non sono stati salvati. Lo Scout ripartirà sabato prossimo.',
        '#C8251D'
      ));
    }

    // APPROVA: salva i temi nella memoria condivisa per l'Editoriale Agent
    const briefPulito = { ...brief };
    delete briefPulito.approval_token;
    delete briefPulito.reject_token;
    briefPulito.stato = 'approvato';
    briefPulito.approvato_at = new Date().toISOString();

    await supabase.from('agent_memory').upsert({
      key: 'scout_brief',
      value: briefPulito,
      written_by: 'scout',
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

    await supabase.from('agent_memory').upsert({
      key: 'scout_themes',
      value: brief.temi,
      written_by: 'scout',
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

    await supabase.from('agent_memory').upsert({
      key: 'scout_pending',
      value: { ...briefPulito, stato: 'approvato' },
      written_by: 'scout',
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });

    await supabase.from('agent_runs').insert({
      agent: 'scout',
      status: 'success',
      summary: `Brief approvato. ${brief.temi?.length || 0} temi salvati. Raccomandazione: ${brief.raccomandazione?.tema || '—'}`,
      data: { temi: brief.temi?.length, raccomandazione: brief.raccomandazione }
    });

    return res.status(200).send(page(
      '✓ Brief approvato',
      `${brief.temi?.length || 0} temi salvati. L'Editoriale Agent li userà lunedì mattina per generare le opzioni.`,
      '#1B6B3A',
      brief.raccomandazione
    ));

  } catch (e) {
    console.error('[scout-approve]', e);
    return res.status(500).send(page('Errore', e.message, '#C8251D'));
  }
};

function page(titolo, messaggio, colore, raccomandazione) {
  const raccHtml = raccomandazione ? `
    <div style="margin-top:24px;padding:18px 20px;background:#F0EBE1;border-left:3px solid #C8A97A;text-align:left">
      <div style="font-family:'Courier New',monospace;font-size:8px;color:#8E6B33;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px">Tema raccomandato salvato</div>
      <div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#1A1A1A;margin-bottom:4px">${raccomandazione.tema}</div>
      <div style="font-family:'Courier New',monospace;font-size:10px;color:#777066">${raccomandazione.sezione} · ${raccomandazione.angolo_editoriale}</div>
    </div>` : '';

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${titolo} — Valore Atteso</title></head>
<body style="margin:0;padding:40px 20px;background:#D8D0C4;font-family:Georgia,serif;text-align:center">
  <div style="max-width:480px;margin:0 auto;background:#F5F2EB;padding:40px 32px">
    <div style="font-family:Georgia,serif;font-size:18px;font-weight:900;color:#1A1A1A;letter-spacing:-0.5px;margin-bottom:4px">Valore Atteso</div>
    <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;letter-spacing:.12em;text-transform:uppercase;margin-bottom:32px">Scout Agent</div>
    <div style="font-size:32px;margin-bottom:16px">${titolo.startsWith('✓') ? '✅' : titolo.startsWith('✗') ? '❌' : '⚠️'}</div>
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:${colore};margin-bottom:12px">${titolo}</div>
    <div style="font-family:Georgia,serif;font-size:14px;color:#4A4845;line-height:1.65">${messaggio}</div>
    ${raccHtml}
    <div style="margin-top:32px">
      <a href="https://valoreatteso.com" style="font-family:'Courier New',monospace;font-size:9px;color:#8E6B33;text-decoration:none;letter-spacing:.08em">← Vai al sito</a>
    </div>
  </div>
</body></html>`;
}
