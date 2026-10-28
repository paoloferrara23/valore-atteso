# QA fase 3

- `prima/` (produzione al 28/10, branch main) e `dopo/` (branch `restyle/fase-3-edizioni`): prima schermata di ogni pagina a 375, 640, 1280, 1440 (più 320 per la home e reduced-motion a 375/1440); pagina intera a 375 e 1440, in JPEG a risoluzione 1x per contenere il peso del repository. Il set completo in PNG DPR 2 si rigenera con `node scripts/qa-fase-3.js <cartella> <etichetta> [editions.json]`.
- `misure.md` / `misure.json`: overflow, testi sotto i minimi, target <44px, contrasti (anche sui fondi a gradiente, campionati sui pixel), KPI troncati, errori console, posizione di email, bottone e consenso in home, rete (0 richieste reali a /api/subscribe e /api/admin-db), tastiera.
- `report-dati.md`: ogni valore mostrato contro il campo `kpis` della fonte; `meta.md`: titoli, canonical, og:image, JSON-LD, sitemap.
- `dopo/form-consenso.md`: consenso nei form compatti con invio simulato.
- `lighthouse/`: report JSON mobile prima e dopo di home, archivio, /edizione-26, /edizione-17.
