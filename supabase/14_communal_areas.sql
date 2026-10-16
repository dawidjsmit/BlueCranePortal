-- ============================================================
--  Blue Crane Vistas Portal — Communal Areas (PR 1 of 2)
--
--  A maintainable entity like Units: communal areas of the complex
--  (roads, gates, grass, flower beds, lamp poles, ...), each with a
--  type (its own managed list), code, name, description, and 0+ photos.
--  Trustees maintain everything; all signed-in users can read.
--
--  (PR 2 will let tickets reference a communal area instead of a unit.)
--
--  Run AFTER 13_conduct_rules.sql.
-- ============================================================

-- ---------- communal_area_types (managed list) ----------
create table if not exists communal_area_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into communal_area_types (name, sort_order) values
  ('Road', 1), ('Gate', 2), ('Grass', 3), ('Flower Bed', 4), ('Lamp pole', 5)
on conflict (name) do nothing;

-- ---------- communal_areas ----------
create table if not exists communal_areas (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,            -- e.g. "GATE-1"
  type_id      uuid references communal_area_types(id) on delete set null,
  name         text not null,                   -- e.g. "Main gate"
  description  text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_areas_type on communal_areas(type_id);

-- ---------- communal_area_photos ----------
create table if not exists communal_area_photos (
  id           uuid primary key default gen_random_uuid(),
  area_id      uuid not null references communal_areas(id) on delete cascade,
  storage_path text not null,
  caption      text,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_area_photos_area on communal_area_photos(area_id);

-- ---------- RLS ----------
alter table communal_area_types  enable row level security;
alter table communal_areas       enable row level security;
alter table communal_area_photos enable row level security;

-- Read: any signed-in user. Write: trustees only.
drop policy if exists "read area types" on communal_area_types;
create policy "read area types" on communal_area_types for select
  using ( auth.uid() is not null );
drop policy if exists "trustee writes area types" on communal_area_types;
create policy "trustee writes area types" on communal_area_types for all
  using ( is_trustee() ) with check ( is_trustee() );

drop policy if exists "read areas" on communal_areas;
create policy "read areas" on communal_areas for select
  using ( auth.uid() is not null );
drop policy if exists "trustee writes areas" on communal_areas;
create policy "trustee writes areas" on communal_areas for all
  using ( is_trustee() ) with check ( is_trustee() );

drop policy if exists "read area photos" on communal_area_photos;
create policy "read area photos" on communal_area_photos for select
  using ( auth.uid() is not null );
drop policy if exists "trustee writes area photos" on communal_area_photos;
create policy "trustee writes area photos" on communal_area_photos for all
  using ( is_trustee() ) with check ( is_trustee() );
