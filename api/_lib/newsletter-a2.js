// api/_lib/newsletter-a2.js — Template email «A2» della newsletter (bozza, non ancora usato negli invii).
//
// Tre passi separati:
//   editionToA2(edition, layout) → modello A2 dai campi che la pipeline salva oggi
//                                  (editions) più i campi nuovi del layout A2
//   validateA2(model)            → errori leggibili invece di una mail rotta
//   renderA2Html / renderA2Text  → HTML a tabelle (Outlook-safe) e versione text/plain
//
// Il template non scrive né modifica contenuti: testi e numeri arrivano dal modello.
// Merge tag: gli stessi di oggi. {{EMAIL}} lo sostituisce send-newsletter/send-test
// prima di passare l'HTML a Brevo (una sola occorrenza per parte), "Leggi online"
// punta all'archivio come nel template attuale.

const SITE = 'https://valoreatteso.com';
const UNSUBSCRIBE_URL = 'https://www.valoreatteso.com/cancella?email={{EMAIL}}';
const WEBVIEW_URL = 'https://valoreatteso.com/archivio.html';
const MOTTO = 'Il calcio dei numeri, non dei goal.';
const LEGAL = [
  'Hai ricevuto questa email perché sei iscritto a Valore Atteso.',
  "Contenuti prodotti con l'assistenza di sistemi di intelligenza artificiale, sotto supervisione e responsabilità editoriale umana. Fonti verificabili citate in ogni sezione.",
];
const MODULE_TYPES = ['bars', 'deal', 'vs', 'none'];
const LABELS = ['Il Bilancio', 'Il Deal', 'La Metrica'];
const DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

const C = {
  blue: '#00266E', ink: '#1C1914', text: '#2B2824', muted: '#4F545F', cream: '#F3EFE6',
  paper: '#FBF9F4', white: '#FFFFFF', line: '#DDD3C2', line2: '#E7DFD2', goldDark: '#E5962E',
  goldBar: '#D67F0D', goldRule: '#B08A4B', blue200: '#C9D2EA', topText: '#C9C2B6',
  legal: '#9C958A', sumRule: '#274681', // rgba(243,239,230,.16) su blu, in tinta piena per Outlook
};
const F = {
  d: "'Playfair Display',Georgia,'Times New Roman',serif",
  t: 'Inter,Arial,Helvetica,sans-serif',
  m: "'IBM Plex Mono','Courier New',monospace",
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const pad2 = n => String(n).padStart(2, '0');

// Numeri "nudi" di una stringa: "-€24M" → ["24"], "€14-15M/anno" → ["14","15"].
function numTokens(s) {
  return [...new Set(String(s || '').match(/\d+(?:[.,]\d+)*/g) || [])];
}

function truncateWords(s, max) {
  const str = String(s || '').replace(/\s+/g, ' ').trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.]$/, '') + '…';
}

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${m[3]}.${m[2]}.${m[1]}`;
}

// ── Adattatore: riga editions + campi layout A2 → modello ───────────────────
// layout (campi che la pipeline oggi NON produce): read_min, preheader, dek,
// sponsor, summary[3], watch[], sections[i].{kpi, module}. Se un campo manca
// non viene inventato: la validazione lo segnala.
function editionToA2(edition, layout = {}) {
  const num = String(edition.num || '').padStart(3, '0');
  const lsec = layout.sections || [];
  const mainSponsor = (edition.sponsors || []).find(s => s.slot_type === 'main' && s.asset);
  const sponsor = layout.sponsor !== undefined
    ? layout.sponsor
    : (mainSponsor ? { name: mainSponsor.company, url: mainSponsor.asset.cta_url || null } : null);
  const archiveEdition = `${SITE}/archivio#${num}`;
  const subject = `#${num} - ${edition.title}`;

  return {
    edition: num,
    date: edition.date,
    read_min: layout.read_min || 8,
    preheader: layout.preheader || truncateWords(edition.subtitle || edition.opener || '', 90),
    subject,
    kicker: 'Questa settimana',
    title: edition.title,
    dek: layout.dek !== undefined ? layout.dek : (edition.subtitle || ''),
    opener: layout.show_opener ? (edition.opener || '') : '',
    sponsor: sponsor && sponsor.name ? sponsor : null,
    summary: layout.summary || [],
    sections: (edition.sections || []).map((s, i) => {
      const ls = lsec[i] || {};
      const kpi = (ls.kpi !== undefined ? ls.kpi : (s.kpis || []))
        .map(k => ({ value: k.value, label: k.label }));
      const body = Array.isArray(s.body) ? s.body : String(s.body || '').split(/\n{2,}/);
      return {
        n: i + 1,
        label: s.label || LABELS[i] || `Sezione ${i + 1}`,
        title: s.title,
        kpi,
        module: ls.module || { type: 'none' },
        body: body.map(p => String(p).trim()).filter(Boolean),
        reading: s.verdict || '',
        sources: (s.sources || []).map(x => typeof x === 'string'
          ? { label: x, url: null }
          : { label: x.label || x.title || '', url: x.url || null }).filter(x => x.label),
      };
    }),
    watch: layout.watch || [],
    share: {
      whatsapp_url: 'https://wa.me/?text=' + encodeURIComponent(`Valore Atteso ${subject} ${archiveEdition}`),
      mailto_url: `mailto:?subject=Valore%20Atteso%20%23${num}%20%E2%80%94%20${encodeURIComponent(edition.title)}&body=Ti%20condivido%20l%27ultima%20edizione%20di%20Valore%20Atteso%2C%20newsletter%20sul%20business%20del%20calcio%20europeo.%0A%0AQuesta%20settimana%3A%20${encodeURIComponent(edition.title)}%0A%0AIscriviti%20gratis%3A%20valoreatteso.com`,
      signup_url: SITE,
      archive_url: `${SITE}/archivio`,
    },
    footer: { legal: LEGAL },
  };
}

