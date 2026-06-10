# Sponsor Outreach — Sistema automatico di ricerca sponsor

Ogni giorno alle **07:00 IT** l'agente cerca aziende che sponsorizzano media con pubblico di PMI, imprenditori, manager, finanza e sport business, e prepara bozze email in Gmail. **Non invia mai nulla automaticamente.**

## Pipeline giornaliera

1. **Sponsor Scout** — web search (API Anthropic): trova aziende con prove pubbliche recenti di sponsorizzazioni. Ogni lead ha `evidence_url` obbligatorio.
2. **Company Analyst** — fit score 0–100 rispetto al target Valore Atteso (integrato nello Scout).
3. **Contact Researcher** — cerca un referente Marketing/Brand/Partnership. Solo email professionali **pubblicate esplicitamente** o profili LinkedIn pubblici. Mai email dedotte. Ogni contatto ha `source_url`.
4. **Outreach Writer** — email ≤150 parole, italiana, professionale, basata solo su informazioni pubbliche verificate.
5. **Bozza Gmail** — creata in `info@valoreatteso.com` via Gmail API. L'invio è **sempre manuale da Gmail**.
6. **Reply Classifier** — controlla i thread Gmail delle bozze inviate, classifica le risposte (interested / question / referral / not_interested / unsubscribe / automatic_reply / unclear) e propone una risposta. Non risponde mai da solo.
7. **Digest richieste sito** — notifica via Resend a `APPROVAL_EMAIL` le nuove righe in `sponsor_requests`.

## Limiti e regole

- Max **10 lead/giorno** (`SPONSOR_OUTREACH_DAILY_LIMIT`), max **5 bozze/giorno** (`SPONSOR_OUTREACH_DRAFT_LIMIT`).
- Nessuna bozza se: fit score < 60, fonte mancante, contatto non verificabile, solo LinkedIn (lead salvato con stato `linkedin_only`), già contattato, escluso.
- Dedup per: dominio, evidence URL, email, LinkedIn URL, aziende già in `sponsor_requests`.
- Lock giornaliero: vincolo `UNIQUE(run_date)` su `sponsor_outreach_runs` — una sola esecuzione/giorno.
- Guard anti prompt-injection nei prompt: le istruzioni trovate nelle pagine web vengono ignorate.

## Quando la bozza viene inviata (manualmente da Gmail)

Al run successivo l'agente rileva che la bozza non esiste più → marca l'outreach `sent` e il lead `contacted`, e inizia a monitorare il thread per le risposte.

## Risposta `interested` → funnel esistente

In Control Room → tab **Outreach** appare il bottone **"Avvia funnel sponsor"**: con conferma manuale crea una riga in `sponsor_requests` (stessa tabella del form di sponsor.html, formato "Da definire", origine outreach) e collega `sponsor_request_id`. Da lì la richiesta segue il flusso normale.

## Control Room

Tab **Outreach**: run giornalieri, richieste dal sito (con data richiesta), lead con fit score / confidence / fonti cliccabili / referente / bozza / stato risposta. Filtri per stato, score minimo, email disponibile. Azioni: esegui ricerca ora, visualizza/rigenera bozza, crea bozza Gmail, escludi, segna contattato, classifica risposta, avvia funnel. **Nessun bottone di invio email.**

## Setup — GitHub Secrets richiesti

| Secret | Note |
|---|---|
| `ANTHROPIC_KEY` | già presente |
| `SUPABASE_URL`, `SUPABASE_KEY` | già presenti |
| `RESEND_KEY`, `APPROVAL_EMAIL` | già presenti (solo per il digest) |
| `GOOGLE_CLIENT_ID` | OAuth client Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth client Google Cloud |
| `GOOGLE_REFRESH_TOKEN` | refresh token con scope `gmail.compose` + `gmail.readonly` |
| `GMAIL_SENDER` | `info@valoreatteso.com` |

Variables opzionali (`vars`): `SPONSOR_SCOUT_MODEL`, `SPONSOR_OUTREACH_DAILY_LIMIT`, `SPONSOR_OUTREACH_DRAFT_LIMIT`, `SPONSOR_OUTREACH_SIGNATURE`.

Se le credenziali Google mancano, l'agente funziona comunque: le bozze restano in Supabase con stato `draft`, visibili in Control Room.

## File

- `sql/sponsor_outreach.sql` — schema (già applicato a Supabase)
- `scripts/sponsor-outreach-agent.js` — agente principale
- `scripts/gmail.js` — helper Gmail (solo bozze e lettura thread, nessuna funzione di invio)
- `scripts/test-sponsor-outreach.js` — test offline: `node scripts/test-sponsor-outreach.js`
- `.github/workflows/sponsor-outreach.yml` — schedule giornaliero + dispatch manuale

## Test manuale senza invii

```
GitHub → Actions → "Sponsor Outreach Agent" → Run workflow
```
Crea solo bozze. Verifica poi in Gmail → Bozze e in Control Room → Outreach.
