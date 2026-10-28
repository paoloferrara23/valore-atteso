# QA Fase 4 · archivio card-dato, Confronto vs, Club Intelligence

Branch `restyle/fase-4-format-dati`. Deploy di produzione di partenza (per Instant Rollback): `dpl_5sba3soC2yZ9r3kMNktMk5q9LLBv` (commit `a32b05e`).
"prima" = main in produzione, "dopo" = branch, serviti in locale con `scripts/qa-serve.js` (stessi header di Vercel). Nessun invio: `/api/subscribe` simulato, `/api/admin-db` bloccato. Le 3 GET di Club Intelligence ricevono gli stessi dati (`ci-dati.json`, esportati in sola lettura il 28/10/2026).

## Comandi

- `node scripts/qa-fase-4.js <sito> prima|dopo <editions.json> qa/fase-4/ci-dati.json` → screenshot, `misure.json`, report e tastiera
- `node scripts/qa-ci-snapshot.js <sito> <uscita.txt> qa/fase-4/ci-dati.json [--snapshot]` → testo di Club Intelligence per metrica e per club

## File

| File | Cosa contiene |
|---|---|
| `prima/`, `dopo/` | Screenshot JPEG fold a 375/640/1280/1440 e pagina intera a 375/1440 di: archivio (Bilancio, Deal, Metrica, ricerca «Milan», ricerca senza risultati, senza JS), Confronto (3 coppie, solo dopo), Club Intelligence (classifica, Inter, AC Milan, Atalanta), about, home. `misure.json` con testi <12px, target <44px, overflow, errori console, rete e CLS anche a 320 |
| `report-dati-archivio.md` | 78 celle (26 edizioni × 3 sezioni): valore, etichetta, nota e link mostrati contro la fonte. **78 ✓, 0 ✗** |
| `report-confronto.md` | 9 righe: valori, citazioni, differenze ricalcolate, regola applicata. **9 ✓, 0 ✗**, nessun problema al build |
| `ci-prima.txt`, `ci-dopo.txt`, `ci-diff.txt` (e `*-snapshot.txt`) | Club Intelligence con dati live e senza: **0 righe di dati diverse**. Diversi solo i testi approvati (etichetta LIVE, emoji → icone), il link nuovo «Confronta due club →» e le richieste a font, va.css, va.js e monogramma (stesso dominio) |
| `contrasti.md` | 34 coppie nuove, tutte sopra soglia |
| `tastiera.md` | Ordine del focus su archivio, Confronto e Club Intelligence; frecce, Home e Fine nei tab; «Azzera». `dopo/focus-*.jpg`: 3 screenshot del focus per pagina |
| `lighthouse/` | JSON Lighthouse mobile prima e dopo |

## Lighthouse mobile (locale, stessa macchina)

| Pagina | Prima | Dopo | Note |
|---|---|---|---|
| /archivio | 98 / 100 / 100 / 100 | 97 / 100 / 100 / 100 | CLS 0. FCP +0,2 s per l'HTML più pesante (KPI di 3 sezioni, header standard): 67 → 85 KB |
| /club-intelligence | 98 / 97 / 93 / 100 | 95 / 100 / 96 / 100 | A11y 100: nessun fallimento `font-size` né `heading-order`. Perf: ora carica i font del brand (LCP 1,8 → 2,7 s), CLS 0. BP 96 solo per le GET a Supabase bloccate dal proxy di questo ambiente (errore in console anche prima); online le richieste rispondono |
| /confronto | nuova | 99 / 100 / 100 / 100 | |
| /about | 99 / 100 / 100 / 100 | 99 / 100 / 100 / 100 | non toccata (solo footer) |
| / (home) | 96 / 100 / 100 / 100 | 97 / 100 / 100 / 100 | non toccata (solo footer) |

## Misure (dopo)

Su archivio (tutti gli stati), Confronto e Club Intelligence, a 320/375/640/1280/1440: 0 testi sotto i 12px, 0 target sotto i 44px (esclusi i link nel testo), 0 overflow orizzontale (salvo lo scroller dei club, voluto), 0 errori console, CLS ≤ 0,005. Rete: 0 richieste non-GET a Supabase, 0 richieste reali a `/api`, nessun dominio nuovo. Senza JS l'archivio mostra tutte le 26 card con il KPI del Bilancio (22 card; le 4 escluse senza numeri), filtri e ricerca nascosti.
About e home restano con le etichette a 11px già segnalate (fuori perimetro); il footer standard è passato da 11 a 12px ovunque.

## Checklist

- [x] archivio: KPI della sezione = fonte (78/78), filtri e ricerca da tastiera, stato vuoto con «Azzera», URL `?sezione=`, senza JS tutto visibile, CLS ≤0,1
- [x] header e footer standard su /archivio (nav completa con Club Intelligence)
- [x] escluse (#018, #019, #024, #025): card senza numeri con «Numeri in revisione» [[DA_APPROVARE]], link alla pagina
- [x] Confronto: solo le 3 coppie e i valori approvati, citazioni ricontrollate al build, differenze solo ammesse ed esatte (Milan +10,0 commerciale, Inter +110,2 diritti TV, 2024/25)
- [x] CI: stesse 3 query (stesse query string), parte dati identica byte per byte, 0 differenze di dati prima/dopo
- [x] CI nel brand: navy, crema, oro, Inter/Plex/Playfair, monogramma ufficiale, 0 ciano nell'interfaccia (i colori dei club restano solo negli stemmi e nei dati), 0 pulsazioni
- [x] CI: 0 testi <12px, target ≥44px, heading in ordine (h1 → h2 → h3)
- [x] Atalanta ed etichetta LIVE secondo le decisioni, in commit separati
- [ ] Chi scrive: non fatto, mancano foto, ruolo, testo e decisione su LinkedIn
- [x] contrasti, tastiera, Lighthouse nei target (Perf ≥90, A11y 100 su CI, SEO 100, CLS ≤0,1)
- [x] testi, numeri, note, disclaimer, API, DB, codice admin invariati
- [x] 0 richieste reali a subscribe/admin-db, 0 scritture
- [x] nessuna libreria, funzione o link esterno nuovo

## Testi nuovi da approvare [[DA_APPROVARE]]

- Archivio: «Cerca nell'archivio» (solo lettori di schermo), placeholder «Cerca nel titolo o nei numeri (es. Milan)», «N edizioni», «Nessuna edizione trovata per «…». Prova con un altro nome.», «Azzera», «Numeri in revisione», «Confronta due club sugli stessi numeri →»
- Confronto: titolo «Due club, gli stessi numeri», kicker «Club Intelligence · Confronto», introduzione, nomi delle tab, «Differenza (valori esatti e omogenei)», «Perdita», i motivi delle righe senza differenza, la forma «{Club} +{differenza} milioni di euro di {metrica} ({stagione})», «La nostra lettura», «Esplora Club Intelligence →», «Tutte le edizioni →»
- Club Intelligence: «Confronta due club →», «Dati verificati · Serie A 2024/25», «● Verificato»

## Da segnalare (non toccato)

- Codice admin nell'HTML pubblico di /archivio (`checkAdmin` fa una GET a `/api/admin-db` al caricamento, `saveEdit`)
- `club_deals` letto senza filtro `verified`
- Risultato netto del Milan 2024/25: 3,0 milioni nell'edizione #021, 2,9 milioni in `club_financials` (Club Intelligence)
- Capienza dello stadio a 0 nella testata di AS Roma e AC Milan in Club Intelligence (campo `capacity` vuoto nel DB)
- `/confronto` in sitemap dopo l'OK di produzione (29/10/2026)
