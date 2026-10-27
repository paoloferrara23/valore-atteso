# Valore Atteso — Pacchetto loghi e monogrammi

> ⚠️ **Avvertenza.** Questi file nascono dagli SVG **ricostruiti** in `/workspace/va-brand/` (tracciati dalla tavola `lockup-riferimento.png` del 26/10/2026). Sono fedeli ma **non sono i master**: il font del wordmark è un'approssimazione (Noto Serif 500) e oltre ~800 px le curve del monogramma possono mostrare minime ondulazioni. Quando arrivano gli SVG originali va rigenerato tutto il pacchetto (gli script sono in `_build/`).

Anteprima di tutto: **`LOGHI-ANTEPRIMA.png`**.

## Colori
| Nome | Hex | Uso |
|---|---|---|
| Blu brand | `#0039A4` | fondo principale (versioni crema) |
| Crema | `#F3EFE6` | logo su blu/scuro · fondo chiaro (versioni ink) |
| Ink | `#1C1914` | logo su chiaro · fondo scuro |
| Oro su scuro | `#D67F0D` | punto/filetto nelle versioni crema |
| Oro su chiaro | `#B08A4B` | punto/filetto nelle versioni ink |

## Regole d'uso
- **Fondi scuri o blu → solo versioni `crema`. Fondi chiari (crema, bianco) → solo versioni `ink`.**
- L'oro **dipende dal fondo** ed è già corretto in ogni file: non scambiarlo.
- **Mai** ricolorare, deformare, ruotare, aggiungere ombre, contorni, bagliori o effetti; non mettere il logo su foto senza un fondo pieno dietro.
- Unica eccezione cromatica ammessa: filigrana ton-sur-ton dei template (monogramma senza punto al 4,5% di opacità).
- I tondi sono badge autonomi: `tondo-scuro` (disco ink) su fondi chiari, `tondo-crema` (disco crema) su blu/ink.

## Area di rispetto
Spazio libero minimo su ogni lato = **4 × il diametro del punto oro**. In pratica:
| Lockup | Area di rispetto per lato |
|---|---|
| monogramma | ≈ 0,5 × altezza del logo |
| verticale | ≈ 0,3 × altezza del logo |
| orizzontale | ≈ 0,6 × altezza del logo |
| wordmark | ≈ 2,5 × altezza del logo (il punto è grande rispetto alla riga) |
| tondo | ≈ 1/6 del diametro |
Tutti i PNG in `png-su-fondo/` rispettano già quest'area (e la superano).

## Dimensioni minime (indicative)
| Lockup | Minimo digitale |
|---|---|
| monogramma | 40 px di altezza (footer template: 50 px) |
| verticale | 140 px di larghezza |
| orizzontale | 180 px di larghezza |
| wordmark | 200 px di larghezza |
| tondo | 96 px di diametro (sotto, la scritta dell'anello non si legge: usare il monogramma) |
Eccezione: le favicon (16–32 px) usano il monogramma pieno senza area di rispetto, come da prassi.

## Cosa c'è e dove usarlo
### `svg/` — vettoriali (copia identica degli SVG ricostruiti)
Per web, stampa, tipografia, impaginazione. Prima scelta ovunque sia accettato l'SVG.
`monogramma-ink|crema`, `verticale-ink|crema`, `orizzontale-ink|crema`, `wordmark-ink|crema`, `tondo-scuro`, `tondo-crema`.

### `png-trasparente/` — PNG con sfondo trasparente
Ogni lockup in due misure: `_2000px` (lato lungo 2000 px: slide, video, stampa digitale) e `_500px` (@1x: email, documenti, web leggero). Stesse regole: crema solo su scuro/blu, ink solo su chiaro.

### `png-su-fondo/` — già montati, pronti da pubblicare
Nome file: `lockup-versione_su-fondo_LxA.png`.
- `*-crema_su-blu` (fondo `#0039A4`) e `*-crema_su-ink` (fondo `#1C1914`)
- `*-ink_su-crema` (fondo `#F3EFE6`) e `*-ink_su-bianco` (fondo `#FFFFFF`)
- `tondo-crema_su-blu|ink`, `tondo-scuro_su-crema|bianco`
- Formati: **1080×1080** (post social, quadrato) per tutti; **1500×500** (header X/Twitter, banner) per orizzontale e wordmark.

### `avatar/` — foto profilo
- `instagram-avatar_crema_1080.png` — monogramma ink + punto oro su `#F3EFE6` (**consigliato** per Instagram).
- `instagram-avatar_blu_1080.png` — monogramma crema + punto oro su `#0039A4` (alternativa, più riconoscibile in feed affollati).
- Il riquadro del monogramma sta dentro l'80% del cerchio (zona sicura); `anteprima-crop-circolare.png` mostra il ritaglio rotondo con la zona sicura in rosso e le miniature a 110 e 40 px.

### `favicon/` — sito web
Versione scelta: **monogramma crema su blu** (a 32 px resta leggibile e, a differenza di quella crema, si stacca dalla barra schede chiara del browser).
- `favicon.svg` (browser moderni), `favicon.ico` (16/32/48 px, compatibilità), `favicon-32x32.png`, `apple-touch-icon-180x180.png` (iPhone/iPad), `icon-512x512.png` (PWA/Android, manifest).
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">
```
Nota: a 16–32 px le aste sottili della A si assottigliano molto: è un limite del monogramma, non un difetto del file.

### `condivisione/` — anteprima link
`og-image_1200x630.png`: lockup orizzontale crema su blu con il claim *"Il calcio dei numeri, non dei goal."* in Playfair Display corsivo. Da usare come `og:image` / `twitter:image` (card `summary_large_image`).

### `_build/`
Script di generazione (Chrome headless + Pillow) e file di lavoro: non servono per l'uso, solo per rigenerare il pacchetto.
