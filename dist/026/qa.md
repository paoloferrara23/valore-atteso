# QA #026

- **640-light**: #s1 a 604px · altezza 5237px · overflow false · contrasto min 5.42 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 0) · KPI impilati null · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **640-dark**: #s1 a 606px · altezza 5293px · overflow false · contrasto min 5.81 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 0) · KPI impilati null · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **375-light**: #s1 a 771px · altezza 7189px · overflow false · contrasto min 5.42 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 0) · KPI impilati true · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **375-dark**: #s1 a 773px · altezza 7245px · overflow false · contrasto min 5.81 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 0) · KPI impilati true · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0
- **375-senza-media-query**: #s1 a 771px · altezza 7189px · overflow false · contrasto min 5.42 (sotto 4,5: 0) · font <11px 0 · testo <12px 0 · tap <44px 0 (link fonti nel testo 0) · KPI impilati true · etichette barre a capo 0 · motto righe 1 · loghi 64×44 def 0, 180×60 def 0

## Coppie grafiche
- filetto oro / ink: 5.76:1
- filetto oro / pagina dark: 6.2:1
- bordo footer / pagina dark: 1.55:1
- bordo sintesi / pagina dark: 2.24:1
- blu / ink (motivo del filetto): 1.25:1

## Testi mancanti rispetto alla 026: nessuno

## Validazione
- sintesi con 2 righe: summary: schema: almeno 3 elementi
- numero KPI mancante: sections[0].kpi[0].value: numero mancante
- numero sintesi assente nella sezione: summary[2].number: il numero non compare nella sezione 3
- numero ripetuto KPI/modulo: sections[0]: numero ripetuto nella sezione (565m)
- modulo non valido: sections[2].module.type: schema: uno tra bars, deal, vs, none
- cella vs vuota: sections[2].module.rows[0].b: cella vuota
- valore vs con trattino: sections[2].module.rows[3].b: valore assente reso con un trattino: il dato va scritto esplicito
- nome di stampa nel corpo (send): sections[1].body[1]: nome di testata o social
- placeholder in send: dek: placeholder rimasto · output: placeholder rimasti nell'output (2)
- edizione non approvata (send): approvals.paolo: edizione non approvata da Paolo in Control Room
- numero di iscritti: dek: numero di iscritti · output: numero di iscritti nell'output
- preheader troncato: preheader: preheader troncato con "…": serve un testo dedicato
- 026 in send (atteso: OK): OK