// ── Validazione ─────────────────────────────────────────────────────────────
function moduleValues(mod) {
  if (!mod) return [];
  if (mod.type === 'bars') return (mod.rows || []).map(r => r.display);
  if (mod.type === 'deal') return (mod.rows || []).map(r => r.value);
  if (mod.type === 'vs') return (mod.rows || []).flatMap(r => [r.a, r.b]);
  return [];
}

function validateA2(m) {
  const errors = [];
  if (!m.title) errors.push('Manca il titolo dell\'edizione.');
  if (m.preheader && m.preheader.length > 90) errors.push(`Preheader oltre 90 caratteri (${m.preheader.length}).`);
  if (m.sponsor !== null && (!m.sponsor || !m.sponsor.name)) errors.push('Sponsor: deve essere null oppure {name, url}.');
  if (!Array.isArray(m.summary) || m.summary.length !== 3) errors.push('"In sintesi": servono esattamente 3 righe (summary).');
  if (!Array.isArray(m.sections) || m.sections.length !== 3) errors.push('Servono 3 sezioni.');

  (m.sections || []).forEach(s => {
    const tag = `Sezione ${pad2(s.n)} (${s.label})`;
    if (!s.title) errors.push(`${tag}: manca il titolo.`);
    if (!s.body.length) errors.push(`${tag}: manca il testo.`);
    if (!s.reading) errors.push(`${tag}: manca "La nostra lettura".`);
    if (!s.sources.length) errors.push(`${tag}: nessuna fonte. Senza fonti non si invia.`);
    if (s.kpi.length > 3) errors.push(`${tag}: al massimo 3 KPI.`);
    if (!MODULE_TYPES.includes(s.module.type)) errors.push(`${tag}: modulo "${s.module.type}" non valido (${MODULE_TYPES.join(', ')}).`);
    if (s.module.type === 'bars' && !(s.module.rows || []).length) errors.push(`${tag}: modulo bars senza righe.`);
    if (s.module.type === 'deal' && !(s.module.rows || []).length) errors.push(`${tag}: scheda del deal vuota.`);
    if (s.module.type === 'vs' && ((s.module.columns || []).length !== 2 || !(s.module.rows || []).length)) errors.push(`${tag}: il confronto vs vuole 2 colonne e almeno una riga.`);

    // Regola di non ripetizione: tra KPI e modulo lo stesso numero non compare due volte.
    const seen = {};
    [...s.kpi.map(k => k.value), ...moduleValues(s.module)].forEach(v => {
      numTokens(v).forEach(t => { seen[t] = (seen[t] || 0) + 1; });
    });
    const dup = Object.keys(seen).filter(t => seen[t] > 1);
    if (dup.length) errors.push(`${tag}: numero ripetuto tra KPI e modulo (${dup.join(', ')}).`);
  });

  (m.summary || []).forEach((r, i) => {
    const s = (m.sections || []).find(x => x.n === r.section_n);
    if (!r.number || !r.thesis) { errors.push(`In sintesi, riga ${i + 1}: servono numero e tesi.`); return; }
    if (r.thesis.length > 110) errors.push(`In sintesi, riga ${i + 1}: tesi oltre 110 caratteri.`);
    if (!s) { errors.push(`In sintesi, riga ${i + 1}: la sezione ${r.section_n} non esiste.`); return; }
    const pool = [...s.kpi.map(k => k.value), ...moduleValues(s.module), ...s.body].join(' ');
    const missing = numTokens(r.number).filter(t => !numTokens(pool).includes(t));
    if (missing.length) errors.push(`In sintesi, riga ${i + 1}: il numero ${r.number} non compare nella sezione ${pad2(r.section_n)}.`);
  });
  return errors;
}

