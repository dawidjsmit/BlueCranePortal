-- ============================================================
--  Blue Crane Vistas Portal — Phase 3 migration
--  Occupants (household members) + Pets.
--
--  Occupant auto-listing (Decision 3, option a / computed):
--  owners & tenants with is_occupant = true are shown as occupants
--  in the app by combining lists — they are NOT duplicated here.
--  This `occupants` table holds only the OTHER household members
--  (spouses, children, live-in employees, etc.).
--
--  Run AFTER 05_phase2_owners_tenants.sql.
-- ============================================================

do $$ begin
  create type occupant_relation as enum ('spouse', 'child', 'live_in_employee', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pet_type as enum ('dog', 'cat', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pet_gender as enum ('male', 'female', 'unknown');
exception when duplicate_object then null; end $$;

-- ---------- occupants ----------
-- Household members who are not themselves owners/tenants.
-- related_owner_id / related_tenant_id: who they belong with (optional,
-- at most one is typically set).
create table if not exists occupants (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid not null references units(id) on delete cascade,
  first_name        text not null,
  last_name         text not null,
  cell              text,
  email             text,
  occupant_since    date,
  related_owner_id  uuid references owners(id)  on delete set null,
  related_tenant_id uuid references tenants(id) on delete set null,
  relationship      occupant_relation not null default 'other',
  active            boolean not null default true,
  left_on           date,
  created_at        timestamptz not null default now()
);

-- ---------- pets ----------
-- Belongs to someone in the unit. Because owners/tenants flagged as
-- occupants are "occupants" too, the owner reference is polymorphic:
--  holder_kind in ('occupant','owner','tenant') + holder_id.
create table if not exists pets (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references units(id) on delete cascade,
  holder_kind   text not null default 'occupant',   -- 'occupant' | 'owner' | 'tenant'
  holder_id     uuid,                                 -- id in the matching table
  name          text not null,
  pet_type      pet_type not null default 'dog',
  type_other    text,                                 -- when pet_type = 'other'
  breed         text,
  gender        pet_gender not null default 'unknown',
  colour        text,
  sterilised    boolean,
  photo_path    text,                                 -- Phase 4 (Storage)
  created_at    timestamptz not null default now(),
  constraint holder_kind_valid check (holder_kind in ('occupant','owner','tenant'))
);

create index if not exists idx_occupants_unit on occupants(unit_id);
create index if not exists idx_pets_unit on pets(unit_id);

-- ---------- RLS ----------
alter table occupants enable row level security;
alter table pets      enable row level security;

drop policy if exists "read occupants" on occupants;
create policy "read occupants" on occupants for select
  using ( is_trustee() or is_unit_member(unit_id) );

drop policy if exists "trustee writes occupants" on occupants;
create policy "trustee writes occupants" on occupants for all
  using ( is_trustee() ) with check ( is_trustee() );

drop policy if exists "read pets" on pets;
create policy "read pets" on pets for select
  using ( is_trustee() or is_unit_member(unit_id) );

drop policy if exists "trustee writes pets" on pets;
create policy "trustee writes pets" on pets for all
  using ( is_trustee() ) with check ( is_trustee() );
