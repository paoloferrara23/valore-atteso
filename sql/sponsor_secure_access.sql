alter table public.sponsor_requests
  add column if not exists token_expires_at timestamptz,
  add column if not exists token_used_at timestamptz;

create table if not exists public.sponsor_sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sponsor_requests(id) on delete cascade,
  session_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists sponsor_sessions_request_id_idx
  on public.sponsor_sessions(request_id);

create index if not exists sponsor_sessions_expires_at_idx
  on public.sponsor_sessions(expires_at);

alter table public.sponsor_sessions enable row level security;
revoke all on public.sponsor_sessions from anon, authenticated;
grant select, insert, update, delete on public.sponsor_sessions to service_role;

update public.sponsor_requests
set token = null,
    token_expires_at = null,
    token_used_at = null
where token is not null;