// ── HTML ────────────────────────────────────────────────────────────────────
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const mono = (size, color, extra = '') =>
  `font-family:${F.m};font-size:${size}px;letter-spacing:.14em;text-transform:uppercase;color:${color};${extra}`;
const NUM = 'font-variant-numeric:lining-nums;';

function renderKpi(kpi) {
  if (!kpi.length) return '';
  const w = Math.floor(100 / kpi.length);
  const cells = kpi.map((k, i) => {
    const v = String(k.value || '');
    const size = v.length > 10 ? 18 : 24;
    const sep = i < kpi.length - 1 ? `border-right:1px solid ${C.line2};` : '';
    return `<td class="kc bd" width="${w}%" valign="top" style="padding:14px 14px 13px;${sep}">
<div class="kv d c-num" style="font-family:${F.d};font-size:${size}px;line-height:1.15;font-weight:700;color:${C.blue};${NUM}">${esc(v)}</div>
<div class="kl c-muted" style="font-family:${F.t};font-size:12.5px;line-height:1.4;color:${C.muted};padding-top:4px;">${esc(k.label)}</div>
</td>`;
  }).join('');
  return `<table ${T} width="100%" class="kpi bg-box bd" bgcolor="${C.white}" style="background:${C.white};border:1px solid ${C.line};border-top:3px solid ${C.blue};margin:0 0 16px;"><tr>${cells}</tr></table>`;
}

function renderBars(mod) {
  const max = Math.max(...mod.rows.map(r => Number(r.value) || 0), 1);
  const rows = mod.rows.map(r => {
    const pct = Math.max(1.2, Math.round((Number(r.value) || 0) / max * 1000) / 10);
    const track = pct >= 99.5
      ? `<td class="bar" width="100%" height="18" bgcolor="${C.blue}" style="background:${C.blue};font-size:0;line-height:0;">&nbsp;</td>`
      : `<td class="bar" width="${pct}%" height="18" bgcolor="${C.blue}" style="background:${C.blue};font-size:0;line-height:0;">&nbsp;</td><td class="track" width="${Math.round((100 - pct) * 10) / 10}%" height="18" bgcolor="${C.line2}" style="background:${C.line2};font-size:0;line-height:0;">&nbsp;</td>`;
    return `<tr>
<td class="bl c-text" width="30%" style="font-family:${F.t};font-size:13px;color:${C.text};padding:6px 8px 6px 0;">${esc(r.label)}</td>
<td class="bv d c-ink" width="18%" style="font-family:${F.d};font-size:15px;font-weight:700;color:${C.ink};padding:6px 10px 6px 0;white-space:nowrap;${NUM}">${esc(r.display)}</td>
<td class="bt" width="52%" style="padding:6px 0;"><table ${T} width="100%"><tr>${track}</tr></table></td>
</tr>`;
  }).join('');
  return `<table ${T} width="100%" class="bg-box bd" bgcolor="${C.white}" style="background:${C.white};border:1px solid ${C.line};margin:0 0 18px;"><tr><td style="padding:14px 16px 10px;">
<div class="m c-muted" style="${mono(10.5, C.muted)}padding-bottom:8px;">${esc(mod.title || '')}</div>
<table ${T} width="100%" class="bars">${rows}</table>
</td></tr></table>`;
}

