create extension if not exists pgcrypto;

create table if not exists public.sponsor_requests (
  id uuid primary key default gen_random_uuid(),
  name text,
  company text not null,
  contact_name text,
  email text not null,
  format text not null,
  notes text,
  status text not null default 'new',
  token text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  scheduled_date date,
  amount numeric(12, 2)
);

alter table public.sponsor_requests add column if not exists name text;
alter table public.sponsor_requests add column if not exists contact_name text;
alter table public.sponsor_requests add column if not exists status text default 'new';
alter table public.sponsor_requests add column if not exists token text;
alter table public.sponsor_requests add column if not exists approved_at timestamptz;
alter table public.sponsor_requests add column if not exists paid_at timestamptz;
alter table public.sponsor_requests add column if not exists scheduled_date date;
alter table public.sponsor_requests add column if not exists requested_date date;
alter table public.sponsor_requests add column if not exists amount numeric(12, 2);

update public.sponsor_requests
set contact_name = coalesce(contact_name, name, 'Contatto sponsor'),
    name = coalesce(name, contact_name, 'Contatto sponsor'),
    status = coalesce(status, 'new'),
    created_at = coalesce(created_at, now()),
    scheduled_date = coalesce(scheduled_date, requested_date)
where contact_name is null
   or name is null
   or status is null
   or created_at is null
   or scheduled_date is null;

alter table public.sponsor_requests alter column contact_name set not null;
alter table public.sponsor_requests alter column status set default 'new';
alter table public.sponsor_requests alter column status set not null;
alter table public.sponsor_requests alter column created_at set default now();
alter table public.sponsor_requests alter column created_at set not null;

create unique index if not exists sponsor_requests_token_uidx
  on public.sponsor_requests(token)
  where token is not null;

create table if not exists public.sponsor_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  slot_type text not null,
  status text not null default 'available',
  request_id uuid references public.sponsor_requests(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sponsor_assets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.sponsor_requests(id) on delete cascade,
  logo_url text not null,
  headline text not null,
  body text not null,
  cta_url text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists sponsor_requests_status_idx
  on public.sponsor_requests(status);

create index if not exists sponsor_slots_date_status_idx
  on public.sponsor_slots(slot_date, status);

create index if not exists sponsor_slots_request_id_idx
  on public.sponsor_slots(request_id);

alter table public.sponsor_requests enable row level security;
alter table public.sponsor_slots enable row level security;
alter table public.sponsor_assets enable row level security;

revoke all on public.sponsor_requests from anon, authenticated;
revoke all on public.sponsor_slots from anon, authenticated;
revoke all on public.sponsor_assets from anon, authenticated;

drop policy if exists "anon insert" on public.sponsor_requests;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sponsor-assets',
  'sponsor-assets',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Nessuna policy pubblica sul bucket: gli upload passano esclusivamente
-- dagli endpoint Vercel autenticati con la secret key Supabase.
