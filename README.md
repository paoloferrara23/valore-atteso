# Valore Atteso

## Funnel sponsor - Fase 2

Il funnel sponsor salva richieste e materiali in Supabase. Tutte le email sponsor
passano dalla Gmail API di Google Workspace; Resend resta riservato ai flussi
newsletter.

### Deploy

1. Eseguire `sql/sponsor_funnel.sql` nel SQL Editor del progetto Supabase.
2. Verificare che il bucket privato `sponsor-assets` sia presente.
3. Configurare le variabili Vercel per Production e Preview.
4. Pubblicare il progetto.

### Variabili Vercel

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (consigliata) oppure `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GMAIL_SENDER` (casella Google Workspace autorizzata, per esempio `info@valoreatteso.com`)
- `SPONSOR_ADMIN_SECRET`

Il refresh token Google deve includere lo scope
`https://www.googleapis.com/auth/gmail.send`.

### Approvazione manuale

Nessuna email viene inviata allo sponsor alla creazione della richiesta.
L'approvazione è una chiamata server-side protetta:

```bash
curl -X POST https://valoreatteso.com/api/approve-sponsor \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $SPONSOR_ADMIN_SECRET" \
  -d '{"request_id":"UUID"}'
```

Solo questa chiamata imposta `status = approved` e invia allo sponsor il link
privato per caricare i materiali.

### Storage

I logo sono salvati nel bucket privato:

```text
sponsor-assets/{request_id}/logo-{timestamp}.{ext}
```

Nel database `sponsor_assets.logo_url` contiene il path interno, non un URL
pubblico.

### Control Room

La tab sponsor completa non fa parte di questa fase. Il prossimo step può
aggiungere una vista minimale protetta con elenco richieste, stato e bottone
Approva che chiama `/api/approve-sponsor`. Non sono previsti agenti AI,
pagamenti automatici o pubblicazioni automatiche.
