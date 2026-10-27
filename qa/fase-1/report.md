# Restyling fase 1 · Quick win · report QA

Branch `restyle/fase-1-quick-win`. Consegna solo in anteprima Vercel: nessun merge, nessun deploy in produzione.
URL anteprima (alias stabile del branch): https://valore-atteso-git-restyle-2f07cf-paoloferrara23-3103s-projects.vercel.app · verificato sull'anteprima: `/pagina-che-non-esiste` risponde 404 con la pagina brandizzata, `site.webmanifest` 200.

## Come è stato misurato
- `scripts/qa-fase-1.js`: server locale che imita Vercel (cleanUrls, `404.html` con status 404, CSP di `vercel.json`), Playwright 1440×900 e 375×812 DPR 2.
- Dati delle edizioni da `qa/fase-1/data/` (solo colonne pubbliche delle edizioni pubblicate, nessun indirizzo email). Supabase e `/api/*` simulati con `page.route`: **nessuna richiesta reale**, nessuna iscrizione.
- Prima = `main` (commit edff8d3). Dopo = questo branch, con le pagine edizione rigenerate dal workflow sul branch.
- Lighthouse 12 mobile, in locale e con gli stessi file. Sull'anteprima Vercel la SEO risulterebbe più bassa perché Vercel aggiunge `noindex` alle anteprime.
- Screenshot: `qa/fase-1/prima/` e `qa/fase-1/dopo/` (`<pagina>-<larghezza>.png` intera, `-fold.png` primo schermo). Nel "dopo" anche `form-*.png`, `focus-*.png` e `favicon-e-og.png`.

## Misure (prima → dopo)
| Pagina | Status | Overflow | Testo <11px | <12px (non mono maiuscolo) | Target <44px | Contrasti <soglia (min) | Errori console |
|---|---|---|---|---|---|---|---|
| home-1440 | 200 | False | 40 → 0 | 0 → 0 | 21 → 0 | 29 → 0 (5.23:1) | 0 → 0 |
| home-375 | 200 | False | 40 → 0 | 0 → 0 | 14 → 0 | 11 → 0 (5.74:1) | 0 → 0 |
| archivio-1440 | 200 | False | 114 → 0 | 0 → 0 | 12 → 0 | 141 → 0 (5.23:1) | 0 → 0 |
| archivio-375 | 200 | False | 114 → 0 | 0 → 0 | 9 → 0 | 139 → 0 (5.23:1) | 0 → 0 |
| lettore-1440 | 200 | False | 59 → 0 | 0 → 0 | 13 → 0 | 55 → 0 (4.7:1) | 0 → 0 |
| lettore-375 | 200 | False | 36 → 0 | 0 → 0 | 10 → 0 | 30 → 0 (4.7:1) | 0 → 0 |
| about-1440 | 200 | False | 4 → 0 | 0 → 0 | 1 → 0 | 3 → 0 (5.23:1) | 0 → 0 |
| about-375 | 200 | False | 4 → 0 | 0 → 0 | 1 → 0 | 3 → 0 (5.23:1) | 0 → 0 |
| sponsor-1440 | 200 | False | 28 → 0 | 0 → 0 | 5 → 0 | 15 → 0 (4.7:1) | 0 → 0 |
| sponsor-375 | 200 | False | 28 → 0 | 0 → 0 | 2 → 0 | 15 → 0 (4.7:1) | 0 → 0 |
| 404-1440 | 404 | False | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 (5.23:1) | 1 → 1 |
| 404-375 | 404 | False | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 (5.23:1) | 1 → 1 |
| edizione-26-1440 | 200 | False | 13 → 0 | 11 → 0 | 9 → 0 | 26 → 0 (5.23:1) | 0 → 0 |
| edizione-26-375 | 200 | False | 13 → 0 | 11 → 0 | 7 → 0 | 24 → 0 (5.23:1) | 0 → 0 |

Note:
- L'"errore console" della 404 è Chrome che registra lo status 404 della pagina stessa: è il comportamento voluto.
- Prima della fase 1, in locale la 404 era una pagina di testo; su Vercel era la pagina d'errore di Vercel.
- I link dentro una frase (es. "disclaimer completo", "Privacy Policy") sono esclusi dal conteggio dei target, come prevede l'eccezione "inline" di WCAG.

