# Valore Atteso — Istruzioni operative per Claude Code

## Chi è Paolo
M&A Manager con background in sport advisory. Ha fondato Valore Atteso ispirandosi a Calcio e Finanza e SpiegameloFacile. L'obiettivo è un business editoriale completamente automatizzato tramite agenti AI.

## Il progetto
Newsletter italiana gratuita sul business del calcio europeo. Esce ogni martedì.
- **Formato fisso**: Il Bilancio · Il Deal · La Metrica
- **Target**: professionisti M&A, PE, consulenza, finanza
- **Sito**: valoreatteso.com
- **Email**: info@valoreatteso.com

## Stack tecnico
- **Frontend**: Vercel (hosting) — repo GitHub: `paoloferrara23/valore-atteso`
- **Database**: Supabase — project ID: `xxnmkiwnjpppfzrftvuv`
- **Email**: Resend — sender: `info@valoreatteso.com`
- **AI**: Anthropic API via env var `ANTHROPIC_KEY`
- **Font**: Source Serif 4, DM Sans, JetBrains Mono
- **Colori**: cream `#F4EFE6`, ink `#1C1914`, red `#B5221A`, gold `#C8A97A`

## Env var Vercel
`ANTHROPIC_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `RESEND_KEY`, `APPROVAL_EMAIL`, `CR_PASSWORD`, `GH_TOKEN`, `GOOGLE_DRIVE_API_KEY`, `GOOGLE_DRIVE_FOLDER_ID`, `SITE_URL`

## Struttura repo
```
/api/           → endpoint Vercel (max 12 file JS — piano Hobby)
/lib/           → moduli condivisi richiesti da api/ (NON eliminare senza verificare require() intra-lib)
/scripts/       → agenti GitHub Actions
/.github/workflows/ → schedule agenti
/sql/           → migrazioni schema Supabase (già applicate)
/index.html     → sito principale + Control Room
/archivio.html  → archivio newsletter
/glossario.html → glossario termini
/sponsor.html   → pagina sponsor pubblica
/sponsor-area.html → area riservata sponsor
```

## File API (12/12 — limite raggiunto)
- `ad.js` — Control Room AD (chat con Claude)
- `genera-edizione.js` — genera bozza completa edizione
- `genera-opzioni.js` — genera 3 opzioni per sezione
- `meta-webhook.js` — webhook Meta Lead Ads → Supabase
- `publisher-gate.js` — verifica pre-pubblicazione (dedup temi, KPI, fonti)
- `run-agent.js` — esegui agenti manualmente dalla Control Room
- `send-newsletter.js` — invio newsletter + send-utils (action=utils)
- `send-test.js` — invio email di test
- `sponsor-request.js` — gestione completa funnel sponsor (list/get/approve/delete/upload/ecc.)
- `subscribe.js` — iscrizione con rate limiting
- `trigger-content.js` — triggera Content Agent via GitHub Actions workflow_dispatch
- `unsubscribe.js` — disiscrizione con token sicuro

Le rotte `/api/send-utils`, `/api/list-sponsor-requests`, `/api/approve-sponsor` ecc. sono rewrite in `vercel.json` → puntano a `send-newsletter.js` e `sponsor-request.js`.

## Agenti GitHub Actions
| Agente | Giorno | Orario IT | File |
|--------|--------|-----------|------|
| Scout | Sabato | 08:00 | scripts/scout.js |
| SEO | Domenica | 08:00 | scripts/seo-agent.js |
| Keep Alive | Domenica | 08:00 | (commit vuoto — mantiene repo attivo) |
| Editoriale | Lunedì | 08:00 | scripts/agent.js |
| Deliverability | Martedì | 14:00 | scripts/deliverability-agent.js |
| Growth | Mercoledì | 08:00 | scripts/growth-agent.js |
| Content | Giovedì | 08:00 | scripts/content-agent.js |
| Sponsor Outreach | Venerdì | 07:00 | scripts/sponsor-outreach-agent.js |
| Cost Guardian | Venerdì | 09:00 | scripts/cost-guardian.js |
| Security | Ogni giorno | 10:00 | scripts/security-agent.js |
| Incident Response | Ogni giorno | 09:00 | scripts/incident-response-agent.js |

## Supabase — tabelle principali
- `editions` — edizioni newsletter (num, title, subtitle, date, sections, published)
- `subscribers` — iscritti (email, confirmed, token, unsub_token, created_at)
- `agent_memory` — memoria condivisa agenti (key, value, written_by)
- `agent_runs` — log esecuzioni agenti
- `linkedin_posts` — storico post LinkedIn generati
- `rate_limits` — rate limiting iscrizioni per IP

## Design system email agenti
Tutti gli agenti usano `scripts/email-template.js` — modulo condiviso.
- Header nero `#1A1A1A` con badge stato (verde/giallo/rosso)
- Corpo crema `#F5F2EB`, testo `#1A1A1A`
- Accent verde `#1B4332`, oro `#C8A97A`, rosso `#C8251D`
- Font: Georgia serif per testi, Courier New per label/codici

