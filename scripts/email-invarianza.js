// scripts/email-invarianza.js — Diff di invarianza fra due HTML dell'email (prima/dopo un restyling grafico).
// Uso: node scripts/email-invarianza.js prima.html dopo.html [report.md]
// Confronta: (a) testo visibile (head, style, commenti condizionali esclusi; spazi compressi, &nbsp; distinto),
// (b) tutti gli href e src nell'ordine in cui compaiono, (c) merge tag {{…}} e segnaposto [[…]].
// Esce con codice 1 se una delle tre liste è diversa.

const fs = require('fs');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', zwnj: '‌', bull: '•', rarr: '→', darr: '↓' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
});

function extract(html) {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  const noCom = body.replace(/<!--[\s\S]*?-->/g, ' ');
  // Le celle spaziatrici (solo &nbsp; o &zwnj;) non sono testo: si tolgono prima del confronto.
  const text = decode(noCom.replace(/<[^>]+>/g, ' ')).replace(/‌/g, '').split(/[ \t\r\n]+/).filter(w => w && !/^ +$/.test(w)).join(' ');
  const attrs = [...html.matchAll(/\b(href|src)="([^"]*)"/g)].map(m => `${m[1]}=${decode(m[2])}`);
  const tags = [...html.matchAll(/\{\{[^}]*\}\}|\[\[[^\]]*\]\]/g)].map(m => m[0]);
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
  return { text, attrs, tags, title };
}

function diffList(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push({ i, prima: a[i], dopo: b[i] });
  return out;
}

// Diff del testo per parole: riporta la prima zona diversa con un po' di contesto.
function diffText(a, b) {
  if (a === b) return [];
  const A = a.split(' '), B = b.split(' ');
  let i = 0; while (i < A.length && A[i] === B[i]) i++;
  let j = 0; while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;
  return [{ parola: i, prima: A.slice(Math.max(0, i - 5), A.length - j).join(' '), dopo: B.slice(Math.max(0, i - 5), B.length - j).join(' ') }];
}

if (require.main === module) {
  const [p, d, out] = process.argv.slice(2);
  const A = extract(fs.readFileSync(p, 'utf8'));
  const B = extract(fs.readFileSync(d, 'utf8'));
  const res = {
    testo: diffText(A.text, B.text),
    titolo: A.title === B.title ? [] : [{ prima: A.title, dopo: B.title }],
    href_src: diffList(A.attrs, B.attrs),
    tag: diffList(A.tags, B.tags),
  };
  const L = [`# Invarianza ${p.split('/').pop()} → ${d.split('/').pop()}`, '',
    `- Testo visibile: ${A.text.length} caratteri prima, ${B.text.length} dopo · differenze: **${res.testo.length + res.titolo.length}**`,
    `- href/src: ${A.attrs.length} prima, ${B.attrs.length} dopo · differenze: **${res.href_src.length}**`,
    `- Merge tag e segnaposto: ${A.tags.length} prima, ${B.tags.length} dopo · differenze: **${res.tag.length}**`, ''];
  for (const [k, v] of Object.entries(res)) if (v.length) L.push(`## ${k}`, '```json', JSON.stringify(v.slice(0, 20), null, 1), '```', '');
  const md = L.join('\n') + '\n';
  if (out) fs.writeFileSync(out, md);
  console.log(md);
  process.exit(Object.values(res).some(v => v.length) ? 1 : 0);
}

module.exports = { extract, diffList, diffText };
