// scripts/edizioni-escluse.js — Edizioni escluse dalle "vetrine" del sito: numero della settimana (home e
// /iscriviti), Terminale in home e immagine di condivisione dedicata (usano la generica /og.png).
// Le pagine /edizione-N restano online e in sitemap. Unico punto da modificare.
//
// #018, #019: esclusione indicata nel prompt della fase 2.
// #024, #025: KPI da stime o indiscrezioni di stampa (regola "solo fonti primarie", ottobre 2026);
//             fase 3, default "escluse finché la redazione non le conferma".
const EXCLUDED = ['018', '019', '024', '025'];

const isExcluded = num => EXCLUDED.includes(String(num).padStart(3, '0'));

module.exports = { EXCLUDED, isExcluded };
