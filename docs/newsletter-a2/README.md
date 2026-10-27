# Template email A2: consegna per approvazione

Stato: **bozza su branch, non collegata agli invii**. Nessuna mail inviata, nessun merge in produzione.

## File
| File | Cosa |
|---|---|
| `api/_lib/newsletter-a2.js` | Adattatore dai campi `editions`, validazione, HTML a tabelle, text/plain |
| `docs/newsletter-a2/026-edition.json` | #026 come inviata (testi estratti dall'HTML inviato, verificati con md5 su `editions`; fonti da `editions`) |
| `docs/newsletter-a2/026-layout.json` | Campi A2 che la pipeline non produce, trascritti dai mock. **Da approvare** |
| `docs/newsletter-a2/preview-026.html` / `.txt` | Anteprima autonoma, senza tracciamento (`{{EMAIL}}` resta segnaposto) |
| `docs/newsletter-a2/screens/` | 640 e 375, chiaro e scuro, più 375 senza CSS (Gmail con account non Google) |
| `docs/newsletter-a2/qa-026.json` | Report dei controlli automatici |
| `scripts/newsletter-a2-preview.js`, `scripts/newsletter-a2-qa.js` | Rigenerano anteprima e controlli |

```
node scripts/newsletter-a2-preview.js 026
node scripts/newsletter-a2-qa.js 026
```

## Come funziona oggi l'invio (verificato nel codice)
- `send-newsletter` costruisce l'HTML con `api/_lib/build-html.js` e lo passa a Brevo con l'API transazionale `POST /v3/smtp/email`, un messaggio per iscritto (`api/_lib/mailer.js`). Niente campagne né template salvati su Brevo. Il click tracking `sendibt2.com` lo aggiunge Brevo all'invio.
- Nessun merge tag Brevo. La disiscrizione è `https://www.valoreatteso.com/cancella?email={{EMAIL}}`, con `{{EMAIL}}` sostituito dal server (una sola occorrenza). "Leggi online" punta a `https://valoreatteso.com/archivio.html`. A2 li mantiene identici.
- Oggi parte solo l'HTML: nessuna versione text/plain.

## Cosa cambia nella pipeline (proposta, non fatta)
1. Salvare i campi A2 (`summary`, `sections[].module`, `sections[].kpi` se diverso, `watch`, `preheader`) in una colonna `editions.layout` (jsonb).
2. Far produrre questi campi a Writer/Editor e le fonti con URL (`{label, url}`). Oggi le fonti sono solo testo e vengono mostrate senza link.
3. In `send-newsletter` e `send-test`: usare `renderA2Html` quando `layout` è presente, altrimenti il template attuale. Aggiungere `textContent: renderA2Text(...)` alla chiamata Brevo.
4. Aggiungere `validateA2` ai controlli pre-invio (`preflight`), così una bozza senza sintesi o fonti viene bloccata prima.

## Decisioni prese (default prudente: da confermare)
1. **Contenuti A2 della #026**: sintesi, barre, scheda deal, tabella vs e "Cosa guardare" vengono dai mock, non li ho scritti io. Ho verificato che ogni numero è presente nel testo della #026.
2. **KPI sez. 01**: valori ed etichette come nel database ("€14-15M/anno", "Ramos a bilancio"), non come nel mock ("€14-15M", "Ramos a bilancio, all'anno"). La riga `sub` dei KPI non è mostrata, come nella mail attuale.
3. **KPI sez. 02 e 03 tolti**, come da specifica: i numeri restano nella scheda deal e nella tabella vs, le etichette dei KPI no.
4. **Opener non mostrato**, come nel mock: con l'opener la sezione 01 partirebbe oltre gli 800px su mobile. Si riattiva con `show_opener: true` nel layout.
5. **Dek = sottotitolo; preheader = sottotitolo tagliato a 90 caratteri** sulla parola, con "…".
6. **Logo**: nessun file ufficiale nel repo. Uso la sigla testuale "VA" del template attuale, non un logo ricostruito. Il PNG@2x si passa con `opts.logo = {src, width, height}`.
7. **UTM: nessuno** finché non confermi il formato, quindi i link restano come oggi.
8. **WhatsApp**: oggetto + `https://valoreatteso.com/archivio#026`, come da specifica. La pagina `/edizione-26` viene generata solo la mattina dopo, quindi non la uso. Mailto con lo stesso testo di oggi.
9. **Vs, Barcellona "anni di fila in utile"**: il mock usa "—". Ho messo "–" per non introdurre il trattino lungo vietato nei contenuti.
10. **Web font** (Google Fonts) caricati solo fuori da Outlook. È una richiesta di font, non un pixel; se preferisci zero richieste esterne si tolgono e restano Georgia/Arial.

