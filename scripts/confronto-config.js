// scripts/confronto-config.js — Coppie della pagina /confronto (Fase 4), approvate da Paolo il 28/10/2026.
// Ogni valore viene da un'edizione pubblicata: `cit` è la citazione esatta dal testo della sezione, `testo` è il numero
// come scritto (deve stare dentro `cit`), `valore` è lo stesso numero per la lunghezza della barra. Il generatore
// (generate-edition-pages.js) ricontrolla citazioni e numeri a ogni build e scarta la coppia se qualcosa non torna.
// `differenza: true` solo per valori esatti con stessa unità, stagione e fonte/metodo; la differenza è la sottrazione
// esatta, con i decimali della fonte più precisa. Le edizioni escluse dalle vetrine non forniscono valori.
// `lettura`: solo testo già pubblicato, citato tra virgolette con il link alla sezione.

module.exports = [
  {
    id: 'real-barcellona-2025-26',
    tab: 'Real Madrid · Barcellona',
    a: 'Real Madrid',
    b: 'Barcellona',
    stagione: '2025/26',
    righe: [
      {
        metrica: 'Ricavi',
        a: { ed: 26, sez: 'metrica', testo: '1.221', valore: 1221, cit: 'Il Real ha incassato 1.221 milioni di euro' },
        b: { ed: 26, sez: 'metrica', testo: '1.060', valore: 1060, cit: 'Il Barcellona ha superato per la prima volta il miliardo, con 1.060 milioni' },
        differenza: false,
        nota: { ed: 26, sez: 'metrica', cit: 'I due club non calcolano i ricavi esattamente allo stesso modo' }
      },
      {
        metrica: 'Risultato netto',
        a: { ed: 26, sez: 'metrica', testo: '26,3', valore: 26.3, segno: 'utile', cit: 'ha chiuso con un utile netto di 26,3 milioni' },
        b: { ed: 26, sez: 'metrica', testo: 'circa 18', valore: -18, segno: 'perdita', cit: 'ha chiuso con una perdita netta di circa 18 milioni' },
        differenza: false,
        motivo: 'Il valore del Barcellona è «circa»: niente differenza.'
      },
      {
        metrica: 'Debito netto',
        a: { ed: 26, sez: 'metrica', testo: 'circa 9', valore: 9, cit: 'Il debito netto, cioè i debiti meno la cassa, del Real è di circa 9 milioni, escluso lo stadio' },
        b: { ed: 26, sez: 'metrica', testo: '607', valore: 607, cit: 'Quello del Barcellona, calcolato con le regole della Liga, è di 607 milioni' },
        differenza: false,
        motivo: 'Valore «circa» e metodi diversi (Real escluso lo stadio, Barcellona con le regole della Liga): niente differenza.'
      }
    ],
    lettura: { ed: 26, sez: 'metrica', cit: 'Il Real ricava circa 160 milioni in più, il 15% (1.221 contro 1.060 milioni).' }
  },
  {
    id: 'milan-inter-2024-25',
    tab: 'Milan · Inter 2024/25',
    a: 'Milan',
    b: 'Inter',
    stagione: '2024/25',
    righe: [
      {
        metrica: 'Ricavi commerciali',
        a: { ed: 21, sez: 'bilancio', testo: '152,3', valore: 152.3, cit: 'I ricavi commerciali, cioè sponsorizzazioni, partnership e merchandising, valgono 152,3 milioni' },
        b: { ed: 21, sez: 'bilancio', testo: '142,3', valore: 142.3, cit: "All'Inter i diritti TV valgono 264,4 milioni contro 142,3 di commerciale" },
        differenza: true
      },
      {
        metrica: 'Diritti TV',
        a: { ed: 21, sez: 'bilancio', testo: '154,2', valore: 154.2, cit: 'I diritti televisivi 154,2 milioni' },
        b: { ed: 21, sez: 'bilancio', testo: '264,4', valore: 264.4, cit: "All'Inter i diritti TV valgono 264,4 milioni contro 142,3 di commerciale" },
        differenza: true
      },
      {
        metrica: 'Ricavi totali',
        a: { ed: 21, sez: 'bilancio', testo: '494,5', valore: 494.5, cit: 'Il Milan ha chiuso il 2024/25 con ricavi totali per 494,5 milioni di euro' },
        b: { ed: 22, sez: 'bilancio', testo: '567', valore: 567, cit: '518 milioni, contro il record di 567 della stagione precedente' },
        differenza: false,
        motivo: 'Fonti diverse e perimetro dell’Inter non dichiarato: niente differenza.'
      },
      {
        metrica: 'Risultato netto',
        a: { ed: 21, sez: 'bilancio', testo: '3,0', valore: 3, segno: 'utile', cit: 'un utile netto di 3,0 milioni' },
        b: { ed: 22, sez: 'bilancio', testo: '35,4', valore: 35.4, segno: 'utile', cit: 'dopo i 35,4 milioni del 2024/25' },
        differenza: false,
        motivo: 'Fonti diverse e perimetro dell’Inter non dichiarato: niente differenza.'
      }
    ],
    lettura: { ed: 21, sez: 'bilancio', cit: "All'Inter i diritti TV valgono 264,4 milioni contro 142,3 di commerciale, quasi il doppio." }
  },
  {
    id: 'milan-inter-2025-26',
    tab: 'Milan · Inter 2025/26',
    a: 'Milan',
    b: 'Inter',
    stagione: '2025/26',
    righe: [
      {
        metrica: 'Ricavi',
        a: { ed: 26, sez: 'bilancio', testo: '464,6', valore: 464.6, cit: 'con ricavi per 464,6 milioni' },
        b: { ed: 22, sez: 'bilancio', testo: '518', valore: 518, cit: '518 milioni, contro il record di 567 della stagione precedente' },
        differenza: false,
        motivo: 'Fonti diverse e perimetro non dichiarato: niente differenza.'
      },
      {
        metrica: 'Risultato netto',
        a: { ed: 26, sez: 'bilancio', testo: 'circa 24', valore: -24, segno: 'perdita', cit: 'una perdita di circa 24 milioni' },
        b: { ed: 22, sez: 'bilancio', testo: '22,7', valore: 22.7, segno: 'utile', cit: 'utile netto di 22,7 milioni' },
        differenza: false,
        motivo: 'Il valore del Milan è «circa»: niente differenza.'
      }
    ],
    lettura: null
  }
];
