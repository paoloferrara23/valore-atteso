# Template email generico (dall'ed. #027): consegna per Paolo

Stato: **branch di lavoro `claude/eager-davinci-5do7lb`, nessun merge, nessun invio, nessun caricamento sul sito.** Il martedì la newsletter esce ancora con il template attuale (`api/_lib/build-html.js`).

## Cosa c'è
| Percorso | Cosa |
|---|---|
| `api/_lib/email/schema.json` | Contratto JSON dell'edizione (JSON Schema 2020-12) |
| `api/_lib/email/validate.js` | Schema + regole del §4.3: numeri, non ripetizione, fonti primarie, placeholder, iscritti, approvazioni |
| `api/_lib/email/render-html.js` | Blocchi B0-B9: barra, testata, sponsor, lead, In sintesi, sezioni con KPI/moduli/lettura/Fonti, Cosa guardare, inoltro, filetto oro, footer opzione 1 |
| `api/_lib/email/render-text.js` | Versione text/plain dagli stessi dati |
| `api/_lib/email/urls.js` | Unica funzione per URL e UTM verso valoreatteso.com |
| `api/_lib/email/config.js` | Micro-testi di brand, dati legali, merge tag, liste di blocco, limiti di peso |
| `api/_lib/email/contract.js` | Contratto dalla riga Supabase `editions` + colonna `email` |
| `api/_lib/email/build.js` | validate → HTML → text → controlli sull'output → report (hash SHA-256) |
| `fixtures/026.json` | Regressione: la #026 nel contratto (in `send` deve fallire, ed è così) |
| `fixtures/027.json` | Scheletro #027 con `[[DA_FORNIRE]]` (`preview` passa, `send` fallisce) |
| `fixtures/026-intro.txt` | Paragrafo d'apertura della #026, per misurare la variante con intro |
| `email/brand/*.png` | Monogramma 128×88 e lockup 360×120 @2x, generati da `docs/brand/*.svg` (ricostruzioni) |
| `dist/026/`, `dist/027/` | `preview.html`, `email.txt`, `report*.md/json`, `qa.md/json`, `screens/` |
| `sql/2026-10-27_editions_email.sql` | Colonna `editions.email` (jsonb): **proposta, non applicata** |
| `.github/workflows/newsletter-a2-test.yml` + `scripts/email-send-test.js` | Invio di prova solo a info@valoreatteso.com, dopo il tuo ok |

## Come si usa
```
npm run edition -- 027 --mode=preview                 # anteprima da fixtures/027.json
npm run edition -- 027 --mode=send --from=supabase    # HTML per Brevo dai dati su Supabase
npm run edition:qa -- 027                             # screenshot, misure, contrasti
npm run edition:logos                                 # rigenera i PNG dei loghi dagli SVG
```
Modalità: `preview` (placeholder ammessi ed elencati), `test` (come preview, immagini con URL assoluto), `send` (si blocca su ogni placeholder, fonte di stampa, dato legale mancante o approvazione a `false`). Ogni build si fa due volte e gli hash devono coincidere.

## Come la redazione compila un'edizione
I contenuti restano su Supabase, come hai deciso:
- **colonne di oggi** di `editions`: titolo (`title`), dek (`subtitle`), sezioni con titolo, testo, KPI, lettura (`verdict`);
- **nuova colonna `email`**: preheader, intro, sintesi, modulo di ogni sezione, fonti con URL, "Cosa guardare", testi di inoltro, sponsor, approvazioni (struttura in `contract.js` e nel file SQL).

Se un campo manca, la validazione dice quale e perché; il template non lo riempie.

## Cosa cambia nella pipeline (non fatto: serve il tuo ok)
1. Applicare la colonna `editions.email` (file SQL).
2. Writer/Editor: produrre i campi della colonna `email`, con fonti `{testo, url}`. La regola "solo fonti primarie, stime generiche" è già scritta nel prompt del Writer (`api/genera-edizione.js`, regola 8) e in CLAUDE.md, su questo branch.
3. `send-newsletter` e `send-test`: usare `build(..., {mode:'send'})` quando `email` è compilata. Sostituire `{{EMAIL}}` (URL-encoded) e il nuovo `{{EMAIL_TEXT}}` (indirizzo in chiaro) con `replaceAll`, e passare a Brevo anche `textContent`.
4. Generare la pagina web dell'edizione subito dopo l'approvazione (oggi parte alle 8 del mattino): "Leggi online" e i link di inoltro puntano lì.
5. Caricare su `valoreatteso.com/email/brand/` i 2 PNG (si pubblicano con il merge) e attivare gli URL `/026`, `/027`… (rewrite in `vercel.json` verso `/edizione-NN`).

