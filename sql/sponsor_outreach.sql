-- sql/sponsor_outreach.sql — Sistema outreach sponsor automatico
-- Tabelle accessibili in scrittura solo server-side (service key).
-- La Control Room (anon key) può leggere e aggiornare solo campi di stato.

-- ── LEADS ──
CREATE TABLE IF NOT EXISTS sponsor_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company text NOT NULL,
  website text,
  domain text UNIQUE,
  sector text,
  country text,
  company_size text,
  sponsorship_evidence text,
  evidence_url text,
  evidence_source text,
  evidence_date date,
  fit_reason text,
  fit_score integer CHECK (fit_score BETWEEN 0 AND 100),
  confidence text CHECK (confidence IN ('high','medium','low')),
  status text NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','linkedin_only','drafted','contacted','replied','excluded','converted')),
  excluded_reason text,
  discovered_at timestamptz DEFAULT now(),
  last_checked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sponsor_leads_status ON sponsor_leads(status);
CREATE INDEX IF NOT EXISTS idx_sponsor_leads_score ON sponsor_leads(fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_sponsor_leads_discovered ON sponsor_leads(discovered_at DESC);

-- ── CONTACTS ──
CREATE TABLE IF NOT EXISTS sponsor_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES sponsor_leads(id) ON DELETE CASCADE,
  full_name text,
  role text,
  public_email text,
  linkedin_url text,
  profile_summary text,
  source_url text NOT NULL,
  verification_status text DEFAULT 'unverified'
    CHECK (verification_status IN ('verified','unverified','invalid')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sponsor_contacts_lead ON sponsor_contacts(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_contacts_email ON sponsor_contacts(public_email) WHERE public_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_contacts_linkedin ON sponsor_contacts(linkedin_url) WHERE linkedin_url IS NOT NULL;

-- ── OUTREACH ──
CREATE TABLE IF NOT EXISTS sponsor_outreach (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES sponsor_leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES sponsor_contacts(id) ON DELETE SET NULL,
  subject text,
  email_body text,
  personalization_notes text,
  source_summary text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','draft_requested','gmail_created','sent','replied','closed','regenerate')),
  gmail_draft_id text,
  gmail_thread_id text,
  approved_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  reply_classification text
    CHECK (reply_classification IN ('interested','question','referral','not_interested','unsubscribe','automatic_reply','unclear')),
  reply_summary text,
  proposed_reply text,
  sponsor_request_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sponsor_outreach_lead ON sponsor_outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_outreach_status ON sponsor_outreach(status);

-- ── RUNS (lock giornaliero) ──
CREATE TABLE IF NOT EXISTS sponsor_outreach_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date date NOT NULL UNIQUE,
  trigger_type text CHECK (trigger_type IN ('scheduled','manual')),
  status text DEFAULT 'running' CHECK (status IN ('running','success','partial','error')),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  leads_found integer DEFAULT 0,
  drafts_created integer DEFAULT 0,
  errors jsonb
);

-- ── RLS ──
ALTER TABLE sponsor_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_outreach_runs ENABLE ROW LEVEL SECURITY;

-- Control Room e agente GitHub Actions usano la stessa SUPABASE_KEY (anon),
-- come gli altri agenti del progetto: lettura, inserimento e aggiornamento stato.
CREATE POLICY "anon read leads" ON sponsor_leads FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert leads" ON sponsor_leads FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update leads" ON sponsor_leads FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon read contacts" ON sponsor_contacts FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert contacts" ON sponsor_contacts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update contacts" ON sponsor_contacts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon read outreach" ON sponsor_outreach FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert outreach" ON sponsor_outreach FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update outreach" ON sponsor_outreach FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon read runs" ON sponsor_outreach_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert runs" ON sponsor_outreach_runs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon update runs" ON sponsor_outreach_runs FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── ESCLUSIONI MANUALI ──
-- Il bottone "Escludi" in Control Room elimina il lead (cascade) e salva
-- qui il dominio, così lo Scout non lo ripropone nei run successivi.
CREATE TABLE IF NOT EXISTS sponsor_excluded_domains (
  domain text PRIMARY KEY,
  company text,
  reason text,
  excluded_at timestamptz DEFAULT now()
);
ALTER TABLE sponsor_excluded_domains ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON sponsor_excluded_domains TO anon;
CREATE POLICY "anon read excluded" ON sponsor_excluded_domains FOR SELECT TO anon USING (true);
CREATE POLICY "anon insert excluded" ON sponsor_excluded_domains FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon delete leads" ON sponsor_leads FOR DELETE TO anon USING (true);

-- ── DATI DI ESEMPIO (decommentare per test) ──
-- INSERT INTO sponsor_leads (company, website, domain, sector, sponsorship_evidence, evidence_url, evidence_source, fit_reason, fit_score, confidence, status)
-- VALUES ('Esempio FinTech SpA', 'https://esempio-fintech.example', 'esempio-fintech.example', 'fintech',
--   'Sponsor del podcast Il Mio Business — episodio del 12/05/2026', 'https://example.com/podcast-ep42',
--   'pagina pubblica podcast', 'Target PMI e imprenditori coincide con audience VA', 78, 'high', 'discovered');
