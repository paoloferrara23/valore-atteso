// scripts/qa-redazione.js — Test di accettazione dell'agente redazione (Parte B).
// Offline: nessuna rete, nessun database, nessun invio. I dati sono di fantasia ("Valdorra").
// Uso:
//   node scripts/qa-redazione.js                         # test sintetici
//   node scripts/qa-redazione.js bozza.json [altra.json] # in più: ogni riga `editions` indicata deve passare tutti i controlli
// Esce con codice 1 se un test fallisce.

const fs = require('fs');
const path = require('path');
const { editorialChecks, emailRenderChecks, evalFormula } = require('../api/_lib/editorial-checks');
const { contentPreflight } = require('../api/_lib/preflight');
const { contractFromRow } = require('../api/_lib/email/contract');
const { build } = require('../api/_lib/email/build');
const guard = require('../api/_lib/redazione-guard');

let pass = 0, fail = 0;
const rows = [];
function t(name, ok, detail) {
  (ok ? pass++ : fail++);
  rows.push(`${ok ? '  ok ' : ' FAIL'}  ${name}${!ok && detail ? '\n        ' + detail : ''}`);
}
const errs = (ed, o) => editorialChecks(ed, o).filter(c => c.type === 'error');
const codes = (ed, o) => [...new Set(errs(ed, o).map(c => c.code))];
const clone = x => JSON.parse(JSON.stringify(x));
const has = (ed, code, o) => codes(ed, o).includes(code);

// ── Edizione di fantasia che deve passare tutti i controlli ──────────────────
function good() {
  const claim = (claim, valore, classe, extra = {}) => ({ claim, valore, status: 'VERIFIED', classe, source: 'fonte interna', note: '', ...extra });
  return {
    num: '027', date: '2026-11-03', published: false, tags: ['Il Bilancio', 'Il Deal', 'La Metrica'],
    title: 'Valdorra, €500 milioni di ricavi e un utile di €12 milioni',
    subtitle: 'Valdorra chiude il 2025/26 in utile. Un nuovo stadio da €300 milioni. Un canale a pagamento da 2 milioni di abbonati.',
    opener: 'Valdorra incassa €500 milioni e chiude in utile di €12 milioni. Lo stadio nuovo costa €300 milioni. Il canale della lega ha 2 milioni di abbonati.',
    sections: [
      {
        label: 'Il Bilancio', title: 'Valdorra, ricavi da €500 milioni e utile netto di €12 milioni',
        body: 'Il Valdorra ha chiuso il 2025/26 con ricavi per €500 milioni, secondo quanto riportato dal club. L\'utile netto è di €12 milioni, il 2,4% dei ricavi (12 / 500).\n\nIl debito netto è di €90 milioni, meno di un quinto dei ricavi. Per la Serie A conta il confronto con i club italiani, che hanno margini più bassi.',
        kpis: [{ label: 'Ricavi', value: '€500 mln', sub: 'stagione 2025/26' }, { label: 'Utile netto', value: '€12 mln', sub: 'stagione 2025/26' }, { label: 'Debito netto', value: '€90 mln', sub: 'a fine stagione' }],
        verdict: 'Il margine è sottile ma positivo: il debito resta sotto controllo e il prossimo bilancio dirà se la tendenza regge.',
        sources: ['Valdorra FC, comunicato assemblea soci 2026'],
      },
      {
        label: 'Il Deal', title: 'Stadio Valdorra, €300 milioni in 20 anni: cosa cambia per il club',
        body: 'Il nuovo stadio costerà €300 milioni, da pagare in 20 anni. Sono €15 milioni all\'anno (300 / 20). Il contratto sul nome dell\'impianto vale una parte di quella spesa.\n\nPer un club italiano un impianto di proprietà cambia i ricavi del giorno partita.',
        kpis: [{ label: 'Costo stadio', value: '€300 mln', sub: 'investimento totale' }, { label: 'Rata annua', value: '€15 mln', sub: 'su 20 anni' }, { label: 'Durata', value: '20 anni', sub: 'del contratto' }],
        verdict: 'Chi guarda i conti deve seguire la rata annua: €15 milioni l\'anno pesano ogni stagione, indipendentemente dai risultati.',
        sources: ['Valdorra FC, comunicato 30/10/2026'],
      },
      {
        label: 'La Metrica', title: 'Canale della lega, 2 milioni di abbonati: la cifra da guardare',
        body: 'Il canale della lega ha 2 milioni di abbonati. A €10 al mese incassa €240 milioni l\'anno (2 milioni x 10 x 12).\n\nÈ la base per capire quanto valgono i diritti televisivi venduti in proprio.',
        kpis: [{ label: 'Abbonati', value: '2 mln', sub: 'media 2025/26' }, { label: 'Prezzo mensile', value: '€10', sub: 'abbonamento base' }, { label: 'Incasso annuo', value: '€240 mln', sub: '2 mln x 10 x 12' }],
        verdict: 'Il numero da guardare è 2 milioni: sopra questa soglia il canale regge i costi di distribuzione.',
        sources: ['Lega di Valdorra, comunicato 15/10/2026'],
      },
    ],
    factcheck: {
      checked_at: '2026-11-02T09:00:00Z', status: 'clean', totals: { claims: 11, verified: 11, contradicted: 0, unverifiable: 0 }, contradictions: [],
      sections: [
        { label: 'Il Bilancio', claims: [claim('Ricavi 2025/26: €500 milioni', '€500 milioni', 'Ufficiale'), claim('Utile netto: €12 milioni', '€12 milioni', 'Ufficiale'), claim('Debito netto €90 milioni', '€90 milioni', 'Ufficiale'),
          claim('Utile su ricavi 2,4%', '2,4%', 'Calcolo', { formula: '12/500*100', risultato: 2.4 })] },
        { label: 'Il Deal', claims: [claim('Costo stadio: €300 milioni', '€300 milioni', 'Ufficiale'), claim('Rata annua €15 milioni', '€15 milioni', 'Calcolo', { formula: '300/20', risultato: 15 })] },
        { label: 'La Metrica', claims: [claim('Abbonati: 2 milioni', '2 milioni', 'Ufficiale'), claim('Incasso annuo €240 milioni', '€240 milioni', 'Calcolo', { formula: '2*10*12', risultato: 240 })] },
      ],
    },
  };
}
const withFooter = html => html; // l'HTML reale arriva dal template