## Checklist §6
| Criterio | Esito | Note |
|---|---|---|
| Resa 640/375 come i mock | ✓ | Ordine, colori, gerarchia. Differenze: sigla "VA" al posto del monogramma, KPI dal database (punto 2) |
| Contenuti e numeri identici | ✓ con eccezioni | Corpo, titoli, letture, fonti e KPI sez. 01 identici (controllo automatico: 0 testi mancanti). Non mostrati: opener ed etichette KPI sez. 02/03 (decisioni 3-4) |
| Un modulo per sezione, nessun numero ripetuto, numeri della sintesi nella sezione | ✓ | Verificato dalla validazione |
| Fonti sotto ogni sezione, render bloccato senza fonti | ✓ | |
| `sponsor: null` senza tracce | ✓ | Nessun "Presentato da" nell'HTML |
| KPI impilati su mobile (bug `.kpi-top`/`.kpi-row`) | ✓ Chrome · ✗ client reali | Una sola classe `kpi`. Mancano gli screenshot da Gmail app e iOS Mail |
| Testo ≥15px, etichette ≥10px, nessun 9px | ✓ | Corpo 15,5px, etichette min 10px. Fonti 12,5px, note e legale 12px come da specifica |
| Pulsanti ≥44px | ✓ | 46px (60px senza CSS) |
| Contrasto ≥4,5:1 chiaro e scuro | ✓ Chrome | Minimo 5,81 (oro su blu) in entrambi i temi, calcolato dallo script |
| Dark mode Apple Mail, Outlook.com, Gmail app | ✓ Chrome · ✗ client reali | Blocchi blu intatti, KPI e barre in #9DB4F0 |
| Outlook desktop Windows | ✗ | Non testabile da qui: struttura a tabelle, wrapper mso a 640, font forzati Georgia/Arial, pulsanti bulletproof |
| HTML < 102KB | ✓ | 41,8 KB (stili già inline, CSS in `<head>` una volta) |
| Immagini bloccate leggibili | ✓ | Nessuna immagine finché non arriva il PNG del logo |
| text/plain senza duplicati | ✓ | 8,8 KB. Non ancora inviato dalla pipeline (punto 3) |
| Link funzionanti, UTM, merge tag | ✓ parziale | Sito, archivio e disiscrizione rispondono 200. wa.me e Instagram non verificabili da qui. UTM assenti (decisione 7). `{{EMAIL}}` e "Leggi online" come oggi |
| Sezione 01 entro ~800px a 375 | ✓ | 792px (943px senza CSS) |
| Nessuna testata fuori da `sources`, nessun numero di iscritti, nessun nuovo tracciamento | ✓ | I nomi nel corpo ("secondo Reuters") sono testo dell'articolo, invariato |

## Punti aperti per Paolo
- Approvare (o correggere) i testi in `026-layout.json` e le decisioni 1-10.
- File originale del logo (SVG/PNG master) e dove ospitare il PNG.
- Formato UTM, e verificare su Brevo che gli UTM automatici siano spenti.
- Dopo l'ok sull'anteprima: mail di test a info@valoreatteso.com per provare Gmail, Apple Mail e Outlook.
- Via libera alle modifiche di pipeline elencate sopra.
