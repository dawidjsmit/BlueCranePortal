-- ============================================================
--  Blue Crane Vistas Portal — Storage setup the EASY way
--  (replaces the fiddly "policy screen" clicking)
--
--  Just paste this whole file into the Supabase SQL Editor and Run.
--  It creates the "photos" bucket (public) AND the three access
--  policies in one go.
--
--  Safe to run more than once.
-- ============================================================

-- 1) Create the public "photos" bucket (if it doesn't exist yet).
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

-- 2) Policies on storage.objects for this bucket.

-- Anyone may READ files in the photos bucket (so images display).
drop policy if exists "bcv photos public read" on storage.objects;
create policy "bcv photos public read"
  on storage.objects for select
  using ( bucket_id = 'photos' );

-- Signed-in users may UPLOAD into the photos bucket.
drop policy if exists "bcv photos auth upload" on storage.objects;
create policy "bcv photos auth upload"
  on storage.objects for insert
  with check ( bucket_id = 'photos' and auth.role() = 'authenticated' );

-- Signed-in users may DELETE from the photos bucket.
drop policy if exists "bcv photos auth delete" on storage.objects;
create policy "bcv photos auth delete"
  on storage.objects for delete
  using ( bucket_id = 'photos' and auth.role() = 'authenticated' );