## Lighthouse mobile (prima → dopo)
| Pagina | Performance | Accessibilità | Best practices | SEO |
|---|---|---|---|---|
| home | 85 → 100 | 95 → 100 | 93 → 96 | 100 → 100 |
| archivio | 85 → 100 | 89 → 100 | 96 → 96 | 91 → 100 |
| about | 86 → 100 | 89 → 100 | 96 → 100 | 100 → 100 |
| sponsor | 83 → 100 | 93 → 100 | 96 → 100 | 100 → 100 |
| edizione | 83 → 100 | 95 → 100 | 96 → 100 | 100 → 100 |

- La 404 non ha punteggio perché Lighthouse non valuta le pagine con status 404.
- Le best practice a 96 su home e archivio dipendono dalla sandbox di test, che non raggiunge Supabase (errore di rete in console). In produzione quella chiamata funziona.

## Contrasti delle coppie toccate (WCAG 2.1)
| Testo / elemento | Sfondo | Rapporto | Esito |
|---|---|---|---|
| muted #4F545F | crema sito #F0EBE1 | 6.39:1 | ✓ (soglia 4.5) |
| muted #4F545F | crema2 footer #E7DFD2 | 5.74:1 | ✓ (soglia 4.5) |
| muted #4F545F | card #FFFDF8 | 7.47:1 | ✓ (soglia 4.5) |
| oro testo #7A5C1E | crema sito #F0EBE1 | 5.23:1 | ✓ (soglia 4.5) |
| oro testo #7A5C1E | crema2 #E7DFD2 | 4.70:1 | ✓ (soglia 4.5) |
| blu #0039A4 (pillola, testo) | crema sito #F0EBE1 | 8.33:1 | ✓ (soglia 4.5) |
| crema #F3EFE6 (bottone) | blu #0039A4 | 8.63:1 | ✓ (soglia 4.5) |
| crema #F3EFE6 (hover) | navy #00266E | 12.18:1 | ✓ (soglia 4.5) |
| errore #9A3A2F | card #FFFDF8 | 6.84:1 | ✓ (soglia 4.5) |
| errore #9A3A2F | crema sito #F0EBE1 | 5.85:1 | ✓ (soglia 4.5) |
| errore su scuro #E9A08A | ink #1C1914 | 8.23:1 | ✓ (soglia 4.5) |
| consenso su scuro #D7D3CB | ink #1C1914 | 11.74:1 | ✓ (soglia 4.5) |
| meta lettore #A9B1CC | ink #1C1914 | 8.22:1 | ✓ (soglia 4.5) |
| anello focus #0039A4 (non testo) | crema sito #F0EBE1 | 8.33:1 | ✓ (soglia 3) |
| anello focus #F3EFE6 su scuro | ink #1C1914 | 15.27:1 | ✓ (soglia 4.5) |
| bordo errore #9A3A2F (non testo) | card #FFFDF8 | 6.84:1 | ✓ (soglia 3) |

Il fondo crema del sito resta `#F0EBE1`: il passaggio a `#F3EFE6` non è tra gli interventi della fase 1.

## Form (risposte simulate)
- **Clic senza consenso:** messaggio "Per iscriverti accetta la Privacy Policy." accanto alla casella, `aria-invalid="true"` e `aria-describedby` sulla casella, focus sulla casella.
- **Email non valida:** messaggio "Inserisci un indirizzo email valido." sotto il campo, `aria-invalid` e focus sul campo.
- **Invio:** bottone con `aria-busy="true"`; successo ed errore del server con i testi già esistenti.
- **Payload e source invariati:** `{"email":…,"source":"direct__hero"}`. Rete: 2 richieste a `/api/subscribe`, entrambe simulate; nessuna richiesta esterna oltre a Google Fonts.
- **Tastiera:** 30 tappe di Tab sulla home, tutte con anello di focus visibile. Il primo elemento è "Vai al contenuto".

## Checklist
- [x] Favicon nella scheda e apple-touch (status 200 per `favicon.ico`, `favicon.svg`, `apple-touch-icon-180x180.png`, `icon-512x512.png`, `site.webmanifest`).
- [x] `og:image` su tutte le pagine + `twitter:card=summary_large_image`.
  - `/og.png` risponde 200 nel branch.
  - I meta puntano a `https://www.valoreatteso.com/og.png`, che sarà online solo dopo il merge.
