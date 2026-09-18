-- Run this once in the Supabase SQL Editor.
-- Stores each plumber's self-reported materials/receipts total for the current work week,
-- used by the "My pay" take-home estimate. plumber_id is stored as text rather than a typed
-- FK to plumbers(id) to avoid depending on that column's exact type - the app always passes
-- it through as a string.

create table if not exists weekly_pay_entries (
  plumber_id text not null,
  week_start date not null,
  materials numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (plumber_id, week_start)
);

-- Same lockdown pattern as plumbers: no anon/authenticated access at all, only the
-- service role (used by api/paycheck.js) can read or write. This is each plumber's
-- own earnings data - other plumbers should not be able to see it either.
do $$
declare
  pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'weekly_pay_entries'
  loop
    execute format('drop policy if exists %I on public.weekly_pay_entries', pol.policyname);
  end loop;
end $$;

alter table weekly_pay_entries enable row level security;