## Regole operative — INDEROGABILI

1. **Scarica sempre index.html live prima di modificarlo** — mai partire da versioni precedenti
2. **Verifica JS con `node --check`** prima di pushare
3. **Verifica `</body>` presente** — file troncato = deploy rotto
4. **Max 12 file in `api/`** — piano Hobby Vercel. Prima di aggiungere, consolidare
5. **I workflow `.github/workflows/` si possono modificare direttamente** con Claude Code (vantaggio vs chat)
6. **Apostrofi in JS**: usare sempre `\'` o virgolette doppie
7. **CORS headers** su ogni endpoint API
8. **Auth `x-cr-token`** su tutti gli endpoint protetti (non su subscribe/unsubscribe)
9. **Dopo env var Vercel**: sempre redeploy manuale senza cache
10. **Supabase**: `apply_migration` per DDL, `execute_sql` per query
11. **Prima di eliminare file in `lib/`**: cercare i riferimenti anche dentro `lib/` stessa con `grep -rn "nome-file" lib/` — i moduli si importano a vicenda

## Control Room
- Accessibile dal tastino ⚙ in basso a destra sul sito
- Password: `valopro2025` (env var `CR_PASSWORD`)
- Tab: Dashboard · AD · Redazione · Comunicazioni
- L'AD usa il sistema prompt in index.html — mantenerlo aggiornato

## Flusso redazione settimanale
1. **Sabato**: Scout cerca temi → manda email con link selezione
2. **Sabato/Domenica**: Paolo seleziona 1 tema per sezione dalla pagina web
3. **Lunedì 08:00**: Editoriale legge selezione → genera bozza automaticamente → email a Paolo
4. **Lunedì**: Paolo revisiona in Control Room → approva
5. **Martedì**: Paolo invia da dashboard → Deliverability Agent monitora alle 14:00

## Token e credenziali
- GitHub token per push: in env var `GH_TOKEN` su Vercel e secret `GH_PAT` su GitHub
- GitHub token Claude Code: già configurato via connessione repo
- Google Drive: `GOOGLE_DRIVE_API_KEY` + `GOOGLE_DRIVE_FOLDER_ID` (`1hsB1x1FIVekEYXxzLxLm_9elf5ttDPoj`)

## Stato iscritti (aggiornare periodicamente)
- Iscritti confermati: 65 (maggio 2026)
- Obiettivo 3 mesi: 300
- Canali acquisizione: Instagram ads (Lead Gen Form), LinkedIn organico

## Prossimi task prioritari
- [ ] Welcome sequence — 3 email in 7 giorni per nuovi iscritti
- [ ] Integrazione Meta Lead Ads → Supabase via webhook
- [ ] Attivare open/click tracking Resend (DNS `links.valoreatteso.com` su Vercel)
- [ ] LinkedIn Content Agent — usare sistematicamente le bozze 3x/settimana
- [ ] Agente commerciale sponsor (fase 200+ iscritti)
- [ ] Report "Business del Calcio 2025" (fase 300+ iscritti)
