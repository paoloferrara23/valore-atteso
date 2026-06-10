# Valore Atteso

## Funnel sponsor - Fase 3

Il funnel sponsor salva richieste, slot e materiali in Supabase. Tutte le
email sponsor passano dalla Gmail API di Google Workspace; Resend resta
riservato ai flussi newsletter.

### Deploy

1. Eseguire `sql/sponsor_funnel.sql`, `sql/sponsor_phase_3.sql` e
   `sql/sponsor_editorial_preview.sql`.
2. Verificare che il bucket privato `sponsor-assets` sia presente.
3. Configurare le variabili Vercel per Production e Preview.
4. Pubblicare il progetto.

### Variabili Vercel

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` oppure `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GMAIL_SENDER`
- `SPONSOR_ADMIN_SECRET`

Il refresh token Google deve includere lo scope
`https://www.googleapis.com/auth/gmail.send`.

### Flusso operativo

1. approvazione manuale della richiesta;
2. scelta tra Main slot (EUR 500) e Slot secondario (EUR 250);
3. selezione di uno dei prossimi 8 martedi disponibili;
4. invio separato delle istruzioni di bonifico;
5. conferma manuale del pagamento dalla Control Room;
6. sblocco del caricamento materiali;
7. approvazione o richiesta modifiche;
8. programmazione manuale dell'uscita.
9. associazione dello sponsor a una bozza o edizione;
10. invio della preview privata al cliente;
11. approvazione della preview da parte del cliente;
12. inserimento automatico del blocco sponsor durante il test e l'invio newsletter.

### Accettazioni legali

Prima della selezione dello slot, lo sponsor deve:

- accettare le Condizioni di sponsorizzazione;
- garantire diritti e liceita dei materiali;
- dichiarare di aver letto la Privacy Policy;
- approvare specificamente controllo editoriale, rinvio/cancellazione,
  limitazione di responsabilita e controversie.

Prima della pubblicazione deve inoltre approvare la preview e autorizzarne
espressamente la pubblicazione. Le accettazioni sono registrate nella tabella
`sponsor_acceptances` con versione del documento, timestamp, IP, user-agent ed
evidenze. Il Publisher Gate blocca l'invio se mancano.

Nessuna email viene inviata allo sponsor prima dell'approvazione manuale.
Coordinate bancarie e causale non sono esposte nelle pagine pubbliche o
private.

### Storage

I logo sono salvati nel bucket privato:

```text
sponsor-assets/{request_id}/logo-{timestamp}.{ext}
```

Nel database `sponsor_assets.logo_url` contiene il path interno. La Control
Room riceve un URL firmato temporaneo generato server-side.

### Control Room

La tab Sponsor mostra richiesta, slot, data, importo, pagamento e materiali.
Da qui si approva la richiesta, si registra manualmente il pagamento, si
approvano o respingono i materiali, si associa l'edizione, si invia la
preview e si programma l'uscita. Il pulsante Elimina cancella richiesta e
materiali e libera lo slot dopo una doppia conferma.

Il Publisher Gate blocca l'invio se uno sponsor associato non ha pagamento,
materiali e preview approvati. Il blocco viene inserito automaticamente nel
rendering dell'email e dell'archivio. L'invio della newsletter resta manuale.

Non sono ancora attivi pagamento automatico o riscrittura AI in due versioni.
