// api/scout-select.js — Pagina selezione temi Scout + salvataggio scelte
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function handler(req, res) {
  const { token, confirm, bilancio, deal, metrica } = req.query || {};

  // ── POST: salva selezione ────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const { token: t, bilancio: b, deal: d, metrica: m } = body;

      const { data: row } = await supabase
        .from('agent_memory').select('value').eq('key', 'scout_pending').single();
      if (!row?.value) return res.status(404).json({ error: 'Brief non trovato' });

      const brief = row.value;
      if (t !== brief.selection_token) return res.status(403).json({ error: 'Token non valido' });

      const selezione = {
        bilancio: parseInt(b),
        deal: parseInt(d),
        metrica: parseInt(m),
        selezionato_at: new Date().toISOString()
      };

      // Salva selezione e approva il brief
      const briefApprovato = { ...brief };
      delete briefApprovato.selection_token;
      delete briefApprovato.reject_token;
      briefApprovato.stato = 'approvato';
      briefApprovato.selezione = selezione;
      briefApprovato.approvato_at = new Date().toISOString();

      await supabase.from('agent_memory').upsert({
        key: 'scout_brief', value: briefApprovato,
        written_by: 'scout', updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

      await supabase.from('agent_memory').upsert({
        key: 'scout_selezione', value: selezione,
        written_by: 'scout', updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

      await supabase.from('agent_runs').insert({
        agent: 'scout', status: 'success',
        summary: `Temi selezionati da Paolo. Bilancio: opzione ${parseInt(b)+1}, Deal: opzione ${parseInt(d)+1}, Metrica: opzione ${parseInt(m)+1}`,
        data: { selezione }
      });

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET: mostra pagina selezione ─────────────────────────────────────────
  try {
    const { data: row } = await supabase
      .from('agent_memory').select('value, updated_at').eq('key', 'scout_pending').single();

    if (!row?.value) {
      return res.status(404).send(errorPage('Nessun brief disponibile', 'Non c\'è nessun brief in attesa di selezione.'));
    }

    const brief = row.value;
    if (token !== brief.selection_token) {
      return res.status(403).send(errorPage('Link non valido', 'Il link è scaduto o non valido.'));
    }

    // Controlla se già selezionato
    const { data: selRow } = await supabase
      .from('agent_memory').select('value').eq('key', 'scout_selezione').single();
    const selCorrente = selRow?.value;
    const giaSelezionato = selCorrente?.selezionato_at &&
      new Date(selCorrente.selezionato_at) > new Date(row.updated_at);

    const opts = brief.temi_per_sezione || {
      bilancio: [], deal: [], metrica: []
    };

    const siteUrl = process.env.SITE_URL || 'https://valoreatteso.com';
    const oggi = new Date(row.updated_at).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

    const sezioneLabels = {
      bilancio: { label: '01 · IL BILANCIO', color: '#1B4332', bg: '#E4EDE7', desc: 'Conti, ricavi, costi, player trading, debito' },
      deal:     { label: '02 · IL DEAL',     color: '#1B3A6B', bg: '#E4ECF7', desc: 'M&A, fondi PE, multipli, razionale industriale' },
      metrica:  { label: '03 · LA METRICA',  color: '#6B1B1B', bg: '#F7E4E4', desc: 'KPI spiegato e messo a benchmark' }
    };

    const cardSezione = (sez, opzioni) => {
      const { label, color, bg, desc } = sezioneLabels[sez];
      const cards = opzioni.map((o, i) => `
        <label class="card" data-sez="${sez}" data-idx="${i}">
          <input type="radio" name="${sez}" value="${i}" ${giaSelezionato && selCorrente[sez] === i ? 'checked' : ''} required>
          <div class="card-inner">
            <div class="card-num" style="background:${color}">0${i+1}</div>
            <div class="card-body">
              <div class="card-title">${o.titolo}</div>
              <div class="card-summary">${o.sommario || o.summary || ''}</div>
              ${o.dati_chiave?.length ? `<div class="card-kpi">${o.dati_chiave.slice(0,2).join(' · ')}</div>` : ''}
              ${o.fonte_principale || o.source ? `<div class="card-source">📰 ${o.fonte_principale || o.source}</div>` : ''}
            </div>
            <div class="card-check">✓</div>
          </div>
        </label>`).join('');

      return `
        <div class="sezione">
          <div class="sez-header" style="border-left:4px solid ${color};background:${bg}">
            <div class="sez-label" style="color:${color}">${label}</div>
            <div class="sez-desc">${desc}</div>
          </div>
          <div class="cards">${cards}</div>
        </div>`;
    };

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Seleziona temi — Valore Atteso</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,serif;background:#D8D0C4;min-height:100vh;padding:20px 16px 40px}
  .wrap{max-width:680px;margin:0 auto}

  .header{background:#1A1A1A;padding:20px 24px;margin-bottom:0}
  .header-title{font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px}
  .header-sub{font-family:'Courier New',monospace;font-size:8px;color:#C8A97A;letter-spacing:.16em;text-transform:uppercase;margin-top:4px}

  .brief-box{background:#1A1A1A;padding:18px 24px;border-top:1px solid rgba(255,255,255,0.08);margin-bottom:3px}
  .brief-label{font-family:'Courier New',monospace;font-size:7px;color:#8E6B33;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px}
  .brief-text{font-size:14px;color:#FFFDF8;line-height:1.65;font-style:italic}

  .racc-box{background:#F0EBE1;padding:16px 24px;border-left:4px solid #C8A97A;margin-bottom:16px}
  .racc-label{font-family:'Courier New',monospace;font-size:7px;color:#8E6B33;letter-spacing:.16em;text-transform:uppercase;margin-bottom:6px}
  .racc-tema{font-size:17px;font-weight:900;color:#1A1A1A;margin-bottom:4px}
  .racc-perche{font-size:12px;color:#4A4845;line-height:1.6}

  .istruzioni{background:#F5F2EB;padding:12px 24px;margin-bottom:16px;border-bottom:2px solid #1A1A1A}
  .istr-text{font-family:'Courier New',monospace;font-size:10px;color:#777066}

  .sezione{margin-bottom:16px}
  .sez-header{padding:12px 16px;margin-bottom:8px}
  .sez-label{font-family:'Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
  .sez-desc{font-family:'Courier New',monospace;font-size:9px;color:#777066;margin-top:2px}

  .cards{display:flex;flex-direction:column;gap:8px}
  .card{cursor:pointer;display:block}
  .card input{display:none}
  .card-inner{background:#F5F2EB;border:2px solid #E2DDD4;padding:14px 16px;display:flex;gap:12px;align-items:flex-start;transition:all .15s}
  .card:hover .card-inner{border-color:#C8A97A;background:#F0EBE1}
  .card input:checked ~ .card-inner{border-color:#1A1A1A;background:#F0EBE1;box-shadow:0 0 0 1px #1A1A1A}
  .card-num{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;margin-top:2px}
  .card-body{flex:1;min-width:0}
  .card-title{font-size:14px;font-weight:700;color:#1A1A1A;line-height:1.3;margin-bottom:5px}
  .card-summary{font-size:12px;color:#4A4845;line-height:1.55;margin-bottom:6px}
  .card-kpi{font-family:'Courier New',monospace;font-size:9px;color:#8E6B33;margin-bottom:4px}
  .card-source{font-family:'Courier New',monospace;font-size:8px;color:#9A9690}
  .card-check{font-size:16px;color:#1A1A1A;opacity:0;flex-shrink:0;margin-top:2px;transition:opacity .15s}
  .card input:checked ~ .card-inner .card-check{opacity:1}

  .footer{background:#1A1A1A;padding:24px;text-align:center;margin-top:16px}
  .btn-conferma{display:inline-block;background:#1B6B3A;color:#fff;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:16px 40px;border:none;cursor:pointer;width:100%;max-width:320px}
  .btn-conferma:disabled{background:#9A9690;cursor:not-allowed}
  .stato{font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.5);margin-top:12px}

  .success-box{background:#E4EDE7;border:2px solid #1B6B3A;padding:24px;text-align:center;margin-top:16px}
  .success-title{font-size:18px;font-weight:700;color:#1B6B3A;margin-bottom:8px}
  .success-text{font-size:13px;color:#4A4845;line-height:1.6}

  @media(min-width:600px){
    .cards{flex-direction:row}
    .card{flex:1}
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="header">
    <div class="header-title">Valore Atteso</div>
    <div class="header-sub">Scout · Seleziona temi edizione · ${oggi}</div>
  </div>

  ${brief.brief_narrativo ? `
  <div class="brief-box">
    <div class="brief-label">— Brief della settimana</div>
    <div class="brief-text">${brief.brief_narrativo}</div>
  </div>` : ''}

  ${brief.raccomandazione ? `
  <div class="racc-box">
    <div class="racc-label">— Raccomandazione Scout</div>
    <div class="racc-tema">${brief.raccomandazione.tema}</div>
    <div class="racc-perche">${brief.raccomandazione.perche}</div>
  </div>` : ''}

  ${giaSelezionato ? `
  <div class="success-box">
    <div class="success-title">✓ Temi già selezionati</div>
    <div class="success-text">Hai già confermato la selezione. L'Editoriale Agent la userà lunedì alle 8:00 per generare la bozza.<br><br>Puoi modificare la selezione qui sotto e riconfermare.</div>
  </div>` : ''}

  <div class="istruzioni">
    <div class="istr-text">Seleziona UN tema per ogni sezione → Conferma selezione</div>
  </div>

  <form id="form-selezione">
    ${cardSezione('bilancio', opts.bilancio || [])}
    ${cardSezione('deal', opts.deal || [])}
    ${cardSezione('metrica', opts.metrica || [])}

    <div class="footer">
      <button type="submit" class="btn-conferma" id="btn-conferma">Conferma selezione →</button>
      <div class="stato" id="stato-msg">Seleziona un tema per ogni sezione</div>
    </div>
  </form>

</div>

<script>
const TOKEN = '${token}';
const API = '${siteUrl}/api/scout-select';

// Aggiorna stato bottone
function checkSelezione() {
  const b = document.querySelector('input[name="bilancio"]:checked');
  const d = document.querySelector('input[name="deal"]:checked');
  const m = document.querySelector('input[name="metrica"]:checked');
  const btn = document.getElementById('btn-conferma');
  const msg = document.getElementById('stato-msg');
  if (b && d && m) {
    btn.disabled = false;
    msg.textContent = 'Pronto per confermare';
    msg.style.color = '#C8A97A';
  } else {
    btn.disabled = true;
    const mancanti = [];
    if (!b) mancanti.push('Il Bilancio');
    if (!d) mancanti.push('Il Deal');
    if (!m) mancanti.push('La Metrica');
    msg.textContent = 'Seleziona ancora: ' + mancanti.join(', ');
    msg.style.color = 'rgba(255,255,255,0.4)';
  }
}

document.querySelectorAll('input[type="radio"]').forEach(function(r) {
  r.addEventListener('change', checkSelezione);
});
checkSelezione();

document.getElementById('form-selezione').addEventListener('submit', async function(e) {
  e.preventDefault();
  const b = document.querySelector('input[name="bilancio"]:checked')?.value;
  const d = document.querySelector('input[name="deal"]:checked')?.value;
  const m = document.querySelector('input[name="metrica"]:checked')?.value;
  if (b == null || d == null || m == null) return;

  const btn = document.getElementById('btn-conferma');
  const msg = document.getElementById('stato-msg');
  btn.disabled = true;
  btn.textContent = 'Salvataggio...';

  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, bilancio: b, deal: d, metrica: m })
    });
    const data = await r.json();
    if (r.ok && data.ok) {
      btn.textContent = '✓ Selezione confermata';
      btn.style.background = '#1B6B3A';
      msg.textContent = "L'Editoriale Agent genererà la bozza lunedì alle 8:00";
      msg.style.color = '#C8A97A';
      // Scroll top per conferma visiva
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      throw new Error(data.error || 'Errore sconosciuto');
    }
  } catch(err) {
    btn.disabled = false;
    btn.textContent = 'Conferma selezione →';
    msg.textContent = 'Errore: ' + err.message;
    msg.style.color = '#C8251D';
  }
});
</script>
</body>
</html>`;

    return res.status(200).send(html);

  } catch (e) {
    console.error('[scout-select]', e);
    return res.status(500).send(errorPage('Errore', e.message));
  }
};

function errorPage(titolo, messaggio) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${titolo} — Valore Atteso</title></head>
<body style="margin:0;padding:40px 20px;background:#D8D0C4;font-family:Georgia,serif;text-align:center">
  <div style="max-width:400px;margin:0 auto;background:#F5F2EB;padding:40px 24px">
    <div style="font-size:18px;font-weight:900;color:#1A1A1A;margin-bottom:16px">Valore Atteso</div>
    <div style="font-size:16px;font-weight:700;color:#C8251D;margin-bottom:8px">${titolo}</div>
    <div style="font-size:13px;color:#4A4845;line-height:1.6">${messaggio}</div>
    <div style="margin-top:24px"><a href="https://valoreatteso.com" style="font-family:'Courier New',monospace;font-size:9px;color:#8E6B33">← Vai al sito</a></div>
  </div>
</body></html>`;
}
