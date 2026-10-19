-- Step 7: lock the nine open tables and remove anonymous photo uploads.
--
-- Before this, anyone holding the public (anon) key could read AND change every row in these nine
-- tables, and upload photos. The key is public by design (it was embedded in the web page and sits in
-- the repo's history), so it must not be trusted with anything. Row-level security ON with NO policies
-- means "nobody using the public key can touch these". The app is unaffected: since Steps 2-4 every
-- read and write goes through the server using the service-role key, which bypasses row-level security.
--
-- UNDO (only if something unexpectedly breaks; run in the SQL Editor):
--   alter table public.conversations        disable row level security;
--   alter table public.shop_updates         disable row level security;
--   alter table public.shop_tools           disable row level security;
--   alter table public.training_tips        disable row level security;
--   alter table public.quiz_questions       disable row level security;
--   alter table public.quiz_results         disable row level security;
--   alter table public.vehicles             disable row level security;
--   alter table public.vehicle_service_log  disable row level security;
--   alter table public.vehicle_issues       disable row level security;
--   create policy "Anon can upload chat images" on storage.objects for insert to anon with check (bucket_id = 'chat-images');
--   create policy "Anon upload chat images"     on storage.objects for insert to anon with check (bucket_id = 'chat-images');

alter table public.conversations        enable row level security;
alter table public.shop_updates         enable row level security;
alter table public.shop_tools           enable row level security;
alter table public.training_tips        enable row level security;
alter table public.quiz_questions       enable row level security;
alter table public.quiz_results         enable row level security;
alter table public.vehicles             enable row level security;
alter table public.vehicle_service_log  enable row level security;
alter table public.vehicle_issues       enable row level security;

-- Photos are now uploaded by the server (api/crew.js), never straight from the browser, so both
-- anonymous upload permissions (one is a duplicate) can go. The anonymous READ policy is kept for now
-- so existing photo links keep opening; see docs/CHANGELOG.md for the follow-up on listing.
drop policy if exists "Anon can upload chat images" on storage.objects;
drop policy if exists "Anon upload chat images" on storage.objects;