function renderDeal(mod) {
  const rows = mod.rows.map(r => `<tr>
<td class="m c-muted bd" width="38%" valign="top" style="${mono(10.5, C.muted, 'letter-spacing:.1em;')}padding:10px 10px 10px 0;border-bottom:1px solid ${C.line2};">${esc(r.key)}</td>
<td class="c-text bd" valign="top" style="font-family:${F.t};font-size:14px;line-height:1.45;color:${C.text};padding:9px 0;border-bottom:1px solid ${C.line2};${NUM}">${esc(r.value)}</td>
</tr>`).join('');
  return `<table ${T} width="100%" style="margin:0 0 18px;">
<tr><td colspan="2" class="m c-ink bd" style="${mono(10.5, C.ink)}font-weight:600;padding:0 0 8px;border-bottom:2px solid ${C.ink};">${esc(mod.title || 'Scheda del deal')}</td></tr>
${rows}</table>`;
}

function renderVs(mod) {
  const [a, b] = mod.columns;
  const head = `<tr>
<td width="38%" class="bd" style="border-bottom:2px solid ${C.ink};padding:0 0 8px;">&nbsp;</td>
<td width="31%" class="m c-ink bd" style="${mono(10, C.ink)}font-weight:600;padding:0 6px 8px 0;border-bottom:2px solid ${C.ink};">${esc(a)}</td>
<td width="31%" class="m c-ink bd" style="${mono(10, C.ink)}font-weight:600;padding:0 0 8px;border-bottom:2px solid ${C.ink};">${esc(b)}</td>
</tr>`;
  const rows = mod.rows.map(r => `<tr>
<td class="m c-muted bd" valign="top" style="${mono(10.5, C.muted, 'letter-spacing:.1em;')}padding:10px 8px 10px 0;border-bottom:1px solid ${C.line2};">${esc(r.label)}</td>
<td class="d c-num bd" valign="top" style="font-family:${F.d};font-size:16px;font-weight:700;color:${C.blue};padding:8px 6px 8px 0;border-bottom:1px solid ${C.line2};${NUM}">${esc(r.a)}</td>
<td class="d c-num bd" valign="top" style="font-family:${F.d};font-size:16px;font-weight:700;color:${C.blue};padding:8px 0;border-bottom:1px solid ${C.line2};${NUM}">${esc(r.b)}</td>
</tr>`).join('');
  const note = mod.note
    ? `<tr><td colspan="3" class="c-muted" style="font-family:${F.t};font-size:12px;line-height:1.5;color:${C.muted};padding:8px 0 0;">${esc(mod.note)}</td></tr>`
    : '';
  return `<table ${T} width="100%" style="margin:0 0 18px;">${head}${rows}${note}</table>`;
}

function renderModule(mod) {
  if (mod.type === 'bars') return renderBars(mod);
  if (mod.type === 'deal') return renderDeal(mod);
  if (mod.type === 'vs') return renderVs(mod);
  return '';
}

function renderSources(sources) {
  const items = sources.map(s => s.url
    ? `<a class="c-link" href="${esc(s.url)}" style="color:${C.blue};text-decoration:underline;">${esc(s.label)}</a>`
    : esc(s.label)).join(' &middot; ');
  return `<p class="c-muted" style="font-family:${F.t};font-size:12.5px;line-height:1.55;color:${C.muted};margin:12px 0 0;"><span class="m c-ink" style="${mono(10, C.ink)}font-weight:600;">Fonti</span>&nbsp; ${items}</p>`;
}

