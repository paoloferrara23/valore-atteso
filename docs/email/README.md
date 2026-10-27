# Template email generico: attivo dall'ed. #027

Stato: **in produzione.** `send-test` (Control Room → "Invia test a me") lo usa per ogni edizione; `send-newsletter` lo usa dalla #027. Le edizioni fino alla #026 restano su `api/_lib/build-html.js`.

## Cosa c'è
| Percorso | Cosa |
|---|---|
| `api/_lib/email/schema.json` | Contratto JSON dell'edizione |
| `api/_lib/email/validate.js` | Schema e regole: numeri, non ripetizione, placeholder, nomi di stampa, iscritti, approvazione |
| `api/_lib/email/render-html.js` | Apertura blu (edizione, testata, titolo, dek, In sintesi), sezioni con KPI/moduli/lettura, Cosa guardare, inoltro, footer con dati legali |
| `api/_lib/email/render-text.js` | Versione text/plain dagli stessi dati |
| `api/_lib/email/urls.js` | Unica funzione per URL e UTM verso www.valoreatteso.com |
| `api/_lib/email/config.js` | Micro-testi, dati legali, merge tag, nomi vietati, limiti di peso |
| `api/_lib/email/contract.js` | Contratto dalla riga Supabase `editions` + colonna `email` |
| `api/_lib/email/build.js` | validate → HTML → text → controlli sull'output → report |
| `api/_lib/email/index.js` | Per send-test e send-newsletter: controlla `/edizione-N`, costruisce, personalizza `{{EMAIL}}` |
| `fixtures/026.json`, `fixtures/027.json` | Regressione #026 (in `send` passa) e scheletro #027 (in `send` fallisce) |
| `email/brand/*.png` | Monogramma 128×88 e lockup 360×120 @2x, serviti da `https://www.valoreatteso.com/email/brand/` |
| `.github/workflows/newsletter-a2-test.yml` + `scripts/email-send-test.js` | Invio di prova solo a info@valoreatteso.com |

## Come si usa
```
npm run edition -- 027 --mode=preview                 # anteprima da fixtures/027.json
npm run edition -- 027 --mode=send --from=supabase    # HTML per Brevo dai dati su Supabase
npm run edition:qa -- 026                             # screenshot, misure, contrasti, casi di validazione
```
Modalità: `preview` (placeholder ammessi, immagini locali), `test` (errori di regola solo segnalati, immagini assolute: è quella di send-test), `send` (si blocca su placeholder, nomi di testate o social, link esterni, numeri di iscritti, edizione non approvata). Il build è deterministico.

## Da dove arrivano i contenuti
- **Colonne di `editions`:** titolo, sottotitolo (= dek), sezioni con titolo, testo, KPI, lettura (`verdict`). Le `sources` restano nel DB per la verifica, ma l'email non le stampa.
- **Colonna `email` (jsonb):** `preheader` (85-100 caratteri), `summary[i].thesis` (max 110), `watch[]` ({label, text}); opzionali `summary[i].number`, `sections[i].kpi`/`module` (bars, deal, vs), `subject`, `dek`, `read_min`. Il Writer (`genera-edizione`) compila preheader, tesi e "Cosa guardare".
- **Ripieghi:** preheader = sottotitolo se entro 100 caratteri, altrimenti titolo; tesi = titolo della sezione; numero della sintesi = primo KPI; "Cosa guardare" non mostrato se vuoto; modulo assente.
- **Approvazione:** `published = true` (Approva in Control Room). All'approvazione parte il workflow `edition-pages` per la pagina `/edizione-N`; finché non c'è, "Leggi online" e l'inoltro puntano a `/archivio`.

## Decisioni
- **Disiscrizione:** `https://www.valoreatteso.com/cancella?email={{EMAIL}}`, con `{{EMAIL}}` sostituito per ogni destinatario (URL-encoded), anche nel text/plain. I tag Brevo `{{ unsubscribe }}`/`{{ update_profile }}` valgono solo per le campagne, non per l'API transazionale che usiamo.
- **Preferenze:** non esiste un centro preferenze: il link apre una mail a info@ con oggetto "Preferenze newsletter".
- **Link ammessi:** solo `www.valoreatteso.com` (`/`, `/archivio`, `/edizione-N`, `/privacy`, `/cancella`), `mailto:` e `wa.me`. Niente Instagram, niente fonti esterne.
- **Dati legali:** titolare "Valore Atteso", privacy `/privacy`, contatto info@. Indirizzo opzionale con la env var `LEGAL_OWNER_ADDRESS`.
- **Font:** Google Fonts (Playfair Display, Source Serif 4, JetBrains Mono) con fallback Georgia/Arial/Courier New; Outlook usa i fallback.

## Verifiche Brevo (§3.13): non verificato
Non ho accesso a Brevo né al DNS da qui. Per rispondere servono:
- **Branded domain e UTM automatici:** li controlli tu nelle impostazioni Brevo (sola lettura).
- **List-Unsubscribe e allineamento SPF/DKIM:** mi bastano gli header della mail di test ("Mostra originale").
- **DMARC:** il record di `_dmarc.valoreatteso.com`.

Nota: la nostra chiamata a Brevo oggi non imposta `List-Unsubscribe`.
