-- sql/ai_usage.sql — log del consumo token Anthropic per agente (costo reale)
-- Applicata via Supabase il 2026-06-25. Alimentata da lib/ai-usage.js (logUsage),
-- letta da scripts/cost-guardian.js per il dettaglio costi per agente.

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  model text,
  input_tokens integer default 0,
  output_tokens integer default 0,
  cost_eur numeric default 0,
  created_at timestamptz default now()
);

create index if not exists ai_usage_created_idx on ai_usage(created_at);
create index if not exists ai_usage_agent_idx on ai_usage(agent);

alter table ai_usage enable row level security;
drop policy if exists "public read ai_usage" on ai_usage;
create policy "public read ai_usage" on ai_usage for select using (true);
-- la scrittura avviene con la SERVICE key (bypassa RLS); nessuna policy di insert pubblica.
