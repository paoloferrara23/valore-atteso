alter table public.sponsor_requests
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists publication_authorized_at timestamptz;

create table if not exists public.sponsor_acceptances (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sponsor_requests(id) on delete cascade,
  acceptance_type text not null check (acceptance_type in ('terms', 'publication')),
  document_version text not null,
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  evidence jsonb not null default '{}'::jsonb
);

create index if not exists sponsor_acceptances_request_id_idx
  on public.sponsor_acceptances(request_id);

create index if not exists sponsor_acceptances_type_idx
  on public.sponsor_acceptances(acceptance_type, accepted_at desc);

alter table public.sponsor_acceptances enable row level security;
revoke all on public.sponsor_acceptances from anon, authenticated;
grant select, insert, update, delete on public.sponsor_acceptances to service_role;

update public.sponsor_requests
set preview_status = 'sent',
    preview_approved_at = null
where preview_status = 'approved'
  and publication_authorized_at is null;
