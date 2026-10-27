# Template email · restyling grafico "ibrido" · report

Branch `email/grafica-ibrida`. Solo aspetto: testi, link, `src`, merge tag, dati e pipeline invariati. Nessun invio, nessun merge, nessun deploy.

## Cosa contiene
- **Codice:** `api/_lib/email/render-html.js`, in 5 commit:
  1. testata e apertura;
  2. sezioni e lettura;
  3. inoltro e footer;
  4. dark;
  5. mobile e fallback.
- **Anteprime offline con i loghi locali** (`../../email/brand/`):
  - `dist/026/preview.html` (fixture #026);
  - `dist/026-db/preview.html` (riga #026 di Supabase, solo colonne pubbliche);
  - `dist/027/preview.html` (scheletro #027).
- **Screenshot DPR 2, pagina intera**, in `dist/026/grafica/`:
  - `026-375-light.png`, `026-375-dark.png`, `026-640-light.png`, `026-640-dark.png`;
  - `026-375-senza-media-query.png`, `026-375-font-ripiego.png`.
- **Confronto affiancato col mock** (nostro a sinistra, mock a destra): `confronto-mock-<375|640>-<light|dark>.png`, sia in `dist/026/grafica/` sia in `dist/026-db/grafica/`.
- **Misure grezze:** `qa.json`. **Diff di invarianza:** `invarianza.md`.
- **Strumenti:**
  - `scripts/email-qa-grafica.js` (render e misure, usa `measure.py` del pacchetto per le quote colore);
  - `scripts/email-invarianza.js` (diff testo, `href`/`src` e tag).

**Perché due versioni della #026:**
- Il **fixture** ha tre moduli (barre, scheda del deal, confronto) e "Cosa guardare".
- La **riga di Supabase** non li ha, come il mock: è quella che dà il confronto a parità di contenuto.

## Invarianza (§2)
Prima = template su `main` (commit edff8d3), dopo = questo branch.

| Variante | Testo visibile | href/src | Merge tag e segnaposto |
|---|---|---|---|
| #026 fixture, preview | 0 differenze | 0 su 18 | 0 su 1 (`{{EMAIL}}`) |
| #026 fixture, send | 0 | 0 su 18 | 0 su 1 |
| #027 scheletro, preview | 0 | 0 su 18 | 0 su 54 |
| #026 da Supabase, preview | 0 | 0 su 18 | 0 su 1 |

Note:
- Nel testo visibile le celle spaziatrici (solo `&nbsp;`) non contano come testo.
- Le frecce "↓" e "→" ora sono dentro `<span aria-hidden="true">`: lo stesso carattere, solo avvolto.

## Misure (§10)
| Misura (render chiaro) | Fixture 375 | Fixture 640 | Supabase 375 | Supabase 640 | Mock RACC 375 / 640 |
|---|---|---|---|---|---|
| Altezza #hdr (px) | 102 ✓ | 107 ✓ | 102 ✓ | 107 ✓ | 106 / 111 |
| offsetTop #s1 (px, ≤840 a 375, ≤700 a 640) | 771 ✓ | 604 ✓ | 815 ✓ | 626 ✓ | 815 / 626 |
| Blu nei primi 700px (%) | 14.8 ✓ | 15.8 ✓ | 14.5 ✓ | 15.6 ✓ | 14,4 / 15,6 |
| Testo chiaro su scuro nei primi 700px (%) | 10.9 ✓ | 11.7 ✓ | 11.7 ✓ | 12.6 ✓ | 12–13 |
| Blu intera mail (%) | 5.7 ✗ | 7.1 ✓ | 6.5 ✓ | 8 ✓ | 6,5 / 8,0 |
| Crema (%) | 63.4 ✓ | 61.2 ✓ | 66.3 ✓ | 65.1 ✓ | 66,2 / 65,0 |
| Ink, solo footer (%) | 8.4 ✓ | 8.7 ✓ | 9.4 ✓ | 10.4 ✓ | 9,5 / 10,4 |
| Bianco (%) | 21.8 ✗ | 22.1 ✗ | 17 ✓ | 15.5 ✓ | 17,0 / 15,4 |
| Oro (%) | 0.7 ✓ | 1 ✓ | 0.8 ✓ | 1.1 ✓ | 0,8 / 1,1 |
| Tratti di fondo blu (≥60px) | 3 ✓ | 3 ✓ | 3 ✓ | 3 ✓ | 2 (misurato sul PNG del mock: 3, cioè 106 / 150 / 124) |
| Cliccabili < 44px | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | — |
| Testi < 12px fuori dalle etichette / < 11px | 0 / 0 ✓ | 0 / 0 ✓ | 0 / 0 ✓ | 0 / 0 ✓ | — |
| Overflow orizzontale | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | — |
| Numeri sintesi (px) | [28] | [34] | [28] | [34] | 28 / 34 |
| KPI (px, uno per riga a 375) | [21] ✓ | [24] 3 colonne | [21] ✓ | [24] 3 colonne | 21 / 24 |
| Peso HTML (KB) | 51.2 ✓ | | 42.3 ✓ | | ~41 |

Note:
- **Fuori quota solo nel fixture:**
  - il bianco (21,8% e 22,1%) è sopra il 20% perché i tre moduli e "Cosa guardare" sono box bianchi che il mock non ha;
  - per lo stesso motivo il blu a 375 scende a 5,7%.
- **Riga di Supabase:** con lo stesso contenuto del mock, tutte le quote rientrano e coincidono col mock (6,5 / 66,3 / 9,4 / 17,0 a 375).
- **Senza media query, a 375:**
  - testata 123px (la data resta visibile, come richiesto);
  - `#s1` a 1027px (fixture);
  - nessun overflow, motto su una riga, colonne della sintesi e KPI impilati senza separatori.
- **Font di ripiego** (Google Fonts bloccati): stesse misure, nessun overflow, cifre allineate con Times New Roman e Georgia per i titoli.

## Contrasti (light e dark)
| Modo | Testo / elemento | Sfondo | Rapporto | Soglia | Esito |
|---|---|---|---|---|---|
| Chiaro | ink #1C1914 (titoli, lettura) | crema #F3EFE6 | 15.27:1 | 4.5 | ✓ |
| Chiaro | text #2B2824 (corpo, dek, tesi) | crema #F3EFE6 | 12.78:1 | 4.5 | ✓ |
| Chiaro | muted #4F545F (etichette KPI) | bianco #FFFFFF | 7.59:1 | 4.5 | ✓ |
| Chiaro | numeri sintesi #0039A4 | crema #F3EFE6 | 8.63:1 | 3 | ✓ |
| Chiaro | indici, KPI, link #00266E | crema #F3EFE6 | 12.18:1 | 4.5 | ✓ |
| Chiaro | valori KPI #00266E | bianco #FFFFFF | 13.98:1 | 4.5 | ✓ |
| Chiaro | occhielli #7A5C1E | crema #F3EFE6 | 5.42:1 | 4.5 | ✓ |
| Chiaro | etichetta lettura #7A5C1E | bianco #FFFFFF | 6.22:1 | 4.5 | ✓ |
| Chiaro | riga edizione #C9D2EA | navy #00266E | 9.25:1 | 4.5 | ✓ |
| Chiaro | wordmark/titolo inoltro crema | navy #00266E | 12.18:1 | 4.5 | ✓ |
| Chiaro | motto #E5962E | navy #00266E | 5.81:1 | 4.5 | ✓ |
| Chiaro | testo bottone WhatsApp ink | oro #E5962E | 7.29:1 | 4.5 | ✓ |
| Chiaro | tagline #C9C2B6 | ink #1C1914 | 9.91:1 | 4.5 | ✓ |
| Chiaro | legale #A8A196 | ink #1C1914 | 6.84:1 | 4.5 | ✓ |
| Chiaro | bordo bottone email crema (grafica) | navy #00266E | 12.18:1 | 3 | ✓ |
| Chiaro | barra #00266E (grafica) | binario #DDD3C2 | 9.43:1 | 3 | ✓ |
| Scuro | testo #EDE7DB | pagina #121110 | 15.32:1 | 4.5 | ✓ |
| Scuro | testo #EDE7DB | box #1F1C18 | 13.78:1 | 4.5 | ✓ |
| Scuro | muted #B9B1A4 | box #1F1C18 | 7.99:1 | 4.5 | ✓ |
| Scuro | numeri/link #9DB4F0 | pagina #121110 | 9.18:1 | 4.5 | ✓ |
| Scuro | numeri/link #9DB4F0 | box #1F1C18 | 8.26:1 | 4.5 | ✓ |
| Scuro | occhielli #E5962E | pagina #121110 | 7.84:1 | 4.5 | ✓ |
| Scuro | occhielli #E5962E | box #1F1C18 | 7.06:1 | 4.5 | ✓ |
| Scuro | barra #9DB4F0 (grafica) | binario #2A2621 | 7.31:1 | 3 | ✓ |

Misura su ogni elemento di testo renderizzato: contrasto minimo 5,42:1 in chiaro e 5,81:1 in scuro, nessun testo sotto soglia in nessuna variante.

## Checklist
- [x] Diff di testo visibile, `href`/`src` e tag/segnaposto vuoto.
- [x] Testata blu tra 102 e 107px; monogramma 64×44 non deformato; wordmark in testo vivo; motto su una riga a 375; filetto oro 4px subito sotto.
- [x] Titolo, dek e "In sintesi" su crema; 3 numeri `#0039A4` con `ff-n num`; nessun box blu nell'apertura.
- [x] Sezioni su crema; KPI e moduli in box bianchi con bordo `#DDD3C2`; bordo superiore dei KPI 3px `#00266E`.
- [x] "La nostra lettura": box bianco, barra oro 4px, testo ink; nessun fondo ink fuori dal footer.
- [x] Inoltro navy; bottone WhatsApp `#E5962E` con testo ink, bottone email con contorno crema; impilati, alti 50px; filetto oro 3px; footer ink.
- [x] Footer: lockup 180×60, tagline corsiva 17px, riga link con filetti `#3A352E`, legale 12px `#A8A196`, tap ≥44px.
- [~] Quote colore e misure del §10:
  - rispettate con il contenuto del mock (riga Supabase);
  - nel fixture con 3 moduli il bianco supera il 20% e il blu a 375 è 5,7%.
- [x] Mobile e fallback senza media query come al §7.
- [x] Cifre lining nei font di ripiego (`ff-n` = Playfair → Times New Roman; in Outlook, Times New Roman).
- [x] Dark come al §8: logo mai ricolorato; bottone WhatsApp e filetti oro invariati.
- [ ] **Outlook desktop: non verificato.** Qui non c'è un client Outlook. Il codice MSO c'è:
  - colonna da 640;
  - celle di sintesi e KPI da 196 con separatori;
  - `mso-padding-alt` sui bottoni;
  - Georgia, Times New Roman, Arial e Courier New forzati.
  Serve un test su Litmus o Email on Acid, oppure un invio di prova aperto in Outlook.
- [x] Un solo `<style>` più quello MSO; 2 `<img>`; peso 51,2 KB (fixture) e 42,3 KB (riga Supabase).

## Fuori perimetro: notato, non modificato
1. **`&nbsp;` nei testi:** la funzione `tie()` del template le inserisce (nomi composti, cifra+unità, ultime due parole), come chiedeva il prompt precedente. Il §7 di questo prompt dice di non inserirle; toglierle cambierebbe il testo visibile e il diff (§2). Le ho lasciate: decidi tu.
2. **"— La nostra lettura"** (`config.js`): contiene un trattino lungo, vietato dalle regole editoriali.
3. **Corpo della sezione 1 (#026):** "le stime della stampa vanno da 70 a 74 milioni". La regola sulle stime chiede di restare generici. È un testo editoriale.
4. **Riga di Supabase #026:**
   - le tesi della sintesi ricadono sui titoli delle sezioni (manca la colonna `email`), quindi sono lunghe (fino a 4 righe a 375);
   - il KPI "€14-15M/anno" ha 12 caratteri (avviso del validatore).
5. **`test-ricevuto.html` non è nel pacchetto:** il "prima" è il template su `main`, che è il sorgente di quel test.
6. **Moduli della #026:** "Scheda del deal" e confronto ora hanno box bianco e valori in Inter 14px ink allineati a destra, come chiede il §5.5. Prima i valori del confronto erano in Playfair blu.
