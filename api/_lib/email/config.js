// api/_lib/email/config.js — Configurazione fissa del template email (uguale per ogni edizione).
// Micro-testi di brand, dati legali, URL, UTM ammessi, merge tag e nomi di stampa vietati.
// Nel JSON di edizione non va niente di tutto questo.

module.exports = {
  // www: il dominio senza www risponde con un redirect 307.
  site: 'https://www.valoreatteso.com',

  // Immagini: in "send"/"test" URL assoluti su valoreatteso.com; in "preview" percorsi locali.
  logos: {
    monogram: { file: 'va-monogramma-crema@2x.png', width: 64, height: 44 },
    lockup: { file: 'va-orizzontale-crema-su-ink@2x.png', width: 180, height: 60 },
    baseUrl: 'https://www.valoreatteso.com/email/brand/',
  },

  // Dati legali del footer. Indirizzo opzionale: mostrato solo se compilato (env LEGAL_OWNER_ADDRESS).
  legal: {
    owner: 'Valore Atteso',
    ownerAddress: process.env.LEGAL_OWNER_ADDRESS || '',
    privacyPath: '/privacy',
    contact: 'info@valoreatteso.com',
  },

  // Merge tag della pipeline: send-newsletter e send-test sostituiscono {{EMAIL}} con
  // l'indirizzo del destinatario (URL-encoded), uno per ogni mail. È il link di
  // disiscrizione per-destinatario: non è mai un indirizzo fisso. I tag delle campagne
  // Brevo ({{ unsubscribe }}, {{ update_profile }}) non funzionano con l'invio transazionale.
  mergeTags: ['{{EMAIL}}'],
  unsubscribePath: '/cancella?email={{EMAIL}}',
  preferencesHref: 'mailto:info@valoreatteso.com?subject=Preferenze%20newsletter%20Valore%20Atteso',

  // utm_content ammessi sui link a valoreatteso.com.
  utmBlocks: ['testata_logo', 'inoltrata_iscriviti', 'footer_logo', 'footer_leggi_online', 'footer_archivio'],

  // Nomi di stampa, agenzie e social: vietati in ogni testo (avviso in preview/test, errore in send).
  blockedNames: [
    'ESPN', 'Sky Sport', 'Sky Sports', 'Reuters', 'Forbes', 'Inside World Football', 'The Stadium Business',
    'Bloomberg', 'Financial Times', 'The Athletic', 'BBC', 'Calcio e Finanza', 'Transfermarkt', 'Gazzetta dello Sport',
    'Corriere dello Sport', 'Tuttosport', 'The Times', 'Irish Times', 'Guardian', 'CNBC',
    'Instagram', 'Twitter', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube',
  ],

  sectionLabels: ['Il Bilancio', 'Il Deal', 'La Metrica'],
  moduleTypes: ['bars', 'deal', 'vs', 'none'],

  // Micro-testi fissi (mock A2, footer opzione 1, prompt definitivo).
  copy: {
    kicker: 'Questa settimana',
    summaryTitle: 'In sintesi · 3 numeri',
    readMore: 'Leggi ↓',
    reading: '— La nostra lettura',
    watchTitle: 'Cosa guardare nelle prossime settimane',
    shareHeadline: e => `Un collega lavora su un club? Inoltragli il #${e}.`,
    shareSubline: 'Il modo più semplice per far crescere Valore Atteso è passarlo a chi lavora sui numeri.',
    shareText: "Ti condivido l'ultima edizione di Valore Atteso, newsletter sul business del calcio europeo.",
    shareWhatsapp: 'Inoltra su WhatsApp →',
    shareEmail: 'Inoltra via email →',
    forwarded: "Te l'hanno inoltrata?",
    signup: 'Iscriviti gratis →',
    motto: 'Il calcio dei numeri, non dei goal.',
    tagline: 'Il calcio dei numeri, non dei goal. Ogni martedì, in 8 minuti.',
    linkOnline: 'Leggi online →',
    linkArchive: 'Archivio →',
    linkPreferences: 'Preferenze →',
    contact: 'Un dato da correggere? Scrivi a',
    legalData: 'Dati tratti da documenti ufficiali di club e organismi competenti.',
    legalAi: "Contenuti prodotti con l'assistenza di sistemi di intelligenza artificiale, sotto supervisione e responsabilità editoriale umana. Analisi a scopo informativo: non costituisce consulenza finanziaria né sollecitazione all'investimento.",
    legalOwner: 'Titolare del trattamento:',
    privacy: 'Informativa privacy:',
    contactLabel: 'Contatto:',
    unsubscribeLead: 'Non ti serve più?',
    unsubscribe: 'Cancella iscrizione',
    sponsorLead: 'Presentato da',
  },

  limits: { warnKB: 75, maxKB: 90 },
};