// ── 1. Controllo di base: la bozza di fantasia passa ─────────────────────────
const base = good();
t('bozza di fantasia: nessun errore', errs(base).length === 0, errs(base).map(c => c.message).join(' | '));
t('edizioni precedenti alla #027 non toccate', editorialChecks({ ...clone(base), num: '026', title: 'x' }).length === 0);

// ── 2. Aritmetica ────────────────────────────────────────────────────────────
{ // 0,2 -> -18 "spiegato" con 61,8
  const e = clone(base);
  e.sections[0].body = 'Il club chiude con un utile ordinario di €0,2 milioni e un risultato netto di -€18 milioni. Sono €61,8 milioni di interessi che trasformano un pareggio in una perdita.\n\nPer la Serie A conta il confronto con le rivali.';
  e.sections[0].title = 'Valdorra, ricavi da €500 milioni e perdita di €18 milioni';
  e.sections[0].kpis[1] = { label: 'Risultato netto', value: '-€18 mln', sub: 'stagione 2025/26' };
  e.sections[0].verdict = 'Il margine ordinario è nullo e il netto è negativo: il prossimo bilancio dirà se la tendenza regge davvero.';
  t('aritmetica: 0,2 -> -18 spiegato con 61,8 è BLOCCATO', has(e, 'ed_aritmetica_salto'), codes(e).join(','));
  e.sections[0].body = e.sections[0].body.replace('€61,8 milioni di interessi che trasformano un pareggio in una perdita', '€18,2 milioni di poste straordinarie e imposte che trasformano un pareggio in una perdita');
  t('aritmetica: con il salto corretto (18,2) NON è bloccato', !has(e, 'ed_aritmetica_salto'), codes(e).join(','));
}
{ // 650 / 25 anni / 2 club = 13, scritto 16
  const e = clone(base);
  e.sections[1].body = 'Il nuovo stadio vale €650 milioni in 25 anni. A ciascun club arrivano €16 milioni all\'anno.\n\nPer un club italiano un impianto di proprietà cambia i ricavi.';
  e.sections[1].title = 'Stadio Valdorra, €650 milioni in 25 anni: cosa cambia per il club';
  e.sections[1].kpis = [{ label: 'Valore', value: '€650 mln', sub: 'investimento totale' }, { label: 'Quota annua', value: '€16 mln', sub: 'a club' }, { label: 'Durata', value: '25 anni', sub: 'del contratto' }];
  e.sections[1].verdict = 'Chi guarda i conti deve seguire la quota annua: €16 milioni l\'anno pesano ogni stagione.';
  t('aritmetica: quota per club che non torna (650 / 25 / 2 = 13, non 16) è BLOCCATA', has(e, 'ed_aritmetica_quota'), codes(e).join(','));
  e.sections[1].body = e.sections[1].body.replace('€16 milioni', '€13 milioni');
  e.sections[1].kpis[1].value = '€13 mln';
  e.sections[1].verdict = e.sections[1].verdict.replace('€16 milioni', '€13 milioni');
  e.opener = e.opener.replace('€300 milioni', '€650 milioni');
  e.subtitle = e.subtitle.replace('€300 milioni', '€650 milioni');
  t('aritmetica: con la quota giusta (13) NON è bloccata', !has(e, 'ed_aritmetica_quota'), codes(e).join(','));
}
{ // durate diverse nello stesso testo
  const e = clone(base);
  e.sections[1].body = 'Il contratto dura 20 anni. In altre ricostruzioni dura 25 anni e vale €300 milioni.\n\nPer un club italiano conta il confronto.';
  t('aritmetica: due durate diverse (20 e 25 anni) nella stessa sezione è BLOCCATO', has(e, 'ed_aritmetica_durata'), codes(e).join(','));
}
{ // formula del fact-check sbagliata: 650/2300 = 28%, non 54%
  const e = clone(base);
  e.factcheck.sections[1].claims.push({ claim: 'Il naming copre il 54% del costo', valore: '54%', status: 'VERIFIED', classe: 'Calcolo', formula: '650/2300*100', risultato: 54 });
  t('aritmetica: calcolo del fact-check sbagliato (650/2300 = 28, non 54) è BLOCCATO', has(e, 'ed_calcolo_errato'), codes(e).join(','));
  t('aritmetica: valutatore sicuro respinge codice', Number.isNaN(evalFormula('process.exit(1)')) && Number.isNaN(evalFormula('1+constructor')));
}
{ // stesso valore in campi diversi
  const e = clone(base);
  e.title = 'Valdorra, €520 milioni di ricavi e un utile di €12 milioni';
  t('aritmetica: ricavi del titolo (€520) diversi dal testo (€500) sono BLOCCATI', has(e, 'ed_numero_incoerente'), codes(e).join(','));
  const k = clone(base);
  k.sections[0].kpis[0].value = '€510 mln';
  t('aritmetica: KPI (€510) diverso dal testo (€500) è BLOCCATO', has(k, 'ed_kpi_valore'), codes(k).join(','));
}

