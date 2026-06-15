// lib/scout-select.js - Private Scout topic selection page.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseChoice(value, options) {
  const index = Number.parseInt(value, 10);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return null;
  return { index, topic: options[index] };
}

function errorPage(title, message) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Valore Atteso</title></head><body style="margin:0;padding:40px 20px;background:#d8d0c4;font-family:Georgia,serif;color:#1c1914"><main style="max-width:560px;margin:auto;background:#fffdf8;padding:36px;border:1px solid #cec3b2"><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}

function topicCard(section, topic, index, selected) {
  return `<label class="topic"><input type="radio" name="${section}" value="${index}" ${selected ? 'checked' : ''} required><span class="topic-body"><strong>${esc(topic.titolo || topic.title)}</strong><small>${esc(topic.sommario || topic.summary)}</small><em>${esc(topic.fonte_principale || topic.source || '')}</em></span></label>`;
}

module.exports = async function handler(req, res) {
  try {
    const { data: row, error } = await supabase
      .from('agent_memory')
      .select('value,updated_at')
      .eq('key', 'scout_pending')
      .single();
    if (error || !row?.value) {
      if (req.method === 'POST') return res.status(404).json({ ok: false, error: 'Brief Scout non trovato' });
      return res.status(404).send(errorPage('Brief non disponibile', 'Non esiste un brief Scout in attesa di selezione.'));
    }

    const pending = row.value;
    const token = req.method === 'POST' ? String(req.body?.token || '') : String(req.query?.token || '');
    if (!token || token !== pending.selection_token) {
      if (req.method === 'POST') return res.status(403).json({ ok: false, error: 'Link non valido o scaduto' });
      return res.status(403).send(errorPage('Link non valido', 'Questo link non appartiene al brief Scout corrente.'));
    }

    const options = pending.temi_per_sezione || {};
    const briefId = pending.brief_id || `legacy-${new Date(row.updated_at).getTime()}`;

    if (req.method === 'POST') {
      const bilancio = parseChoice(req.body?.bilancio, options.bilancio || []);
      const deal = parseChoice(req.body?.deal, options.deal || []);
      const metrica = parseChoice(req.body?.metrica, options.metrica || []);
      if (!bilancio || !deal || !metrica) {
        return res.status(400).json({ ok: false, error: 'Seleziona un tema valido per ogni sezione' });
      }

      const approvedAt = new Date().toISOString();
      const selection = {
        brief_id: briefId,
        stato: 'approved',
        bilancio: bilancio.index,
        deal: deal.index,
        metrica: metrica.index,
        temi: {
          bilancio: bilancio.topic,
          deal: deal.topic,
          metrica: metrica.topic
        },
        selezionato_at: approvedAt
      };
      const approvedBrief = {
        ...pending,
        brief_id: briefId,
        stato: 'approvato',
        selezione: selection,
        approvato_at: approvedAt
      };
      delete approvedBrief.selection_token;

      const writes = await Promise.all([
        supabase.from('agent_memory').upsert({
          key: 'scout_brief',
          value: approvedBrief,
          written_by: 'scout',
          updated_at: approvedAt
        }, { onConflict: 'key' }),
        supabase.from('agent_memory').upsert({
          key: 'scout_selezione',
          value: selection,
          written_by: 'scout',
          updated_at: approvedAt
        }, { onConflict: 'key' }),
        supabase.from('agent_runs').insert({
          agent: 'scout',
          status: 'success',
          summary: 'Temi Scout selezionati e collegati al brief corrente.',
          data: { brief_id: briefId, selezione: selection }
        })
      ]);
      const writeError = writes.find(result => result.error)?.error;
      if (writeError) throw writeError;
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const { data: selectionRow } = await supabase
      .from('agent_memory')
      .select('value')
      .eq('key', 'scout_selezione')
      .single();
    const current = selectionRow?.value?.brief_id === briefId && selectionRow.value.stato === 'approved'
      ? selectionRow.value
      : null;
    const sections = [
      ['bilancio', '01 - Il Bilancio'],
      ['deal', '02 - Il Deal'],
      ['metrica', '03 - La Metrica']
    ];
    const sectionHtml = sections.map(([key, label]) => `<section><h2>${label}</h2><div class="topics">${(options[key] || []).map((topic, index) => topicCard(key, topic, index, current?.[key] === index)).join('')}</div></section>`).join('');

    return res.status(200).send(`<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Selezione Scout | Valore Atteso</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px 16px 60px;background:#d8d0c4;color:#1c1914;font-family:Georgia,serif}.wrap{max-width:760px;margin:auto}.head{background:#1c1914;color:#fffdf8;padding:26px}.eyebrow{font:9px "Courier New",monospace;letter-spacing:.15em;text-transform:uppercase;color:#c8a97a}h1{margin:8px 0 0;font-size:32px}section{background:#f7f4ef;padding:22px;margin-top:12px;border:1px solid #cec3b2}h2{font-size:19px;margin:0 0 13px}.topics{display:grid;gap:9px}.topic{display:block;cursor:pointer}.topic input{position:absolute;opacity:0}.topic-body{display:block;padding:16px;background:#fffdf8;border:2px solid #e2ddd4}.topic input:checked+.topic-body{border-color:#1c1914;background:#f0ebe1}.topic strong,.topic small,.topic em{display:block}.topic small{margin-top:7px;color:#4c453d;line-height:1.55}.topic em{margin-top:8px;font:8px "Courier New",monospace;color:#8e6b33}.footer{padding:22px;background:#1c1914;text-align:center}.footer button{width:100%;max-width:360px;border:0;background:#c8a97a;color:#1c1914;padding:15px;font:700 10px "Courier New",monospace;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}.footer button:disabled{opacity:.5}.status{margin-top:10px;color:#fffdf8;font:9px "Courier New",monospace}@media(min-width:680px){.topics{grid-template-columns:repeat(3,1fr)}}
</style></head><body><main class="wrap"><header class="head"><div class="eyebrow">Brief Scout corrente</div><h1>Seleziona i tre temi.</h1></header><form id="selection">${sectionHtml}<div class="footer"><button id="submit" type="submit">Conferma selezione</button><div class="status" id="status">${current ? 'Selezione gia registrata per questo brief.' : 'Scegli un tema per ogni sezione.'}</div></div></form></main>
<script>
const token=${JSON.stringify(token)};
document.getElementById('selection').addEventListener('submit',async function(event){
  event.preventDefault();
  const button=document.getElementById('submit'),status=document.getElementById('status');
  const value=name=>document.querySelector('input[name="'+name+'"]:checked')?.value;
  const payload={token,bilancio:value('bilancio'),deal:value('deal'),metrica:value('metrica')};
  if(payload.bilancio==null||payload.deal==null||payload.metrica==null){status.textContent='Seleziona un tema per ogni sezione.';return}
  button.disabled=true;button.textContent='Salvataggio...';
  try{const response=await fetch('/api/scout-select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'Errore');button.textContent='Selezione confermata';status.textContent='Redazione usera esclusivamente questi tre temi.'}
  catch(error){button.disabled=false;button.textContent='Conferma selezione';status.textContent='Errore: '+error.message}
});
</script></body></html>`);
  } catch (error) {
    console.error('[scout-select]', error);
    if (req.method === 'POST') return res.status(500).json({ ok: false, error: error.message });
    return res.status(500).send(errorPage('Errore', error.message));
  }
};
