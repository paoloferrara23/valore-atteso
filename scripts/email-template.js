// email-template.js — Template HTML condiviso per tutte le email agenti
// Design system: header nero + badge stato, corpo crema, Georgia serif, verde #1B4332

function agentEmail({ agentName, agentKey, status, date, runTime, sections }) {
  const statusConfig = {
    success:          { bg: '#1B4332', color: '#4ADE80', label: 'SUCCESS' },
    pending_approval: { bg: '#854D0E', color: '#FCD34D', label: 'IN ATTESA' },
    warning:          { bg: '#854D0E', color: '#FCD34D', label: 'ATTENZIONE' },
    error:            { bg: '#7F1D1D', color: '#FCA5A5', label: 'ERRORE' },
    triggered:        { bg: '#1B3A6B', color: '#93C5FD', label: 'AVVIATO' },
  };
  const st = statusConfig[status] || statusConfig.success;

  const sectionsHTML = sections.map(s => renderSection(s)).join('');

  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${agentName} — Valore Atteso</title></head>
<body style="margin:0;padding:0;background:#C8C0B4">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#C8C0B4">
<tr><td align="center" style="padding:24px 16px">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">

  <!-- HEADER -->
  <tr><td style="background:#1A1A1A;padding:28px 32px 24px;border-bottom:3px solid #C8A97A">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:middle">
          <div style="font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#C8A97A;letter-spacing:.2em;text-transform:uppercase">Valore Atteso</div>
          <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.3);letter-spacing:.1em;margin-top:2px">SISTEMA AGENTI</div>
        </td>
        <td style="text-align:right;vertical-align:middle">
          <span style="display:inline-block;background:${st.bg};color:${st.color};font-family:'Courier New',monospace;font-size:8px;font-weight:700;letter-spacing:.12em;padding:5px 12px;text-transform:uppercase">● ${st.label}</span>
        </td>
      </tr>
    </table>
    <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08)">
      <div style="font-family:Georgia,serif;font-size:26px;font-weight:900;color:#FFFDF8;letter-spacing:-1px;line-height:1">${agentName}</div>
      <div style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.35);margin-top:6px;letter-spacing:.06em">${date}${runTime ? ' · ' + runTime : ''}</div>
    </div>
  </td></tr>

  <!-- SECTIONS -->
  ${sectionsHTML}

  <!-- FOOTER -->
  <tr><td style="background:#1A1A1A;padding:14px 32px;border-top:3px solid #C8A97A">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.25)">${agentKey} · Valore Atteso · Run automatico</td>
      <td style="text-align:right;font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.15)">valoreatteso.com</td>
    </tr></table>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function renderSection(s) {
  switch(s.type) {
    case 'narrative':   return sNarrative(s);
    case 'kpi_grid':    return sKpiGrid(s);
    case 'dark_cards':  return sDarkCards(s);
    case 'actions':     return sActions(s);
    case 'alert':       return sAlert(s);
    case 'table':       return sTable(s);
    case 'post_card':   return sPostCard(s);
    case 'topics':      return sTopics(s);
    case 'divider':     return sDivider(s);
    default:            return '';
  }
}

// ── SECTION RENDERERS ────────────────────────────────────────────────────────

function sNarrative({ label, text, dark = false }) {
  const bg = dark ? '#242424' : '#F5F2EB';
  const labelColor = dark ? '#C8A97A' : '#8E6B33';
  const textColor = dark ? 'rgba(255,255,255,0.82)' : '#1A1A1A';
  const border = dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #E0DBD3';
  return `<tr><td style="background:${bg};padding:20px 32px;border-bottom:${border}">
    ${label ? `<div style="font-family:'Courier New',monospace;font-size:7px;color:${labelColor};letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px">— ${label}</div>` : ''}
    <div style="font-family:Georgia,serif;font-size:14px;color:${textColor};line-height:1.7;font-style:italic">${text}</div>
  </td></tr>`;
}

