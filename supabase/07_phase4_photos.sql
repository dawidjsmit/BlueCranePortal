-- ============================================================
--  Blue Crane Vistas Portal — Phase 4 migration
--  Photos: unit photos (many), pet photos (one), layout drawings (one).
--
--  Files live in Supabase STORAGE (bucket "photos"); the DB stores the
--  file PATHS. See SETUP.md "Step 6 — Storage" for creating the bucket
--  and its access policies (that part is done in the dashboard).
--
--  Run AFTER 06_phase3_occupants_pets.sql.
-- ============================================================

-- ---------- unit_photos ----------
-- A unit can have 0+ photos (of the unit and its exclusive-use area).
create table if not exists unit_photos (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  storage_path text not null,                 -- path within the "photos" bucket
  caption     text,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_unit_photos_unit on unit_photos(unit_id);

-- pets.photo_path and unit_layouts.drawing_path already exist from
-- earlier migrations (reserved). Nothing to add there.

-- ---------- Helper: is the current user an owner of this unit? ----------
-- Used so owners can manage their own unit's photos.
create or replace function is_unit_owner(target_unit uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from owners o
    where o.unit_id = target_unit
      and o.profile_id = auth.uid()
      and o.active
  ) or exists (
    -- also allow via unit_members marked as owner (belt and braces)
    select 1 from unit_members m
    where m.unit_id = target_unit
      and m.profile_id = auth.uid()
      and m.relation = 'owner'
  );
$$;

-- ---------- RLS on unit_photos ----------
alter table unit_photos enable row level security;

-- Read: trustees + anyone who is a member of the unit.
drop policy if exists "read unit photos" on unit_photos;
create policy "read unit photos" on unit_photos for select
  using ( is_trustee() or is_unit_member(unit_id) );

-- Insert: trustees, or an owner of that unit.
drop policy if exists "add unit photos" on unit_photos;
create policy "add unit photos" on unit_photos for insert
  with check ( is_trustee() or is_unit_owner(unit_id) );

-- Delete: trustees, or an owner of that unit.
drop policy if exists "delete unit photos" on unit_photos;
create policy "delete unit photos" on unit_photos for delete
  using ( is_trustee() or is_unit_owner(unit_id) );
