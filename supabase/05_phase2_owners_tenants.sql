-- ============================================================
--  Blue Crane Vistas Portal — Phase 2 migration
--  Owners & Tenants (registry records, many per unit).
--
--  These are PEOPLE RECORDS in the registry — not login accounts.
--  They may optionally be linked to a login user later via profile_id.
--
--  Run AFTER 04_phase1_layouts.sql.
-- ============================================================

-- How a tenant's lease is held.
do $$ begin
  create type lease_with as enum ('owner', 'agency');
exception when duplicate_object then null; end $$;

-- ---------- owners ----------
create table if not exists owners (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references units(id) on delete cascade,
  profile_id   uuid references profiles(id) on delete set null,  -- optional login link
  first_name   text not null,
  last_name    text not null,
  cell         text,
  email        text,
  owner_since  date,
  is_occupant  boolean not null default false,
  active       boolean not null default true,
  left_on      date,
  created_at   timestamptz not null default now()
);

-- ---------- tenants ----------
create table if not exists tenants (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references units(id) on delete cascade,
  profile_id    uuid references profiles(id) on delete set null, -- optional login link
  first_name    text not null,
  last_name     text not null,
  cell          text,
  email         text,
  tenant_since  date,
  is_occupant   boolean not null default true,
  lease_with    lease_with not null default 'owner',
  agency_name   text,
  agency_cell   text,
  agency_email  text,
  active        boolean not null default true,
  left_on       date,
  created_at    timestamptz not null default now()
);

create index if not exists idx_owners_unit  on owners(unit_id);
create index if not exists idx_tenants_unit on tenants(unit_id);

-- ---------- RLS ----------
alter table owners  enable row level security;
alter table tenants enable row level security;

-- Trustees: full access. Residents: read records for their own unit.
drop policy if exists "read owners" on owners;
create policy "read owners" on owners for select
  using ( is_trustee() or is_unit_member(unit_id) );

drop policy if exists "trustee writes owners" on owners;
create policy "trustee writes owners" on owners for all
  using ( is_trustee() ) with check ( is_trustee() );

drop policy if exists "read tenants" on tenants;
create policy "read tenants" on tenants for select
  using ( is_trustee() or is_unit_member(unit_id) );

drop policy if exists "trustee writes tenants" on tenants;
create policy "trustee writes tenants" on tenants for all
  using ( is_trustee() ) with check ( is_trustee() );