// ── 3. Date e stagioni ───────────────────────────────────────────────────────
{
  const d = clone(base); d.date = '2026-11-02';
  t('data: lunedì invece di martedì è BLOCCATA', has(d, 'ed_data_martedi'));
  const f = clone(base); f.date = '03/11/2026';
  t('data: formato 03/11/2026 è BLOCCATO', has(f, 'ed_data_formato'));
  const s = clone(base);
  s.sections[0].body += '\n\nI conti approvati nell\'assemblea riguardano il 2024/25.';
  t('stagione: 2024/25 riferita ai conti approvati è BLOCCATA', has(s, 'ed_stagione_incoerente'), codes(s).join(','));
  const c = clone(base);
  c.sections[0].body += '\n\nI ricavi crescono di €10 milioni rispetto al 2024/25.';
  t('stagione: 2024/25 come confronto esplicito NON è bloccata', !has(c, 'ed_stagione_incoerente'), codes(c).join(','));
  const n = clone(base);
  n.sections[0].kpis[1].sub = 'stagione 2025/27';
  t('stagione: 2025/27 (non consecutiva) è BLOCCATA', has(n, 'ed_stagione_non_consecutiva'));
}

// ── 4. Fact-check ────────────────────────────────────────────────────────────
{
  const nv = clone(base);
  nv.factcheck.sections[0].claims[0].classe = 'Non verificato';
  t('fact-check: classe «Non verificato» è BLOCCATA', has(nv, 'ed_factcheck_non_verificato'));
  const uv = clone(base);
  uv.factcheck.sections[0].claims[1].status = 'UNVERIFIABLE';
  t('fact-check: stato UNVERIFIABLE è BLOCCATO', has(uv, 'ed_factcheck_non_verificato'));
  const co = clone(base);
  co.factcheck.sections[0].claims[1].status = 'CONTRADICTED';
  t('fact-check: dato contraddetto è BLOCCATO', has(co, 'ed_factcheck_contraddetto'));
  const miss = clone(base);
  miss.factcheck.sections[2].claims = miss.factcheck.sections[2].claims.filter(c => c.valore !== '€240 milioni');
  t('fact-check: numero senza voce (€240 milioni) è BLOCCATO', has(miss, 'ed_factcheck_copertura'), codes(miss).join(','));
  const none = clone(base); delete none.factcheck;
  t('fact-check: assente è BLOCCATO', has(none, 'ed_factcheck_assente'));
  t('fact-check: fuori dal giro di generazione (factcheck:false) la copertura non si valuta', !has(none, 'ed_factcheck_assente', { factcheck: false }));
  const nocls = clone(base); delete nocls.factcheck.sections[0].claims[0].classe;
  t('fact-check: voce senza classe è BLOCCATA', has(nocls, 'ed_factcheck_classe'));
  const st = clone(base);
  st.factcheck.sections[0].claims[0].classe = 'Stampa autorevole';
  st.sections[0].body = st.sections[0].body.replace(', secondo quanto riportato dal club', '');
  t('fact-check: Stampa autorevole senza conferma né cautela è BLOCCATA', has(st, 'ed_factcheck_cautela'), codes(st).join(','));
  st.sections[0].body = st.sections[0].body.replace('con ricavi per', 'con ricavi, secondo quanto riportato, per');
  t('fact-check: Stampa autorevole con formula di cautela NON è bloccata', !has(st, 'ed_factcheck_cautela'), codes(st).join(','));
  const st2 = clone(base);
  st2.factcheck.sections[0].claims[0].classe = 'Stampa autorevole';
  st2.factcheck.sections[0].claims[0].confermata = true;
  t('fact-check: Stampa autorevole confermata da un\'altra fonte NON è bloccata', !has(st2, 'ed_factcheck_cautela'));
}

