// api/_lib/email/config.js — Configurazione fissa del template email (uguale per ogni edizione).
// Qui stanno micro-testi di brand, dati legali, URL base, UTM ammessi, merge tag
// e liste di blocco delle fonti. Nel JSON di edizione non va niente di tutto questo.

module.exports = {
  site: 'https://valoreatteso.com',

  // Immagini: in "send" src assoluti su dominio VA; in "preview" percorsi locali.
  logos: {
    monogram: { file: 'va-monogramma-crema@2x.png', width: 64, height: 44 },
    lockup: { file: 'va-orizzontale-crema-su-ink@2x.png', width: 180, height: 60 },
    baseUrl: 'https://valoreatteso.com/email/brand/',
  },

  // Dati legali: restano placeholder finché Paolo non li fornisce (bloccano "send").
  legal: {
    titolare: '[[TITOLARE]]',
    indirizzo: '[[INDIRIZZO]]',
    privacyPath: '/privacy',
  },

  // Merge tag della pipeline: send-newsletter sostituisce {{EMAIL}} con l'indirizzo
  // del destinatario URL-encoded (link di disiscrizione). {{EMAIL_TEXT}} è nuovo:
  // l'indirizzo in chiaro, HTML-escaped, nella riga legale (va aggiunto alla
  // sostituzione in send-newsletter, con replaceAll). Non usiamo i tag delle campagne
  // Brevo ({{ unsubscribe }}, {{ mirror }}...): con l'invio transazionale non funzionano.
  mergeTags: ['{{EMAIL}}', '{{EMAIL_TEXT}}'],
  unsubscribeUrl: 'https://www.valoreatteso.com/cancella?email={{EMAIL}}',

  // utm_content ammessi sui link a valoreatteso.com.
  utmBlocks: ['testata_logo', 'inoltrata_iscriviti', 'footer_logo', 'footer_leggi_online', 'footer_archivio', 'footer_fonti'],

  // Fonti: solo club, comunicati ufficiali e report pubblici. Stampa e social bloccati
  // (avviso in preview, errore in send). Domini: si blocca anche ogni sottodominio.
  blockedDomains: [
    'espn.com', 'espn.co.uk', 'espn.in', 'skysports.com', 'sky.it', 'sport.sky.it', 'skysport.it', 'reuters.com',
    'forbes.com', 'insideworldfootball.com', 'thestadiumbusiness.com',
    'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'youtube.com', 'threads.net',
  ],
  blockedNames: ['ESPN', 'Sky Sport', 'Sky Sports', 'Reuters', 'Forbes', 'Inside World Football', 'The Stadium Business'],

  sectionLabels: ['Il Bilancio', 'Il Deal', 'La Metrica'],
  moduleTypes: ['bars', 'deal', 'vs', 'none'],

  // Micro-testi fissi del template (mock A2 e footer opzione 1, già scelti da Paolo).
  copy: {
    kicker: 'Questa settimana',
    summaryTitle: 'In sintesi · 3 numeri',
    readMore: 'Leggi ↓',
    reading: '— La nostra lettura',
    sources: 'Fonti',
    watchTitle: 'Cosa guardare nelle prossime settimane',
    shareWhatsapp: 'Inoltra su WhatsApp →',
    shareEmail: 'Inoltra via email →',
    forwarded: "Te l'hanno inoltrata?",
    signup: 'Iscriviti gratis →',
    motto: 'Il calcio dei numeri, non dei goal.',
    tagline: 'Il calcio dei numeri, non dei goal. Ogni martedì, in 8 minuti.',
    linkOnline: 'Leggi online →',
    linkArchive: 'Archivio →',
    linkSources: 'Fonti verificabili →',
    contact: 'Un dato da correggere o una segnalazione? Scrivi a',
    contactEmail: 'info@valoreatteso.com',
    legalReceived: "Ricevi questa email perché ti sei iscritto a Valore Atteso con l'indirizzo",
    legalAi: "Contenuti prodotti con l'assistenza di sistemi di intelligenza artificiale, sotto supervisione e responsabilità editoriale umana. Le fonti sono linkate in fondo a ogni sezione. Analisi a scopo informativo: non costituisce consulenza finanziaria né sollecitazione all'investimento.",
    legalOwner: 'Titolare del trattamento:',
    privacy: 'Informativa privacy',
    unsubscribeLead: 'Non ti serve più?',
    unsubscribe: 'Disiscriviti con un clic',
    sponsorLead: 'Presentato da',
  },

  limits: { warnKB: 75, maxKB: 85 },
};
