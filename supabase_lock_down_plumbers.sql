-- Run this once in the Supabase SQL Editor.
-- Locks down the `plumbers` table so PINs (and everything else in it) are no longer
-- readable by anyone with the app's public anon key - only the server-side
-- api/login.js function (using the service role key, which bypasses RLS) can read it.

-- Remove any existing policies on this table, whatever they're named
-- (a permissive "allow all" policy is the Supabase default when a table is created
-- via the dashboard's table editor, which is almost certainly what's happening here).
do $$
declare
  pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'plumbers'
  loop
    execute format('drop policy if exists %I on public.plumbers', pol.policyname);
  end loop;
end $$;

-- Enable RLS with zero policies left = default-deny for anon/authenticated.
-- The service role (used only by api/login.js) always bypasses RLS regardless.
alter table plumbers enable row level security;