// ── 5. Link, testate, blocco Fonti ───────────────────────────────────────────
{
  const l = clone(base);
  l.sections[1].body += '\n\nDettagli su https://www.example-news.com/stadio.';
  t('link esterno nel testo è BLOCCATO', has(l, 'ed_link_esterno'));
  const w = clone(base);
  w.sections[1].body += '\n\nVedi www.sportnews.it per i dettagli.';
  t('link «www.» nel testo è BLOCCATO', has(w, 'ed_link_esterno'));
  const ok = clone(base);
  ok.sections[1].body += '\n\nL\'archivio è su valoreatteso.com.';
  t('link a valoreatteso.com NON è bloccato', !has(ok, 'ed_link_esterno'));
  ['Reuters', 'Il Sole 24 Ore', 'Bloomberg', 'The Athletic', 'Sky Sports', 'SportsPro', 'Adnkronos', 'AP'].forEach(n => {
    const o = clone(base);
    o.sections[1].body += `\n\nSecondo ${n} la cifra sarebbe confermata.`;
    t(`testata nel testo («${n}») è BLOCCATA`, has(o, 'ed_testata_nel_testo'), codes(o).join(','));
  });
  const ath = clone(base);
  ath.sections[0].body += '\n\nL\'Athletic Club di Bilbao non c\'entra.';
  t('«Athletic Club» (club) NON è scambiato per una testata', !has(ath, 'ed_testata_nel_testo'));
  const src = clone(base);
  src.sections[2].body += '\n\nFonti: Lega di Valdorra.';
  t('blocco «Fonti:» nel testo è BLOCCATO', has(src, 'ed_blocco_fonti'));
  const intern = clone(base);
  intern.sections[0].sources = ['Reuters, conti 2025/26', 'Il Sole 24 Ore, 30/10/2026'];
  t('testate nel campo interno `sources` NON sono bloccate', !has(intern, 'ed_testata_nel_testo'));
}

