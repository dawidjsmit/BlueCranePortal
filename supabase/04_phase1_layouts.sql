-- ============================================================
--  Blue Crane Vistas Portal — Phase 1 migration
--  Unit Layouts + link layouts to Units.
--
--  Run AFTER 01_schema.sql / 02_policies.sql (idempotent-ish:
--  safe to run once on an existing project).
-- ============================================================

-- ---------- unit_layouts ----------
-- The ~5 house layouts in the complex. drawing_path is reserved for
-- Phase 4 (Supabase Storage) — left null for now.
create table if not exists unit_layouts (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,          -- e.g. "A", "TYPE-2B"
  description  text,
  drawing_path text,                           -- storage path (Phase 4)
  created_at   timestamptz not null default now()
);

-- ---------- units.layout_id ----------
alter table units
  add column if not exists layout_id uuid references unit_layouts(id) on delete set null;

create index if not exists idx_units_layout on units(layout_id);

-- ---------- RLS ----------
alter table unit_layouts enable row level security;

-- Any approved, signed-in user can read layouts (needed to show a
-- unit's layout). Only trustees can create / change / delete them.
drop policy if exists "read layouts" on unit_layouts;
create policy "read layouts"
  on unit_layouts for select
  using ( auth.uid() is not null );

drop policy if exists "trustee writes layouts" on unit_layouts;
create policy "trustee writes layouts"
  on unit_layouts for all
  using ( is_trustee() )
  with check ( is_trustee() );

-- ---------- Optional: a few starter layouts ----------
-- Comment out if you'd rather add them in the app.
insert into unit_layouts (code, description) values
  ('A', '2 bedroom, 1 bathroom, single garage'),
  ('B', '3 bedroom, 2 bathroom, double garage'),
  ('C', '3 bedroom, 2 bathroom, double garage + study'),
  ('D', '1 bedroom cottage'),
  ('E', '4 bedroom, 3 bathroom, double garage + pool')
on conflict (code) do nothing;
