alter table public.sponsor_requests add column if not exists edition_id uuid;
alter table public.sponsor_requests add column if not exists preview_status text not null default 'not_sent';
alter table public.sponsor_requests add column if not exists preview_sent_at timestamptz;
alter table public.sponsor_requests add column if not exists preview_approved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sponsor_requests_edition_id_fkey'
  ) then
    alter table public.sponsor_requests
      add constraint sponsor_requests_edition_id_fkey
      foreign key (edition_id)
      references public.editions(id)
      on delete set null;
  end if;
end $$;

create index if not exists sponsor_requests_edition_id_idx
  on public.sponsor_requests(edition_id);

create index if not exists sponsor_requests_preview_status_idx
  on public.sponsor_requests(preview_status);
