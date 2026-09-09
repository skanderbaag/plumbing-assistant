-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query > Run).
-- It sets up photo storage for the chat assistant so images persist in chat history.

-- 1. Add a column to store the photo's URL alongside each chat message
alter table conversations add column if not exists image_url text;

-- 2. Create a public storage bucket for chat photos
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

-- 3. Allow the app (using its public anon key) to upload photos to this bucket
drop policy if exists "Anon can upload chat images" on storage.objects;
create policy "Anon can upload chat images"
on storage.objects for insert
to anon
with check (bucket_id = 'chat-images');

-- 4. Allow anyone with the link to view a chat photo (bucket is public, this makes it explicit)
drop policy if exists "Anon can read chat images" on storage.objects;
create policy "Anon can read chat images"
on storage.objects for select
to anon
using (bucket_id = 'chat-images');