- [x] Bottone sempre attivo e blu, errore del consenso accessibile.
- [x] Nessun testo sotto 12px, salvo il mono maiuscolo a 11px (0 casi fuori soglia).
- [x] Grigi, oro e pillola sostituiti; contrasti ≥4,5:1 (minimo misurato 4,70:1).
- [x] Date in italiano (`27 ott 2026` in `<time datetime>`), anche per le prime edizioni scritte per esteso.
- [x] 404 vera (status 404) e brandizzata.
- [x] Focus visibile ovunque, target ≥44px (0 casi).
- [x] Header e footer della home su /about e /sponsor.
- [x] Testi e numeri invariati (`qa/fase-1/testi-diff.json`: solo "Vai al contenuto", header/footer/box presi dalla home e il formato della data).
- [x] Nessuna richiesta reale a `/api/subscribe`.

## Decisioni prese (modificabili)
1. **Logo:**
   - header alto 32px (28px su mobile), cioè 96×32 e 84×28;
   - il README dei loghi indica 180px di larghezza minima per l'orizzontale, mentre il prompt chiede 32–36px di altezza: ho seguito il prompt;
   - area di rispetto verticale nella nav da 64px: 16px contro i 19px del README.
2. **Footer:** monogramma ink alto 44px.
3. **Codice condiviso:** `va.css` (logo, form, header/footer, focus) e `va.js` (form, date, menu). Le pagine edizione e l'archivio usano la stessa funzione di invio.
4. **Font:** i font del sito non cambiano in questa fase (fase 7 dell'audit). Ho aggiunto Inter 400/500 solo per consenso ed errori, e Playfair 700 solo dove serve (titolo della 404 e di /about).
   - I font di Google ora si caricano senza bloccare il render: è da qui che viene il salto della performance.
5. **Casella del consenso:** dove non c'era (archivio, pagine edizione, glossario) non l'ho aggiunta; lì vale solo la nuova validazione dell'email.
6. **og:url:**
   - home invariata (`https://valoreatteso.com`, senza www);
   - le altre pagine usano canonical o www;
   - per la 404, `og:url` è la home.
7. **Source dei nuovi form:** `direct__about` e `direct__404` (stesso formato `VA_SOURCE__posizione` della home).
8. **Club Intelligence, conferma, cancella, cookie, disclaimer, privacy, sponsor-terms, sponsor-area:** solo favicon e meta di condivisione. Privacy e glossario hanno anche il logo; glossario ha anche il form blu.
9. **/sponsor:** la frase del vecchio footer ("Partnership valutate e approvate manualmente.") resta come nota sopra il footer standard. Il link "Torna alla newsletter" è sostituito dall'header standard.
10. **Lettore dell'archivio:** "Torna all'archivio" ora ha `href="/archivio"`, quindi si raggiunge da tastiera e conta per la SEO; il comportamento al clic è identico.

## Testi da approvare
- 404: kicker "Errore 404", titolo "Pagina non trovata", riga "L'indirizzo che hai aperto non esiste o è stato spostato.", description della pagina.
- Form: "Per iscriverti accetta la Privacy Policy." e "Inserisci un indirizzo email valido.".
- "Vai al contenuto".
- `og:image:alt`: "Valore Atteso. Il calcio dei numeri, non dei goal.".
- Description nuove (meta e og) per cookie-policy, disclaimer, sponsor-terms, conferma, cancella, sponsor-area.

## Voci in attesa (non decise da me)
1. **Testo di /about, "Le nostre fonti":** cita testate (Reuters, Financial Times, Bloomberg, The Athletic, BBC) in contrasto con la regola delle sole fonti primarie. È un testo editoriale: non l'ho toccato.
2. **Fonti di stampa nelle pagine edizione e nel lettore** (es. #026: ESPN, Sky Sport, Reuters, Forbes…): blocchi Fonti invariati come da vincolo, da decidere con la redazione.
3. **Tag interno visibile in archivio:** l'edizione #023 mostra il tag `scout:3c5005c3-…`. È un dato da correggere su Supabase (non toccato).
4. **Link "Ultima edizione · Leggi preview" della home:** punta a `/archivio?edition=026`, ma l'archivio non apre l'edizione da quel parametro (mostra la lista). È un comportamento esistente, non toccato. URL canonico delle edizioni: da decidere.
5. **Casella del consenso nei form che non l'hanno:** da decidere se aggiungerla.
6. **Anteprime Vercel pubbliche e collegate allo stesso Supabase/Resend della produzione:** un'iscrizione fatta sull'anteprima è reale.
7. **Banner cookie:** non presente nel codice; "Gestisci cookie" porta a /cookie-policy. Non toccato.
8. **Master SVG del logo:** quando arrivano si sostituiscono i file in `brand/svg/` e in root con gli stessi nomi.