function renderSection(s) {
  const paras = s.body.map(p => `<p class="c-text" style="font-family:${F.t};font-size:15.5px;line-height:1.65;color:${C.text};margin:0 0 16px;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<tr><td class="px bd" style="padding:30px 24px 24px;border-top:1px solid ${C.line};">
<a name="s${s.n}" id="s${s.n}"></a>
<table ${T}><tr>
<td class="d c-num" valign="bottom" style="font-family:${F.d};font-size:34px;line-height:1;font-weight:700;color:${C.blue};padding-right:12px;${NUM}">${pad2(s.n)}</td>
<td class="m c-muted" valign="bottom" style="${mono(10.5, C.muted)}padding-bottom:5px;">${esc(s.label)}</td>
</tr></table>
<h2 class="h2 d c-ink" style="font-family:${F.d};font-size:23px;line-height:1.22;font-weight:700;color:${C.ink};margin:12px 0 18px;">${esc(s.title)}</h2>
${renderKpi(s.kpi)}${renderModule(s.module)}${paras}
<table ${T} width="100%" bgcolor="${C.ink}" style="background:${C.ink};margin:4px 0 0;"><tr>
<td width="4" bgcolor="${C.goldBar}" style="width:4px;background:${C.goldBar};font-size:0;line-height:0;">&nbsp;</td>
<td class="rd" style="padding:18px 20px;">
<div class="m" style="${mono(10.5, C.goldDark)}font-weight:600;padding-bottom:8px;">&mdash; La nostra lettura</div>
<p style="font-family:${F.t};font-size:16px;line-height:1.55;color:${C.cream};margin:0;">${esc(s.reading)}</p>
</td></tr></table>
${renderSources(s.sources)}
</td></tr>`;
}

function renderSummary(summary) {
  const rows = summary.map((r, i) => `<tr><td class="sum-row" style="padding:12px 0;${i ? `border-top:1px solid ${C.sumRule};` : ''}">
<table ${T} width="100%"><tr>
<td class="sum-num d" width="132" valign="top" style="width:132px;font-family:${F.d};font-size:26px;line-height:1.1;font-weight:700;color:${C.cream};padding-right:12px;${NUM}">${esc(r.number)}</td>
<td class="sum-txt" valign="top">
<div class="m" style="${mono(10, C.goldDark)}padding-bottom:4px;">${pad2(r.section_n)} &middot; ${esc(r.label)}</div>
<div style="font-family:${F.t};font-size:14.5px;line-height:1.5;color:${C.blue200};">${esc(r.thesis)} <a href="#s${r.section_n}" style="color:${C.cream};font-weight:600;text-decoration:none;white-space:nowrap;">Leggi&nbsp;&darr;</a></div>
</td></tr></table>
</td></tr>`).join('');
  return `<tr><td class="px sum-wrap" style="padding:18px 24px;">
<table ${T} width="100%" bgcolor="${C.blue}" style="background:${C.blue};"><tr><td style="padding:16px 20px 6px;">
<div class="m" style="${mono(10.5, C.goldDark)}font-weight:600;padding-bottom:2px;">In sintesi &middot; ${summary.length} numeri</div>
<table ${T} width="100%">${rows}</table>
</td></tr></table>
</td></tr>`;
}

function renderWatch(watch) {
  if (!watch.length) return '';
  const items = watch.map(w => `<tr>
<td width="14" valign="top" class="c-num" style="width:14px;font-family:${F.t};font-size:15px;line-height:1.55;color:${C.blue};">&bull;</td>
<td valign="top" class="c-text" style="font-family:${F.t};font-size:15px;line-height:1.55;color:${C.text};padding:0 0 10px;"><span class="m c-num" style="${mono(10, C.blue)}font-weight:600;">${esc(w.label)}</span>&nbsp; ${esc(w.text)}</td>
</tr>`).join('');
  return `<tr><td class="px" style="padding:8px 24px 26px;">
<table ${T} width="100%"><tr><td class="bd" style="border-top:3px solid ${C.ink};padding:14px 0 0;">
<div class="m c-ink" style="${mono(10.5, C.ink)}font-weight:600;padding-bottom:12px;">Cosa guardare nelle prossime settimane</div>
<table ${T} width="100%">${items}</table>
</td></tr></table>
</td></tr>`;
}

function button(href, label, solid) {
  const bg = solid ? C.cream : C.blue;
  const fg = solid ? C.blue : C.cream;
  return `<a href="${esc(href)}" style="display:block;background:${bg};color:${fg};border:1px solid ${C.cream};font-family:${F.m};font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;text-align:center;padding:15px 12px;line-height:14px;mso-padding-alt:0;"><!--[if mso]><i style="mso-font-width:0;mso-text-raise:22pt">&nbsp;</i><![endif]--><span style="mso-text-raise:11pt;">${label}</span><!--[if mso]><i style="mso-font-width:0">&nbsp;</i><![endif]--></a>`;
}

function renderShare(m) {
  return `<tr><td class="px" bgcolor="${C.blue}" style="background:${C.blue};padding:24px;">
<p class="d" style="font-family:${F.d};font-size:20px;line-height:1.3;font-weight:700;color:${C.cream};margin:0 0 16px;text-align:center;">Un collega lavora su un club? Inoltragli il #${esc(m.edition)}.</p>
<table ${T} width="100%"><tr>
<td class="stack" width="50%" style="padding:0 4px 8px 0;">${button(m.share.whatsapp_url, 'Inoltra su WhatsApp &rarr;', true)}</td>
<td class="stack" width="50%" style="padding:0 0 8px 4px;">${button(m.share.mailto_url, 'Inoltra via email &rarr;', false)}</td>
</tr></table>
<p style="font-family:${F.t};font-size:13px;line-height:1.6;color:${C.blue200};margin:8px 0 0;text-align:center;">Te l'hanno inoltrata? <a href="${esc(m.share.signup_url)}" style="color:${C.cream};text-decoration:underline;">Iscriviti gratis</a> &middot; <a href="${esc(m.share.archive_url)}" style="color:${C.cream};text-decoration:underline;">Archivio completo</a></p>
</td></tr>`;
}

// Il monogramma ufficiale va passato come PNG@2x (opts.logo = {src, width, height}).
// Senza file si usa la sigla testuale "VA" del template attuale: niente logo ricostruito.
function monogram(opts, size) {
  if (opts.logo && opts.logo.src) {
    const h = Math.max(40, size);
    const w = Math.round(h * (opts.logo.width || 1) / (opts.logo.height || 1));
    return `<img src="${esc(opts.logo.src)}" width="${w}" height="${h}" alt="Valore Atteso" style="display:block;border:0;outline:none;width:${w}px;height:${h}px;">`;
  }
  return `<table ${T}><tr><td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;border:2px solid ${C.cream};font-family:${F.d};font-size:${Math.round(size * 0.42)}px;font-weight:700;color:${C.cream};">VA</td></tr></table>`;
}

function renderA2Html(m, opts = {}) {
  const errors = validateA2(m);
  if (errors.length) {
    const err = new Error('Template A2: dati non validi\n- ' + errors.join('\n- '));
    err.errors = errors;
    throw err;
  }
  const filler = '&zwnj;&nbsp;'.repeat(60);
  const sponsor = m.sponsor
    ? `<tr><td class="bg-paper" align="center" bgcolor="${C.paper}" style="background:${C.paper};border-bottom:1px dashed ${C.goldRule};padding:9px 24px;"><span class="m c-muted" style="${mono(10, C.muted)}">Presentato da &middot; ${m.sponsor.url ? `<a href="${esc(m.sponsor.url)}" class="c-muted" style="color:${C.muted};text-decoration:underline;">${esc(m.sponsor.name)}</a>` : esc(m.sponsor.name)}</span></td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="it" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(m.title)} - Valore Atteso #${esc(m.edition)}</title>
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&amp;family=Inter:wght@400;600&amp;family=Playfair+Display:wght@700&amp;display=swap" rel="stylesheet"><!--<![endif]-->
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>body,table,td,p,a,div,span,h1,h2{font-family:Arial,Helvetica,sans-serif !important;}.d,.d *{font-family:Georgia,'Times New Roman',serif !important;}.m,.m *{font-family:'Courier New',monospace !important;}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
.d,.kv,.sum-num{font-variant-numeric:lining-nums !important;}
@media only screen and (max-width:600px){
.wrap{width:100% !important;}
.px{padding-left:16px !important;padding-right:16px !important;}
.hide-m{display:none !important;}
.h1{font-size:25px !important;}
.h2{font-size:21px !important;}
.wm{font-size:22px !important;}
.stack{display:block !important;width:100% !important;box-sizing:border-box;padding:0 0 8px !important;}
.sum-num{display:block !important;width:100% !important;padding:0 0 6px !important;font-size:24px !important;}
.sum-txt{display:block !important;width:100% !important;}
.kpi .kc{display:block !important;width:100% !important;box-sizing:border-box;border-right:0 !important;border-bottom:1px solid ${C.line2} !important;padding:9px 12px !important;}
.kpi .kv{display:inline-block !important;width:44%;vertical-align:middle;font-size:21px !important;}
.kpi .kl{display:inline-block !important;width:54%;vertical-align:middle;text-align:right;padding-top:0 !important;}
.bars .bl{display:inline-block !important;width:58% !important;box-sizing:border-box;}
.bars .bv{display:inline-block !important;width:40% !important;box-sizing:border-box;text-align:right;padding-right:0 !important;}
.bars .bt{display:block !important;width:100% !important;padding:0 0 10px !important;}
.rd{padding:16px !important;}
.lead{padding-top:22px !important;}
.sum-wrap{padding-top:16px !important;padding-bottom:16px !important;}
.sum-row{padding:10px 0 !important;}
}
@media (prefers-color-scheme:dark){
.bg-page{background:#161412 !important;}
.bg-box,.bg-paper{background:#1F1C18 !important;}
.c-text,.c-ink{color:#EDE7DB !important;}
.c-muted{color:#B9B1A4 !important;}
.c-num,.c-link{color:#9DB4F0 !important;}
.bd{border-color:#3A352E !important;}
.kpi{border-top-color:#9DB4F0 !important;}
.track{background:#2A2621 !important;}
.bar{background:#9DB4F0 !important;}
}
[data-ogsb] .bg-page{background:#161412 !important;}
[data-ogsb] .bg-box,[data-ogsb] .bg-paper{background:#1F1C18 !important;}
[data-ogsb] .track{background:#2A2621 !important;}
[data-ogsb] .bar{background:#9DB4F0 !important;}
[data-ogsc] .c-text,[data-ogsc] .c-ink{color:#EDE7DB !important;}
[data-ogsc] .c-muted{color:#B9B1A4 !important;}
[data-ogsc] .c-num,[data-ogsc] .c-link{color:#9DB4F0 !important;}
</style>
</head>
<body class="bg-page" bgcolor="${C.cream}" style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;mso-hide:all;">${esc(m.preheader)}${filler}</div>
<table ${T} width="100%" class="bg-page" bgcolor="${C.cream}" style="background:${C.cream};"><tr><td align="center">
<!--[if mso]><table ${T} width="640" align="center"><tr><td><![endif]-->
<table ${T} width="100%" class="wrap bg-page" bgcolor="${C.cream}" style="max-width:640px;background:${C.cream};">

<tr><td class="px" bgcolor="${C.ink}" style="background:${C.ink};padding:9px 24px;">
<table ${T} width="100%"><tr>
<td class="m" style="${mono(10.5, C.topText)}">Edizione #${esc(m.edition)} &middot; ${esc(m.read_min)} min</td>
<td class="m hide-m" align="right" style="${mono(10.5, C.topText)}">${esc(formatDate(m.date))}</td>
</tr></table>
</td></tr>

<tr><td class="px" bgcolor="${C.blue}" style="background:${C.blue};padding:22px 24px 20px;">
<table ${T}><tr>
<td valign="middle" style="padding-right:14px;">${monogram(opts, 44)}</td>
<td valign="middle">
<div class="wm d" style="font-family:${F.d};font-size:26px;line-height:1.1;font-weight:700;letter-spacing:.04em;color:${C.cream};">VALORE ATTESO</div>
<div class="m" style="${mono(11, C.goldDark)}padding-top:4px;">${esc(MOTTO)}</div>
</td></tr></table>
</td></tr>
${sponsor}
<tr><td class="px lead" style="padding:26px 24px 0;">
<div class="m c-muted" style="${mono(10.5, C.muted)}padding-bottom:10px;">&mdash; ${esc(m.kicker)}</div>
<h1 class="h1 d c-ink" style="font-family:${F.d};font-size:30px;line-height:1.15;font-weight:700;color:${C.ink};margin:0 0 12px;">${esc(m.title)}</h1>
${m.dek ? `<p class="c-text" style="font-family:${F.t};font-size:16px;line-height:1.55;color:${C.text};margin:0;">${esc(m.dek)}</p>` : ''}
${m.opener ? `<p class="c-text" style="font-family:${F.t};font-size:15.5px;line-height:1.65;color:${C.text};margin:12px 0 0;">${esc(m.opener)}</p>` : ''}
</td></tr>
${renderSummary(m.summary)}
${m.sections.map(renderSection).join('\n')}
${renderWatch(m.watch)}
${renderShare(m)}

<tr><td class="px" bgcolor="${C.ink}" style="background:${C.ink};padding:24px 24px 26px;">
<table ${T}><tr>
<td valign="middle" style="padding-right:12px;">${monogram(opts, 40)}</td>
<td valign="middle" style="font-family:${F.t};font-size:12px;line-height:1.6;color:${C.topText};"><span class="d" style="font-family:${F.d};font-weight:700;color:${C.cream};">Valore Atteso</span> &middot; ogni martedì &middot; iscrizione gratuita<br>
<a href="${SITE}" style="color:${C.topText};text-decoration:none;">valoreatteso.com</a> &middot; <a href="https://instagram.com/valoreatteso" style="color:${C.topText};text-decoration:none;">@valoreatteso</a> &middot; info@valoreatteso.com</td>
</tr></table>
<p style="font-family:${F.t};font-size:12px;line-height:1.6;color:${C.legal};margin:14px 0 0;">${m.footer.legal.map(esc).join('<br>')}<br>
<a href="${WEBVIEW_URL}" style="color:${C.topText};text-decoration:underline;">Leggi online</a> &middot; Per cancellarti <a href="${UNSUBSCRIBE_URL}" style="color:${C.topText};text-decoration:underline;">clicca qui</a>.</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

// ── text/plain ──────────────────────────────────────────────────────────────
function renderA2Text(m) {
  const L = [];
  const rule = '----------------------------------------';
  L.push(`VALORE ATTESO · Edizione #${m.edition} · ${m.read_min} min · ${formatDate(m.date)}`, MOTTO, '');
  L.push(`QUESTA SETTIMANA`, m.title);
  if (m.dek) L.push(m.dek);
  if (m.opener) L.push('', m.opener);
  L.push('', 'IN SINTESI');
  m.summary.forEach(r => L.push(`- ${pad2(r.section_n)} ${r.label}: ${r.number}. ${r.thesis}`));
  m.sections.forEach(s => {
    L.push('', rule, `${pad2(s.n)} · ${s.label.toUpperCase()}`, s.title, '');
    s.kpi.forEach(k => L.push(`${k.label}: ${k.value}`));
    const mod = s.module;
    if (mod.type === 'bars') { L.push(mod.title || ''); mod.rows.forEach(r => L.push(`${r.label}: ${r.display}`)); }
    if (mod.type === 'deal') { L.push((mod.title || 'Scheda del deal').toUpperCase()); mod.rows.forEach(r => L.push(`${r.key}: ${r.value}`)); }
    if (mod.type === 'vs') {
      mod.rows.forEach(r => L.push(`${r.label}: ${mod.columns[0]} ${r.a} · ${mod.columns[1]} ${r.b}`));
      if (mod.note) L.push(mod.note);
    }
    if (s.kpi.length || mod.type !== 'none') L.push('');
    s.body.forEach(p => L.push(p, ''));
    L.push('LA NOSTRA LETTURA', s.reading, '');
    L.push('FONTI: ' + s.sources.map(x => x.url ? `${x.label} (${x.url})` : x.label).join(' · '));
  });
  if (m.watch.length) {
    L.push('', rule, 'COSA GUARDARE NELLE PROSSIME SETTIMANE');
    m.watch.forEach(w => L.push(`- ${w.label}: ${w.text}`));
  }
  L.push('', rule, `Un collega lavora su un club? Inoltragli il #${m.edition}.`);
  L.push(`WhatsApp: ${m.share.whatsapp_url}`);
  L.push(`Iscriviti gratis: ${m.share.signup_url}`, `Archivio completo: ${m.share.archive_url}`);
  L.push('', rule, 'Valore Atteso · ogni martedì · iscrizione gratuita', 'valoreatteso.com · @valoreatteso · info@valoreatteso.com', '');
  m.footer.legal.forEach(x => L.push(x));
  L.push(`Leggi online: ${WEBVIEW_URL}`, `Per cancellarti: ${UNSUBSCRIBE_URL}`);
  return L.join('\n') + '\n';
}

module.exports = { editionToA2, validateA2, renderA2Html, renderA2Text, numTokens, formatDate };
