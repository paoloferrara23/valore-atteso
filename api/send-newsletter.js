// api/send-newsletter.js
// CommonJS — Vercel serverless function
const { createClient } = require('@supabase/supabase-js');
const { loadEditionSponsors } = require('../lib/sponsor-edition-data');
const { buildHtml } = require('../lib/build-html');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_KEY
);

async function handler(req, res) {
  if (String((req.query && req.query.action) || '') === 'utils') {
    const sendUtilsHandler = require('../lib/send-utils');
    return sendUtilsHandler(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const CR_TOKEN = process.env.CR_PASSWORD || 'valopro2025';
  const token = req.headers['x-cr-token'];
  if (token !== CR_TOKEN) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const { edition_num, edition_id } = req.body;

    let query = supabase.from('editions').select('*').eq('published', true);
    if (edition_id) query = query.eq('id', edition_id);
    else if (edition_num) query = query.eq('num', String(edition_num).padStart(3, '0'));
    else return res.status(400).json({ error: 'Parametro edition_num o edition_id obbligatorio' });

    const { data: editions, error: edErr } = await query.limit(1);
    if (edErr) throw new Error('Supabase: ' + edErr.message);
    if (!editions || !editions.length) throw new Error('Edizione non trovata o non pubblicata');
    const edition = editions[0];
    edition.sponsors = await loadEditionSponsors(supabase, edition.id);

    const { data: subs, error: subErr } = await supabase
      .from('subscribers')
      .select('email')
      .eq('confirmed', true);
    if (subErr) throw new Error('Supabase subscribers: ' + subErr.message);
    if (!subs || !subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'Nessun iscritto confermato' });

    const html = buildHtml(edition);
    const subject = `#${edition.num} - ${edition.title}`;

    let sent = 0;
    let errors = 0;

    const makeBatch = arr => arr.map(sub => ({
      from: 'Valore Atteso <info@valoreatteso.com>',
      to: sub.email,
      subject,
      html: html
        .replace('{{EMAIL}}', encodeURIComponent(sub.email))
        .replace('{{WEBVIEW_URL}}', `https://valoreatteso.com/archivio#${edition.num}`),
    }));

    async function sendBatch(arr) {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_KEY}` },
        body: JSON.stringify(makeBatch(arr)),
      });
      const raw = await res.text();
      let result;
      try { result = JSON.parse(raw); } catch(e) { throw new Error('Resend: ' + raw.slice(0, 200)); }
      if (!res.ok) throw new Error('Resend ' + res.status + ': ' + JSON.stringify(result));
      return Array.isArray(result.data) ? result.data.length : arr.length;
    }

    const mid = Math.ceil(subs.length / 2);
    sent += await sendBatch(subs.slice(0, mid));
    sent += await sendBatch(subs.slice(mid));

    // Usa subs.length come valore garantito se Resend non ritorna data correttamente
    const finalSent = sent > 0 ? sent : subs.length;
    const sentEmails = subs.map(s => s.email);
    await supabase
      .from('editions')
      .update({ sent_at: new Date().toISOString(), sent_count: finalSent, sent_to: sentEmails })
      .eq('id', edition.id);

    try {
      await supabase.from('editorial_wiki').upsert({
        categoria: 'edizione',
        chiave: `ed_${edition.num}`,
        valore: `Edizione #${edition.num}: ${edition.title} | ${(edition.sections||[]).map(s=>s.title||s.titolo||'').join(' / ')}`,
        fonte: 'sistema',
        edizione_ref: edition.num,
        updated_at: new Date().toISOString()
      }, { onConflict: 'chiave' });
      for (let i = 0; i < (edition.sections||[]).length; i++) {
        const s = edition.sections[i];
        await supabase.from('editorial_wiki').upsert({
          categoria: 'club_analizzato',
          chiave: `club_ed${edition.num}_${i}`,
          valore: `Analizzato in #${edition.num}: ${s.title||s.titolo||''}`,
          fonte: 'sistema', edizione_ref: edition.num,
          updated_at: new Date().toISOString()
        }, { onConflict: 'chiave' });
      }
    } catch(wikiErr) { console.warn('Wiki update fallito:', wikiErr.message); }

    await supabase.from('agent_runs').insert({
      agent: 'send-newsletter',
      status: errors === 0 ? 'success' : 'partial',
      summary: `Edizione #${edition.num} inviata a ${sent} iscritti. Errori: ${errors}.`,
      data: { edition_num: edition.num, sent, errors },
    });

    return res.status(200).json({
      ok: true,
      edition: `#${edition.num}`,
      sent,
      errors,
      sponsors: edition.sponsors.length
    });

  } catch (err) {
    console.error('[send-newsletter]', err);
    await supabase.from('agent_runs').insert({
      agent: 'send-newsletter',
      status: 'error',
      summary: err.message,
    }).catch(() => {});
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
module.exports.buildHtml = buildHtml;
