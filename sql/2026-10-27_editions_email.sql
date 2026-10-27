-- PROPOSTA, NON APPLICATA: serve l'ok di Paolo.
-- Campi del template email generico (api/_lib/email/), accanto alle colonne di oggi.
-- La riga editions resta la fonte di titolo, sottotitolo, testi, KPI e letture; qui vanno
-- solo i campi che il template A2 aggiunge. Struttura: vedi api/_lib/email/contract.js.
--
-- {
--   "preheader": "85-100 caratteri", "intro": null, "read_min": 8, "sponsor": null,
--   "summary": [{"section_n":1,"label":"Il Bilancio","number":"…","thesis":"…"}, …],
--   "sections": [{"kpi":[…], "module":{"type":"bars|deal|vs|none", …}, "sources":[{"testo":"…","url":"https://…"}]}, …],
--   "watch": [{"label":"…","text":"…"}],
--   "share": {"headline":"…","subline":"…","text":"…"},
--   "approvals": {"copy":false,"factcheck":false,"paolo":false}
-- }
--
-- Le policy RLS esistenti su editions coprono anche la nuova colonna: la chiave pubblica la
-- legge solo per le edizioni pubblicate (non contiene dati personali).

alter table public.editions add column if not exists email jsonb;

comment on column public.editions.email is
  'Campi del template email generico (summary, moduli, fonti con URL, watch, share, sponsor, approvals). Vedi api/_lib/email/contract.js.';