// ── 6. Anteprima email: footer, titolare, link ───────────────────────────────
{
  const row = clone(base); row.published = false;
  const out = build(contractFromRow(row, { editionPage: false }), { mode: 'test' });
  const okChecks = emailRenderChecks(out.html, out.text);
  t('anteprima email di fantasia: footer e titolare corretti, nessun errore', okChecks.length === 0, okChecks.map(c => c.message).join(' | '));
  const swap = (html, a, b) => html.split(a).join(b);
  const footer = 'Dati tratti da documenti ufficiali di club e organismi competenti.';
  const bad1 = swap(out.html, footer, 'Dati tratti da documenti ufficiali e da fonti autorevoli.');
  t('anteprima: footer diverso è BLOCCATO', emailRenderChecks(bad1, out.text).some(c => c.code === 'ed_mail_footer'));
  const bad2 = swap(out.html, 'Titolare del trattamento:', 'Titolare del trattamento: Mario Rossi, via Roma 1,');
  t('anteprima: titolare con nome personale è BLOCCATO', emailRenderChecks(bad2, out.text).some(c => c.code === 'ed_mail_titolare'));
  const bad3 = swap(out.html, 'mailto:info@valoreatteso.com', 'mailto:persona@gmail.com');
  t('anteprima: contatto non info@valoreatteso.com è BLOCCATO', emailRenderChecks(bad3, out.text).some(c => c.code === 'ed_mail_contatto'));
  const bad4 = out.html.replace('</body>', '<a href="https://www.example.com/x">Fonti</a></body>');
  const c4 = emailRenderChecks(bad4, out.text).map(c => c.code);
  t('anteprima: link esterno e link «Fonti» sono BLOCCATI', c4.includes('ed_mail_link_esterno') && c4.includes('ed_mail_link_fonti'), c4.join(','));
  const bad5 = out.html.replace('</body>', '<p>Secondo Reuters la cifra è confermata.</p></body>');
  t('anteprima: testata nell\'email è BLOCCATA', emailRenderChecks(bad5, out.text).some(c => c.code === 'ed_mail_testata'));
  t('anteprima assente è BLOCCATA', emailRenderChecks('', '').some(c => c.code === 'ed_mail_assente'));
  const pf = contentPreflight(row, { html: bad1, text: out.text });
  t('preflight con footer errato: can_send = false', pf.can_send === false && pf.checks.some(c => c.code === 'ed_mail_footer'));
}

// ── 7. Anglicismi, sensazionalismo, titolo ───────────────────────────────────
{
  const a = clone(base); a.sections[1].title = 'Stadio Valdorra, il deal da €300 milioni: cosa cambia per il club';
  t('anglicismo nel titolo di sezione («deal») è BLOCCATO', has(a, 'ed_anglicismo_titolo'));
  const a2 = clone(base); a2.title = 'Valdorra, €500 milioni di ricavi: il break-even di €12 milioni';
  t('anglicismo nel titolo dell\'edizione è BLOCCATO', has(a2, 'ed_anglicismo_titolo'));
  const a3 = clone(base); a3.sections[1].body += '\n\nUn deal in co-owned con un asset e un benchmark da split.';
  t('troppi anglicismi nel corpo (>2) sono BLOCCATI', has(a3, 'ed_anglicismo_corpo'));
  const a4 = clone(base); a4.sections[1].body += '\n\nÈ un deal sul nome dell\'impianto.';
  t('un anglicismo nel corpo è solo un avviso', !has(a4, 'ed_anglicismo_corpo') && editorialChecks(a4).some(c => c.code === 'ed_anglicismo_corpo' && c.type === 'warning'));
  ['Basta un infortunio a un giocatore chiave per tornare in rosso.', 'Un crollo dei ricavi.', 'Un disastro annunciato.', 'Un modello bruciato dalla gestione.'].forEach(f => {
    const s = clone(base); s.sections[0].body += '\n\n' + f;
    t(`sensazionalismo («${f.slice(0, 28)}…») è BLOCCATO`, has(s, 'ed_sensazionalismo'));
  });
  const ti = clone(base); ti.title = 'Valdorra, ricavi record e utile in crescita nonostante un anno difficile per tutti';
  t('titolo senza numero e oltre 70 caratteri è BLOCCATO', has(ti, 'ed_titolo_lungo') && has(ti, 'ed_titolo_numero'));
  const pr = clone(base); pr.subtitle = 'x'.repeat(141);
  t('preheader oltre 140 caratteri è BLOCCATO', has(pr, 'ed_sottotitolo_lungo'));
  const k = clone(base); k.sections[2].kpis.pop();
  t('meno di 3 KPI è BLOCCATO', has(k, 'ed_kpi_tre'));
}

