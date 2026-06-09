create extension if not exists pgcrypto;

create table if not exists public.sponsor_requests (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  contact_name text not null,
  email text not null,
  format text not null,
  notes text,
  status text not null default 'new',
  token text unique,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  scheduled_date date,
  amount numeric(12, 2)
);

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

alter table public.sponsor_requests enable row level security;
alter table public.sponsor_slots enable row level security;
alter table public.sponsor_assets enable row level security;

revoke all on public.sponsor_requests from anon, authenticated;
revoke all on public.sponsor_slots from anon, authenticated;
revoke all on public.sponsor_assets from anon, authenticated;

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
