alter table public.sponsor_requests add column if not exists slot_type text;
alter table public.sponsor_requests add column if not exists selected_slot_id uuid;
alter table public.sponsor_requests add column if not exists materials_status text not null default 'pending';
alter table public.sponsor_requests add column if not exists materials_approved_at timestamptz;
alter table public.sponsor_requests add column if not exists payment_status text not null default 'not_requested';

alter table public.sponsor_slots add column if not exists amount numeric(12, 2);

update public.sponsor_slots
set amount = case
  when slot_type = 'main' then 500
  when slot_type = 'secondary' then 250
  else amount
end
where amount is null;

create unique index if not exists sponsor_slots_date_type_uidx
  on public.sponsor_slots(slot_date, slot_type);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sponsor_requests_selected_slot_id_fkey'
  ) then
    alter table public.sponsor_requests
      add constraint sponsor_requests_selected_slot_id_fkey
      foreign key (selected_slot_id)
      references public.sponsor_slots(id)
      on delete set null;
  end if;
end $$;

insert into public.sponsor_slots (slot_date, slot_type, amount, status)
select available_date::date, slot_type, amount, 'available'
from (
  select day_value as available_date
  from generate_series(current_date + 1, current_date + 70, interval '1 day') day_value
  where extract(isodow from day_value) = 2
  order by day_value
  limit 8
) dates
cross join (
  values
    ('main'::text, 500::numeric),
    ('secondary'::text, 250::numeric)
) types(slot_type, amount)
on conflict (slot_date, slot_type) do nothing;

create index if not exists sponsor_requests_selected_slot_idx
  on public.sponsor_requests(selected_slot_id);

create index if not exists sponsor_requests_payment_status_idx
  on public.sponsor_requests(payment_status);

create index if not exists sponsor_requests_materials_status_idx
  on public.sponsor_requests(materials_status);