function sKpiGrid({ kpis }) {
  const cols = kpis.map((k, i) => {
    const border = i < kpis.length - 1 ? 'border-right:1px solid #E0DBD3;' : '';
    return `<td style="${border}padding:20px 24px;text-align:center;vertical-align:top;width:${Math.floor(100/kpis.length)}%">
      <div style="font-family:Georgia,serif;font-size:30px;font-weight:900;color:${k.color||'#1A1A1A'};line-height:1;letter-spacing:-1px">${k.value}</div>
      <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;text-transform:uppercase;letter-spacing:.1em;margin-top:7px">${k.label}</div>
      ${k.sub ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:${k.subColor||'#9A9690'};margin-top:4px">${k.sub}</div>` : ''}
    </td>`;
  }).join('');
  return `<tr><td style="background:#F5F2EB;border-bottom:3px solid #1A1A1A;padding:0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table>
  </td></tr>`;
}

function sDarkCards({ label, cards }) {
  const cardsHTML = cards.map((c, i) => {
    const border = i < cards.length - 1 ? 'padding-right:10px' : 'padding-left:10px';
    const accentBorder = c.accent ? `border:1px solid rgba(${c.accent},0.3);background:rgba(${c.accent},0.05)` : 'border:1px solid rgba(255,255,255,0.08)';
    return `<td style="width:${Math.floor(100/cards.length)}%;vertical-align:top;${i>0?'padding-left:10px':'padding-right:10px'}">
      <div style="${accentBorder};padding:14px 16px">
        <div style="font-family:'Courier New',monospace;font-size:7px;color:${c.labelColor||'#9A9690'};text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">${c.label}</div>
        <div style="font-family:Georgia,serif;font-size:17px;font-weight:700;color:${c.valueColor||'#FFFDF8'}">${c.value}</div>
        ${c.sub ? `<div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;margin-top:3px">${c.sub}</div>` : ''}
      </div>
    </td>`;
  }).join('');
  return `<tr><td style="background:#1A1A1A;padding:20px 32px;border-bottom:1px solid #2A2A2A">
    ${label ? `<div style="font-family:'Courier New',monospace;font-size:7px;color:#C8A97A;letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px">— ${label}</div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0"><tr>${cardsHTML}</tr></table>
  </td></tr>`;
}

function sActions({ label, items }) {
  const itemsHTML = items.map((item, i) => `
    <div style="display:flex;margin-bottom:${i < items.length-1 ? '8px' : '0'}">
      <div style="background:#1A1A1A;color:#C8A97A;font-family:'Courier New',monospace;font-size:9px;font-weight:700;padding:12px 14px;flex-shrink:0;min-width:32px;text-align:center">${String(i+1).padStart(2,'0')}</div>
      <div style="background:#fff;border-bottom:1px solid #E0DBD3;border-left:3px solid #1B4332;padding:12px 16px;flex:1">
        <div style="font-family:Georgia,serif;font-size:13px;color:#1A1A1A;line-height:1.55">${item}</div>
      </div>
    </div>`).join('');
  return `<tr><td style="background:#F5F2EB;padding:20px 32px;border-bottom:1px solid #E0DBD3">
    <div style="font-family:'Courier New',monospace;font-size:7px;color:#C8251D;letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px">— ${label||'Azioni questa settimana'}</div>
    ${itemsHTML}
  </td></tr>`;
}

function sAlert({ text, type = 'warning', level }) {
  const cfg = {
    warning: { bg: '#FEF3F2', border: '#FECACA', accent: '#C8251D', emoji: '⚠', label: 'Rischio da monitorare' },
    info:    { bg: '#EFF6FF', border: '#BFDBFE', accent: '#1B3A6B', emoji: 'ℹ', label: 'Nota' },
    success: { bg: '#F0FDF4', border: '#BBF7D0', accent: '#1B4332', emoji: '✓', label: 'Positivo' },
  };
  // severità: 'level' se passato, altrimenti 'type' (ma 'alert' e il tipo di routing → default warning)
  const sev = level || (type && type !== 'alert' ? type : 'warning');
  const c = cfg[sev] || cfg.warning;
  return `<tr><td style="background:#F5F2EB;padding:0 32px 20px">
    <div style="background:${c.bg};border:1px solid ${c.border};border-left:3px solid ${c.accent};padding:13px 16px">
      <div style="font-family:'Courier New',monospace;font-size:7px;color:${c.accent};letter-spacing:.12em;text-transform:uppercase;margin-bottom:5px">${c.emoji} ${c.label}</div>
      <div style="font-family:Georgia,serif;font-size:13px;color:#4A4845;line-height:1.55">${text}</div>
    </div>
  </td></tr>`;
}

function sTable({ label, headers, rows }) {
  const headHTML = headers.map(h => `<th style="padding:8px 12px;text-align:${h.align||'left'};font-family:'Courier New',monospace;font-size:7px;color:#C8A97A;font-weight:400;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap">${h.label}</th>`).join('');
  const rowsHTML = rows.map((row, ri) => {
    const bg = ri % 2 === 0 ? '#F5F2EB' : '#FAFAF8';
    const cells = row.map((cell, ci) => `<td style="padding:9px 12px;text-align:${headers[ci]?.align||'left'};border-bottom:1px solid #E0DBD3;font-family:${cell.mono?'\'Courier New\',monospace':'Georgia,serif'};font-size:${cell.mono?'11':'13'}px;color:${cell.color||'#1A1A1A'};font-weight:${cell.bold?'700':'400'}">${cell.value||cell}</td>`).join('');
    return `<tr style="background:${bg}">${cells}</tr>`;
  }).join('');
  return `<tr><td style="background:#F5F2EB;padding:0 32px 20px;border-top:1px solid #E0DBD3">
    ${label ? `<div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px;padding-top:20px">— ${label}</div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#1A1A1A">${headHTML}</tr>
      ${rowsHTML}
    </table>
  </td></tr>`;
}

function sPostCard({ tipo, label, labelBg, labelFg, angolo, datoPrincipale, testo, quando, perche, slide }) {
  const testoEsc = (testo||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const slideHTML = slide?.length ? `
    <div style="margin-top:12px;padding:12px 14px;background:#1A1A1A">
      <div style="font-family:'Courier New',monospace;font-size:7px;color:#C8A97A;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Slide carosello</div>
      ${slide.map((s,i)=>`<div style="font-family:Georgia,serif;font-size:11px;color:#FFFDF8;margin-bottom:6px;padding-left:10px;border-left:2px solid #C8A97A"><strong>${i+1}.</strong> ${s.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>`).join('')}
    </div>` : '';
  return `<tr><td style="padding:0 32px 16px;background:#F5F2EB">
    <div style="border:2px solid ${labelBg||'#1B3A6B'}">
      <div style="background:${labelBg||'#1B3A6B'};padding:10px 16px;display:flex;justify-content:space-between">
        <span style="font-family:'Courier New',monospace;font-size:8px;font-weight:700;color:${labelFg||'#fff'};letter-spacing:.1em;text-transform:uppercase">${label||tipo}</span>
        <span style="font-family:'Courier New',monospace;font-size:8px;color:rgba(255,255,255,0.55)">${quando||''}</span>
      </div>
      <div style="background:#EAE5DC;padding:10px 16px;border-bottom:1px solid ${labelBg||'#1B3A6B'}">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:${labelBg||'#1B3A6B'}">Angolo: ${angolo||''}</div>
        ${datoPrincipale ? `<div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:${labelBg||'#1B3A6B'};margin-top:4px;letter-spacing:-0.5px">${datoPrincipale}</div>` : ''}
      </div>
      <div style="padding:14px 16px;background:#F5F2EB">
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#9A9690;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Testo pronto da copiare</div>
        <div style="font-family:Georgia,serif;font-size:13px;color:#1A1A1A;line-height:1.7;white-space:pre-wrap">${testoEsc}</div>
        ${slideHTML}
      </div>
      ${perche ? `<div style="padding:9px 16px;background:#EAE5DC;border-top:1px solid #D5CFC5">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#777066;font-style:italic">${perche}</div>
      </div>` : ''}
    </div>
  </td></tr>`;
}

function sTopics({ label, topics }) {
  const topicsHTML = topics.map((t, i) => {
    const sezColors = { bilancio: ['#1B4332','#E4EDE7'], deal: ['#1B3A6B','#E4ECF7'], metrica: ['#6B1B1B','#F7E4E4'] };
    const [fg, bg] = sezColors[t.sezione] || ['#4A4845','#EDE9E0'];
    const fontiHTML = (t.fonti||[]).map(f => {
      const url = f.match(/https?:\/\/[^\s"]+/)?.[0];
      const lbl = f.replace(/\s*—\s*https?:\/\/[^\s"]+/,'').trim();
      return url ? `<a href="${url}" style="color:${fg};font-size:9px;text-decoration:underline;font-family:'Courier New',monospace">${lbl}</a>` : `<span style="font-size:9px;color:#9A9690;font-family:'Courier New',monospace">${lbl}</span>`;
    }).join(' · ');
    const verificaHTML = t.verifica_biblioteca && t.verifica_biblioteca !== 'N/A'
      ? `<div style="font-family:'Courier New',monospace;font-size:8px;color:#1B4332;margin-top:5px">📚 ${t.verifica_biblioteca}</div>` : '';
    return `<div style="margin-bottom:${i<topics.length-1?'12px':'0'};border-left:3px solid ${fg}">
      <div style="background:${fg};padding:8px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-family:'Courier New',monospace;font-size:8px;font-weight:700;color:#fff;background:rgba(255,255,255,0.15);padding:2px 7px">#${i+1}</span>
        <span style="font-family:'Courier New',monospace;font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.08em">${t.sezione_suggerita||t.sezione} · priorità ${t.priorita||'—'}/5</span>
      </div>
      <div style="background:#fff;padding:12px 14px;border-bottom:1px solid #E0DBD3">
        <div style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#1A1A1A;margin-bottom:5px;line-height:1.3">${t.titolo}</div>
        <div style="font-family:Georgia,serif;font-size:12px;color:#4A4845;line-height:1.6;margin-bottom:8px">${t.sommario||t.notizia||''}</div>
        <div style="background:${bg};padding:9px 12px;border-left:2px solid ${fg};margin-bottom:6px">
          <div style="font-family:'Courier New',monospace;font-size:7px;color:${fg};letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px">Lettura CF</div>
          <div style="font-family:Georgia,serif;font-size:12px;color:#1A1A1A;line-height:1.5">${t.analisi_cf||''}</div>
        </div>
        ${t.dati_chiave?.length ? `<div style="font-family:'Courier New',monospace;font-size:9px;color:#4A4845;margin-bottom:5px">${t.dati_chiave.join(' · ')}</div>` : ''}
        ${verificaHTML}
        <div style="font-family:'Courier New',monospace;font-size:8px;color:#9A9690;border-top:1px solid #E8E3DC;padding-top:6px;margin-top:6px">${fontiHTML}</div>
      </div>
    </div>`;
  }).join('');
  return `<tr><td style="background:#F5F2EB;padding:20px 32px;border-top:1px solid #E0DBD3">
    ${label ? `<div style="font-family:'Courier New',monospace;font-size:7px;color:#777066;letter-spacing:.16em;text-transform:uppercase;margin-bottom:14px">— ${label}</div>` : ''}
    ${topicsHTML}
  </td></tr>`;
}

function sDivider() {
  return `<tr><td style="background:#F5F2EB;padding:0 32px"><div style="border-top:1px solid #E0DBD3"></div></td></tr>`;
}

module.exports = { agentEmail, renderSection };