// ── 8. Ripetizioni e temi ────────────────────────────────────────────────────
{
  const v = clone(base);
  v.sections[0].verdict = 'Per un advisor la lettura è chiara: il margine è sottile e il debito resta sotto controllo.';
  v.sections[2].verdict = 'Per chi siede al tavolo dei diritti la soglia è 2 milioni di abbonati: sopra regge i costi.';
  t('verdetti con lo stesso schema («Per un advisor…» / «Per chi siede…») sono BLOCCATI', has(v, 'ed_verdetti_stesso_attacco'), codes(v).join(','));
  const v2 = clone(base);
  v2.sections[0].verdict = 'Il margine è sottile ma positivo: il debito resta sotto controllo.';
  v2.sections[2].verdict = 'Il numero da guardare è 2 milioni di abbonati: sopra regge i costi di distribuzione.';
  t('verdetti che cominciano con la stessa parola («Il») sono solo un avviso', !has(v2, 'ed_verdetti_stesso_attacco') && editorialChecks(v2).some(c => c.code === 'ed_verdetti_stessa_parola'));
  const r = clone(base);
  r.sections[0].verdict = 'I ricavi record e il debito possono convivere nello stesso bilancio, senza contraddizioni evidenti.';
  r.sections[0].body += '\n\nI ricavi record e il debito possono convivere nello stesso bilancio.';
  t('stessa espressione nel testo e nel verdetto è BLOCCATA', has(r, 'ed_frase_ripetuta'), codes(r).join(','));
  const x = clone(base);
  x.sections[2].title = 'Struttura contrattuale del canale della lega: 2 milioni di abbonati';
  x.sections[2].kpis[0].label = 'Durata contratto';
  x.sections[2].verdict = 'Il numero da guardare è la struttura contrattuale: la clausola sulla durata del contratto pesa più del resto.';
  x.sections[1].title = 'Stadio Valdorra, €300 milioni: struttura contrattuale e clausole in 20 anni';
  x.sections[1].verdict = 'Chi guarda i conti deve seguire la struttura contrattuale: le clausole e la durata del contratto pesano ogni stagione.';
  t('Deal e Metrica sullo stesso tema («struttura contrattuale») sono BLOCCATI', has(x, 'ed_deal_metrica_tema') || has(x, 'ed_deal_metrica_sovrapposti'), codes(x).join(','));
  const dm = clone(base);
  dm.sections[2].title = 'Stadio Valdorra e rata annua: la cifra da guardare';
  dm.sections[2].kpis = dm.sections[1].kpis.map(k => ({ ...k }));
  t('Deal e Metrica con titoli e KPI quasi uguali sono BLOCCATI', has(dm, 'ed_deal_metrica_sovrapposti') || has(dm, 'ed_deal_metrica_tema'), codes(dm).join(','));
}