## Decisioni prese (default prudente: da confermare)
1. **Branch**: quello assegnato a questa sessione, non `template-generico-ed27`.
2. **Font**: solo i fallback Georgia, Arial e Courier New, nessuna richiesta a Google (§8, domanda 6).
3. **Disiscrizione**: resta la pagina `/cancella?email={{EMAIL}}` con `www`, come oggi (eccezione alla regola "senza www"). `{{ unsubscribe }}`, `{{ update_profile }}` e `{{ mirror }}` di Brevo non funzionano con l'invio transazionale.
4. **"Preferenze →" tolto** dal footer: non esiste un centro preferenze. I link di servizio sono 3.
5. **"Fonti verificabili →"** senza `#fonti`: la pagina web dell'edizione non ha quell'ancora. Si aggiunge quando si modifica la pagina.
6. **Privacy e disiscrizione senza UTM**: sono link di servizio, fuori dalla lista `utm_content`.
7. **Monogramma 64×44** (PNG 128×88) e **lockup 180×60** (PNG 360×120, fondo `#1C1914`), dagli SVG ricostruiti del pacchetto; minimo di 180px del README dei loghi rispettato.
8. **Pagina dark `#121110`**, bordi `#3A352E` su lettura e footer, `#2E4A8F` su sintesi e inoltro, 24px di pagina sotto il footer.
9. **KPI**: valore corto, descrizione nell'etichetta. Nella #026 "€14-15M" più "Ramos a bilancio, all'anno" (nel database: "€14-15M/anno" e "Ramos a bilancio").
10. **Vs Barça "anni di fila in utile"**: "0 (perdita)" nel fixture #026, come da Fact-check. Un trattino solo blocca il build.
11. **Placeholder lunghi** nello scheletro: possono andare a capo, per non allargare la mail; i valori veri restano su una riga.
12. **Validatore JSON Schema interno**: nessuna dipendenza nuova. Se preferisci Ajv si sostituisce in un punto.
13. **Dati di prova "puliti"** (solo nei test, mai in pagina): fonti `example.org` per verificare che `send` passi quando tutto è compilato.

## In attesa di decisione (§7)
- **Contenuti A2 della #026 non presenti nel testo inviato:** tesi di "In sintesi", "Cosa guardare", "Stato: In attesa di autorizzazioni", "0 (perdita)", preheader. Vanno a Copy e Fact-check, poi a te.
- **Paragrafo d'apertura della #026:** con l'intro la sezione 01 parte a **933px**, cioè 133px oltre il limite. Il campo `intro` è pronto.
- **"secondo Reuters"** nel corpo della sezione 02 e **fonti di stampa** della #026: bloccano `send`.
- **Dati legali** `[[TITOLARE]]` e `[[INDIRIZZO]]`, in `config.js`: bloccano `send`.
- **Testi di inoltro** (headline, subline, testo WhatsApp/email): da approvare.
- **Loghi master**, e ok a caricare i PNG sul sito.
- **Data #027 03/11/2026 e formato `027`**: da confermare.

## Verifiche Brevo (§3.13): non verificato
Non ho accesso a Brevo né al DNS da qui. Per rispondere servono:
- **Branded domain e UTM automatici:** li controlli tu nelle impostazioni Brevo (sola lettura).
- **List-Unsubscribe e allineamento SPF/DKIM:** mi bastano gli header della mail di test ("Mostra originale").
- **DMARC:** il record di `_dmarc.valoreatteso.com`.

Nota: la nostra chiamata a Brevo oggi non imposta `List-Unsubscribe`.

## Checklist §5.2
| Criterio | Esito | Note |
|---|---|---|
| #027 dal solo JSON, senza toccare il template | ✓ | `fixtures/027.json` → `dist/027/` |
| Schema e validazione; 026 riproduce l'#026; 027: preview passa, send fallisce con l'elenco | ✓ | 026 send: 23 errori; 027 send: 68 errori, tutti elencati nel report |
| Ordine B0-B9, un modulo per sezione, nessun numero ripetuto, sintesi nelle sezioni | ✓ | |
| Testata: monogramma 64×44 non deformato, senza bordo, alt; wordmark testo vivo; motto su una riga a 375 | ✓ | Deformazione misurata 0. Senza media query il motto va su 2 righe |
| Footer opzione 1: blu → filetto oro 3px → ink; lockup 180×60; tagline; link di servizio; mailto; legale 12px `#A8A196`; disiscrizione; placeholder legali; niente social | ✓ | 3 link di servizio invece di 4 (decisione 4) |
| Un solo CTA primario (Inoltra) | ✓ | |
| Fonti: link `target="_blank"`, testo = documento, niente UTM; send blocca stampa, social, URL vuoti | ✓ | Verificato dai casi di test |
| `sponsor: null` senza tracce | ✓ | |
| Mobile: `#s1` ≤800px; tap ≥44px; testi ≥12px, etichette ≥11px, corpo ≥15px; KPI impilati anche senza media query, tutti a 24px; nessun overflow | ✓ | `#s1` a 768px (026) e 696px (027); senza media query 913/709px. Gli 11 link delle fonti dentro il testo restano sotto i 44px, come ogni link in un paragrafo |
| Dark: pagina `#121110`, bordi, testate tabelle e filetto visibili, logo mai ricolorato | ✓ Chrome | Client reali da provare |
| Outlook desktop | ✗ | Non testabile da qui: tabelle, wrapper MSO a 640, celle MSO per KPI e link del footer, font forzati, bottoni con `mso-padding-alt` |
| URL unici, UTM `va-{edizione}` con `utm_content` della lista, share con `utm_medium=share` | ✓ | Controllati su HTML e text/plain. `/026` e `/027` esistono solo dopo il merge del rewrite |
| HTML ≤85KB prima di Brevo e <102KB ricevuto; text/plain senza duplicati | ✓ / da verificare | 026: 50,5 KB (+~9 KB di tracking Brevo = circa 60 KB); 027: 39,7 KB. Ricevuto: dopo il test send |
| Contrasti in light e dark | ✓ | Minimo 5,81:1 su tutto il testo. Grafiche: oro/ink 5,76; oro/pagina dark 6,2; bordo footer 1,55; bordo sintesi 2,24 |
| Nessun placeholder in send, nessuna testata, nessun numero di iscritti, nessun tracciamento in più | ✓ | In send i placeholder bloccano |
| Build deterministico | ✓ | Due build, stessi hash |
| Verifiche Brevo §3.13 | non verificato | Vedi sopra |
| Client reali (Gmail, Apple Mail, Outlook) | ✗ | Con il test send, dopo il tuo ok |
