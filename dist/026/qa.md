# QA #026

- **640-light**: #s1 a 643px · altezza 5246px · overflow false · contrasto min 5.81 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 11) · KPI impilati null · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **640-dark**: #s1 a 645px · altezza 5282px · overflow false · contrasto min 5.81 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 11) · KPI impilati null · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **375-light**: #s1 a 768px · altezza 7343px · overflow false · contrasto min 5.81 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 11) · KPI impilati true · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **375-dark**: #s1 a 770px · altezza 7379px · overflow false · contrasto min 5.81 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 11) · KPI impilati true · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **375-senza-media-query**: #s1 a 913px · altezza 7828px · overflow false · contrasto min 5.81 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 11) · KPI impilati true · etichette barre a capo 0 · motto righe 2 · loghi 64×44 def 0, 180×60 def 0

## Coppie grafiche
- filetto oro / ink: 5.76:1
- filetto oro / pagina dark: 6.2:1
- bordo footer / pagina dark: 1.55:1
- bordo sintesi / pagina dark: 2.24:1
- blu / ink (motivo del filetto): 1.25:1

## Variante con intro: #s1 a 933px (oltre gli 800px di 133px)

## Testi mancanti rispetto alla 026: nessuno

## Validazione
- fonti vuote: sections[0].sources: schema: almeno 1 elementi
- sintesi con 2 righe: summary: schema: almeno 3 elementi
- numero KPI mancante: sections[0].kpi[0].value: numero mancante
- numero sintesi assente nella sezione: summary[2].number: il numero non compare nella sezione 3
- numero ripetuto KPI/modulo: sections[0]: numero ripetuto nella sezione (565m)
- modulo non valido: sections[2].module.type: schema: uno tra bars, deal, vs, none
- cella vs vuota: sections[2].module.rows[0].b: cella vuota
- valore vs con trattino: sections[2].module.rows[3].b: valore assente reso con un trattino: il dato va scritto esplicito
- fonte su dominio di stampa: sections[0].sources[0].url: fonte di stampa o social non ammessa · sections[0].sources[0].url: nome di testata o social · output: placeholder rimasti nell'output (4)
- fonte con testo generico: sections[0].sources[0].testo: il testo del link deve essere il nome del documento · output: placeholder rimasti nell'output (4)
- UTM su fonte esterna: sections[0].sources[0].url: niente UTM sulle fonti esterne · output: placeholder rimasti nell'output (4) · output: HTML: UTM su un link esterno (https://example.org/a?utm_source=x) · output: text/plain: UTM su un link esterno (https://example.org/a?utm_source=x)
- numero di iscritti: dek: numero di iscritti · output: numero di iscritti nell'output
- preheader troncato: preheader: preheader troncato con "…": serve un testo dedicato
- 026 in send (atteso: bloccato): 23 errori
- 026 pulita in send, dati legali ancora placeholder (atteso: bloccato): output: placeholder rimasti nell'output (4)
- 026 pulita in send, dati legali compilati (atteso: OK): OK