// ── 9. Permessi dell'agente ──────────────────────────────────────────────────
{
  const throws = (fn, re) => { try { fn(); return false; } catch (e) { return e instanceof guard.AgentPermissionError && (!re || re.test(e.message)); } };
  t('permessi: tabella subscribers vietata', throws(() => guard.assertTable('subscribers'), /vietata/));
  t('permessi: tabella blocked_emails vietata', throws(() => guard.assertTable('blocked_emails')));
  t('permessi: tabella non prevista (agent_runs) negata', throws(() => guard.assertTable('agent_runs')));
  ['sent_to', 'sent_count', 'sent_at', 'draft_token', 'email'].forEach(c => t(`permessi: lettura della colonna ${c} negata`, throws(() => guard.assertSelect('editions', `id,${c}`))));
  t('permessi: select * negata', throws(() => guard.assertSelect('editions', '*')));
  t('permessi: lettura colonne bozza consentita', !throws(() => guard.assertSelect('editions', 'id,num,title,sections,factcheck')));
  ['published', 'sent_to', 'sent_count', 'sent_at', 'draft_token', 'id', 'num'].forEach(c => t(`permessi: scrittura di ${c} negata`, throws(() => guard.assertDraftPatch({ [c]: 1 }))));
  t('permessi: scrittura della bozza (title, sections, factcheck, email) consentita', !throws(() => guard.assertDraftPatch({ title: 'x', sections: [], factcheck: {}, email: {} })));
  ['send', 'publish', 'approve', 'regenerate', 'delete'].forEach(a => t(`permessi: azione «${a}» negata`, throws(() => guard.assertAction(a))));
  // client con metodi ridotti: nessun insert / upsert / delete
  const calls = [];
  const fake = { from: tb => ({ select: (c) => { calls.push(['select', tb, c]); return {}; }, update: (p) => { calls.push(['update', tb, Object.keys(p)]); return {}; }, insert: () => calls.push('INSERT'), delete: () => calls.push('DELETE'), upsert: () => calls.push('UPSERT') }) };
  const g = guard.guardedClient(fake);
  const q = g.from('editions');
  t('permessi: il client protetto non espone insert, upsert, delete', q.insert === undefined && q.upsert === undefined && q.delete === undefined);
  t('permessi: il client protetto nega subscribers', throws(() => g.from('subscribers')));
  t('permessi: il client protetto nega update di published', throws(() => q.update({ published: true })));
  t('permessi: il client protetto nega scritture su editorial_wiki', throws(() => g.from('editorial_wiki').update({ valore: 'x' })));
  t('permessi: il client protetto lascia passare select e update di bozza', (() => { q.select('id,num,title'); q.update({ title: 'x' }); return calls.length === 2; })());

  // Analisi statica: l'agente (genera-edizione) non tocca invio, pubblicazione, iscritti.
  const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const ge = src('api/genera-edizione.js');
  const stripC = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const geCode = stripC(ge);
  t('statico: genera-edizione non cita iscritti, sent_*, draft_token', !/subscribers|sent_to|sent_count|sent_at|draft_token|blocked_emails/.test(geCode));
  t('statico: genera-edizione non invia né pubblica (niente Resend, Brevo, published:true, send-newsletter)', !/resend|brevo|send-newsletter|published\s*:\s*true|\.delete\(|\.insert\(|\.upsert\(/i.test(geCode));
  t('statico: genera-edizione non fa select(\'*\') sul database', !/select\(\s*['"`]\*/.test(geCode));
  t('statico: genera-edizione usa il client protetto', /guardedClient\(createClient/.test(geCode));
  t('statico: genera-edizione rifiuta la rigenerazione richiesta dall\'agente', /regenSezione\s*&&\s*isAgent\(req\)/.test(geCode));
  const onlyAdmin = ['api/send-newsletter.js', 'api/send-test.js', 'api/publisher-gate.js'];
  onlyAdmin.forEach(f => t(`statico: ${f} accetta solo la sessione di Paolo (nessun accesso con chiave agente)`, /requireAdmin\(/.test(src(f)) && !/requireAdminOrAgent|isAgent/.test(stripC(src(f)))));
  const run = stripC(src('api/run-agent.js'));
  t('statico: run-agent non accetta la chiave agente per invio o approvazione', !/requireAdminOrAgent[^\n]*(send|approv|publish)/i.test(run));
  const fa = ['api/genera-edizione.js', 'api/genera-opzioni.js'];
  const agentFiles = require('child_process').execSync('grep -rl "requireAdminOrAgent" api || true', { cwd: path.join(__dirname, '..') }).toString().split('\n').filter(x => x && !x.includes('_lib'));
  t('statico: la chiave agente apre solo genera-edizione e genera-opzioni', agentFiles.every(f => fa.includes(f)), agentFiles.join(','));
}

// ── 10. Righe indicate da riga di comando devono passare tutto ──────────────
process.argv.slice(2).forEach(file => {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = Array.isArray(d) ? d[0] : d;
  row.num = row.num || '027';
  const c = editorialChecks(row);
  const e = c.filter(x => x.type === 'error');
  t(`${path.basename(file)}: controlli di contenuto (0 errori)`, e.length === 0, e.map(x => x.code + ': ' + x.message).join('\n        '));
  const out = build(contractFromRow(row, { editionPage: false }), { mode: 'test' });
  const mail = emailRenderChecks(out.html, out.text);
  t(`${path.basename(file)}: anteprima email (footer, titolare, link, 0 errori)`, mail.length === 0, mail.map(x => x.message).join(' | '));
  const pf = contentPreflight(row, { html: out.html, text: out.text });
  t(`${path.basename(file)}: preflight completo (0 blocker)`, pf.blockers === 0, pf.checks.filter(x => x.type === 'error').map(x => x.message).join(' | '));
  const w = c.filter(x => x.type === 'warning');
  if (w.length) rows.push(`        (${w.length} avvisi) ${w.map(x => x.code).join(', ')}`);
});

console.log(rows.join('\n'));
console.log(`\n${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
