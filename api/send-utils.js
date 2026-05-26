// api/send-utils.js — Comunicazioni one-shot + reinvio edizioni mancanti
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const resend = new Resend(process.env.RESEND_KEY);
const FROM = 'Valore Atteso <info@valoreatteso.com>';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toSentenceCase(s) {
  if (!s) return '';
  const str = String(s);
  if (str === str.toUpperCase()) return str[0] + str.slice(1).toLowerCase();
  return str;
}

// ── HTML per reinvio edizione ─────────────────────────────────────────────────
function buildEditionHtml(edition) {
  const { num, title, subtitle, date, opener, sections = [], tesi } = edition;

  function renderKpiRow(kpis) {
    if (!kpis || !kpis.length) return '';
    const rows = kpis.slice(0, 3).map((k, i) => {
      const border = i < Math.min(kpis.length, 3) - 1 ? 'border-right:1px solid #CEC3B2;' : '';
      const sub = k.sub ? `<div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;margin-top:3px;">${esc(k.sub)}</div>` : '';
      return `<td style="padding:16px 18px;${border}vertical-align:top;width:33%;">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#1C1914;letter-spacing:-.5px;line-height:1;margin-bottom:5px;">${esc(k.value)}</div>
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.04em;text-transform:uppercase;line-height:1.4;">${esc(k.label)}</div>
        ${sub}
      </td>`;
    }).join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E7DFD2;border:1px solid #CEC3B2;margin-bottom:18px;">
      <tr>${rows}</tr>
    </table>`;
  }

  function renderSection(sec, idx) {
    if (!sec || !sec.title) return '';
    const sectionLabels = ['Il Bilancio', 'Il Deal', 'La Metrica'];
    const label = sec.label || sectionLabels[idx] || `0${idx + 1}`;
    const bg = idx % 2 === 0 ? '#F0EBE1' : '#F7F4EF';
    const kpisData = sec.kpis?.length
      ? sec.kpis
      : (sec.kpi_rows?.length ? sec.kpi_rows.map(k => ({ label: k.key, value: k.value, sub: k.sub })) : []);
    const kpiRow = renderKpiRow(kpisData);
    const verdict = toSentenceCase(sec.verdict || '');
    const verdictHtml = verdict ? `
      <div style="margin-top:18px;background:#1C1914;padding:18px 20px;border-left:3px solid #C8A97A;">
        <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.16em;color:#C8A97A;text-transform:uppercase;margin-bottom:10px;">— La nostra lettura</div>
        <p style="font-family:Georgia,serif;font-size:15px;color:#FFFDF8;line-height:1.65;margin:0;font-weight:400;">${esc(verdict)}</p>
      </div>` : '';
    const bodyParas = Array.isArray(sec.body)
      ? sec.body
      : String(sec.body || '').split('\n\n').filter(p => p.trim());
    const bodyHtml = bodyParas.map(p =>
      `<p style="font-family:Georgia,serif;font-size:14px;color:#4C453D;font-weight:300;line-height:1.85;margin:0 0 14px;">${esc(p)}</p>`
    ).join('');
    return `
    <div style="background:${bg};padding:28px 28px 26px;border-bottom:2px solid #CEC3B2;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="width:26px;height:26px;background:#1C1914;border-radius:50%;text-align:center;line-height:26px;font-family:'Courier New',monospace;font-size:9px;font-weight:700;color:#C8A97A;">${idx + 1}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;">${esc(label)}</div>
        <div style="flex:1;height:1px;background:#CEC3B2;"></div>
      </div>
      <h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1C1914;letter-spacing:-.4px;line-height:1.2;margin:0 0 18px;">${esc(sec.title)}</h2>
      ${kpiRow}${bodyHtml}${verdictHtml}
    </div>`;
  }

  function renderTesi(tesi = {}) {
    if (!tesi || (!tesi.headline && !tesi.top?.length && !tesi.mid?.length)) return '';
    const topItems = (tesi.top || []).map(t => `
      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#C8A97A;flex-shrink:0;margin-top:2px;">→</span>
        <span style="font-family:Georgia,serif;font-size:13px;color:rgba(255,255,255,0.6);font-weight:300;line-height:1.5;">${esc(t)}</span>
      </div>`).join('');
    const midItems = (tesi.mid || []).map(t => `
      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#777066;flex-shrink:0;margin-top:2px;">→</span>
        <span style="font-family:Georgia,serif;font-size:13px;color:rgba(255,255,255,0.35);font-weight:300;line-height:1.5;">${esc(t)}</span>
      </div>`).join('');
    if (!topItems && !midItems) return '';
    return `
    <div style="background:#1C1914;padding:30px 28px 28px;">
      <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:.18em;color:#C8A97A;text-transform:uppercase;margin-bottom:16px;">— La tesi di Valore Atteso</div>
      <p style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#fff;line-height:1.35;margin:0 0 6px;letter-spacing:-.3px;">${esc(tesi.headline || '')}</p>
      <p style="font-family:Georgia,serif;font-size:13px;font-weight:300;color:rgba(255,255,255,0.45);line-height:1.75;margin:0 0 22px;font-style:italic;">${esc(tesi.intro || '')}</p>
      <div style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0;margin-bottom:24px;">
        <div style="padding-right:24px;">${topItems}</div>
        <div style="background:rgba(255,255,255,0.07);"></div>
        <div style="padding-left:24px;">${midItems}</div>
      </div>
    </div>`;
  }

  const sectionsHtml = sections.map((sec, i) => renderSection(sec, i)).join('');
  const tesiHtml = renderTesi(tesi);
  const siteUrl = process.env.SITE_URL || 'https://valoreatteso.com';

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(title)} — Valore Atteso #${esc(num)}</title></head>
<body style="margin:0;padding:0;background:#D8D0C4;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#D8D0C4;">
<tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#F0EBE1;">
  <tr><td style="background:#1C1914;padding:7px 28px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.45);">Problemi? <a href="${siteUrl}/archivio.html" style="color:#C8A97A;">Leggi online</a></td>
    <td align="right" style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.4);">Valore Atteso</td>
  </tr></table></td></tr>
  <tr><td style="background:#F0EBE1;padding:18px 28px 16px;border-bottom:3px solid #1C1914;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:34px;height:34px;border:2px solid #1C1914;text-align:center;vertical-align:middle;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#1C1914;">VA</td>
        <td style="padding-left:14px;">
          <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-1px;color:#1C1914;">VALORE ATTESO</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;">Il calcio dei numeri, non dei goal.</div>
        </td>
      </tr></table></td>
      <td align="right" style="vertical-align:bottom;">
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;text-transform:uppercase;">Edizione</div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#8E6B33;">#${esc(num)}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;">${esc(date || '')}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#1C1914;padding:32px 28px 28px;">
    <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#8E6B33;text-transform:uppercase;margin-bottom:12px;">— Questa settimana</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:900;color:#FFFDF8;line-height:1.1;letter-spacing:-1px;margin:0 0 8px;">${esc(title)}</h1>
    ${subtitle ? `<h2 style="font-family:Georgia,serif;font-size:16px;font-weight:400;font-style:italic;color:#C8A97A;line-height:1.3;margin:0 0 18px;">${esc(subtitle)}</h2>` : ''}
    ${opener ? `<div style="border-left:2px solid rgba(200,169,122,0.3);padding-left:14px;"><p style="font-family:Georgia,serif;font-size:13px;color:rgba(240,235,225,0.55);font-style:italic;line-height:1.8;margin:0;">${esc(opener)}</p></div>` : ''}
  </td></tr>
  <tr><td>${sectionsHtml}</td></tr>
  ${tesiHtml ? `<tr><td>${tesiHtml}</td></tr>` : ''}
  <tr><td style="background:#1C1914;padding:32px 28px;text-align:center;">
    <a href="${siteUrl}/archivio.html" style="display:inline-block;background:#C8A97A;color:#1C1914;font-family:'Courier New',monospace;font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:12px 28px;text-decoration:none;">Leggi nell\'archivio →</a>
  </td></tr>
  <tr><td style="background:#E7DFD2;border-top:3px solid #1C1914;padding:24px 28px;">
    <p style="font-family:'Courier New',monospace;font-size:8.5px;color:#9A9690;text-align:center;line-height:1.9;margin:0;">
      Hai ricevuto questa email perché sei iscritto a Valore Atteso.<br>
      Per cancellarti <a href="${siteUrl}/cancella.html?email={{EMAIL}}" style="color:#777066;">clicca qui</a>.
    </p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

// ── HANDLER PRINCIPALE ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  // ── Azione 1: comunicazione one-shot ──────────────────────────────────────
  if (action === 'communication') {
    const { subject, body, tipo, segmento, test_email } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject e body obbligatori' });

    try {
      // Modalità test: manda solo a test_email
      if (test_email) {
        const oggi = new Date().toLocaleDateString('it-IT');
        const tipoLabel = { annuncio: 'Annuncio', ritardo: 'Avviso', speciale: 'Contenuto speciale', sondaggio: 'Sondaggio', altro: 'Comunicazione' }[tipo] || 'Comunicazione';
        const html = `<table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
          <tr><td style="padding:24px 28px;background:#1A1A1A">
            <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
            <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">${tipoLabel} · ${oggi}</div>
          </td></tr>
          <tr><td style="padding:28px 28px 20px">
            <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1A1A1A;margin:0 0 18px">${esc(subject)}</h2>
            <div style="font-family:Georgia,serif;font-size:16px;color:#4A4845;line-height:1.75;white-space:pre-wrap">${esc(body)}</div>
          </td></tr>
          <tr><td style="padding:16px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0">
            <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">TEST EMAIL — non inviata agli iscritti</p>
          </td></tr>
        </table>`;
        await resend.emails.send({ from: FROM, to: test_email, subject, html });
        return res.status(200).json({ ok: true, sent: 1 });
      }

      let query = supabase.from('subscribers').select('email, created_at').eq('confirmed', true);
      if (segmento === 'ultimi30') {
        const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        query = query.gte('created_at', d30);
      }
      const { data: subs, error } = await query;
      if (error) throw new Error(error.message);
      if (!subs || !subs.length) return res.status(200).json({ ok: true, sent: 0 });

      const oggi = new Date().toLocaleDateString('it-IT');
      const tipoLabel = { annuncio: 'Annuncio', ritardo: 'Avviso', speciale: 'Contenuto speciale', sondaggio: 'Sondaggio', altro: 'Comunicazione' }[tipo] || 'Comunicazione';
      const bodyEsc = esc(body);
      const subjEsc = esc(subject);

      const html = `<table width="600" style="max-width:600px;margin:0 auto;background:#F5F2EB;font-family:Georgia,serif;border:1px solid #D0CBC0">
        <tr><td style="padding:24px 28px;background:#1A1A1A">
          <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff">Valore Atteso</div>
          <div style="font-family:'Courier New',monospace;font-size:9px;color:#D4A017;letter-spacing:.14em;text-transform:uppercase;margin-top:4px">${tipoLabel} · ${oggi}</div>
        </td></tr>
        <tr><td style="padding:28px 28px 20px">
          <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1A1A1A;margin:0 0 18px">${subjEsc}</h2>
          <div style="font-family:Georgia,serif;font-size:16px;color:#4A4845;line-height:1.75;white-space:pre-wrap">${bodyEsc}</div>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #D0CBC0;background:#EDE9E0">
          <p style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;margin:0">
            Hai ricevuto questa email perche sei iscritto a Valore Atteso.<br>
            Per cancellarti rispondi con oggetto "cancellami".
          </p>
        </td></tr>
      </table>`;

      let sent = 0;
      for (let i = 0; i < subs.length; i += 50) {
        const results = await Promise.allSettled(
          subs.slice(i, i + 50).map(s => resend.emails.send({ from: FROM, to: s.email, subject, html }))
        );
        sent += results.filter(r => r.status === 'fulfilled').length;
      }
      return res.status(200).json({ ok: true, sent });
    } catch (e) {
      console.error('[send-utils:communication]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Azione 2: reinvio edizione a iscritti mancanti ────────────────────────
  if (action === 'missing') {
    const { edition_num } = req.body;
    if (!edition_num) return res.status(400).json({ error: 'edition_num obbligatorio' });

    try {
      const num = String(edition_num).padStart(3, '0');
      const { data: editions, error: edErr } = await supabase.from('editions').select('*').eq('num', num).limit(1);
      if (edErr) throw new Error(edErr.message);
      if (!editions?.length) throw new Error('Edizione non trovata');
      const edition = editions[0];

      const { data: subs, error: subErr } = await supabase.from('subscribers').select('email').eq('confirmed', true);
      if (subErr) throw new Error(subErr.message);

      const sentTo = edition.sent_to || [];
      const missing = subs.map(s => s.email).filter(e => !sentTo.includes(e));
      if (!missing.length) return res.status(200).json({ ok: true, sent: 0, message: 'Tutti gli iscritti hanno già ricevuto questa edizione.' });

      const baseHtml = buildEditionHtml(edition);
      const subject = `#${edition.num} — ${edition.title}`;
      const RESEND_KEY = process.env.RESEND_KEY;

      const batch = missing.map(email => ({
        from: FROM, to: email, subject,
        html: baseHtml.replace('{{EMAIL}}', encodeURIComponent(email)),
      }));

      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify(batch),
      });
      const result = await r.json();
      if (!r.ok) throw new Error('Resend error: ' + JSON.stringify(result));

      const sent = Array.isArray(result.data) ? result.data.length : missing.length;
      const newSentTo = [...new Set([...sentTo, ...missing])];
      await supabase.from('editions').update({ sent_to: newSentTo, sent_count: newSentTo.length }).eq('num', num);
      await supabase.from('agent_runs').insert({
        agent: 'send-newsletter', status: 'success',
        summary: `Edizione #${num} reinviata a ${sent} iscritti mancanti.`,
        data: { num, sent, missing },
      });

      return res.status(200).json({ ok: true, sent, missing });
    } catch (e) {
      console.error('[send-utils:missing]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'action non valida. Usa: communication | missing' });
};
