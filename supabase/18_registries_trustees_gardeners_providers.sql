-- ============================================================
--  Blue Crane Vistas Portal — registries: Trustees, Gardeners,
--  Service providers (PR 1 of 3)
--
--  Registry records (people/companies), separate from login users.
--  Each has an optional profile_id so a login user can later be linked
--  to exactly one record (done in a later PR). A "service end date" that
--  is empty means the person/company is current.
--
--  VISIBILITY: trustees only (these hold sensitive personal data such as
--  ID numbers and dates of birth). Nobody else can read or write them.
--
--  Run AFTER 17_units_number_integer.sql.
-- ============================================================

-- ---------- trustees ----------
-- A trustee lives in the complex, so is linked to (at most) one unit.
create table if not exists trustees (
  id             uuid primary key default gen_random_uuid(),
  first_name     text not null,
  last_name      text not null,
  cell           text,
  unit_id        uuid references units(id) on delete set null,
  service_start  date not null,
  service_end    date,                      -- empty = current trustee
  profile_id     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint trustees_dates_ok check (service_end is null or service_end >= service_start)
);

-- ---------- gardeners ----------
create table if not exists gardeners (
  id             uuid primary key default gen_random_uuid(),
  first_name     text not null,
  last_name      text not null,
  gender         text check (gender in ('male', 'female', 'other')),
  id_number      text,
  date_of_birth  date,
  cell           text,
  email          text,
  service_start  date not null,
  service_end    date,                      -- empty = current gardener
  profile_id     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint gardeners_dates_ok check (service_end is null or service_end >= service_start)
);

-- ---------- service_providers ----------
-- A provider is either a person (first + last name) or a company
-- (company name, with an optional contact person).
create table if not exists service_providers (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'company' check (kind in ('person', 'company')),
  first_name      text,
  last_name       text,
  company_name    text,
  contact_person  text,
  phone           text,
  email           text,
  service_start   date not null,
  service_end     date,                     -- empty = current provider
  profile_id      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint providers_dates_ok check (service_end is null or service_end >= service_start),
  constraint providers_name_ok check (
    (kind = 'person'  and first_name is not null and last_name is not null)
    or
    (kind = 'company' and company_name is not null)
  )
);

-- One login user per registry record, and one registry record per user.
create unique index if not exists uq_trustees_profile  on trustees(profile_id)          where profile_id is not null;
create unique index if not exists uq_gardeners_profile on gardeners(profile_id)         where profile_id is not null;
create unique index if not exists uq_providers_profile on service_providers(profile_id) where profile_id is not null;

-- The same ID number cannot be captured twice.
create unique index if not exists uq_gardeners_id_number on gardeners(id_number) where id_number is not null;

create index if not exists idx_trustees_unit on trustees(unit_id);

-- ---------- RLS: trustees only ----------
alter table trustees           enable row level security;
alter table gardeners          enable row level security;
alter table service_providers  enable row level security;

drop policy if exists "trustee all trustees" on trustees;
create policy "trustee all trustees" on trustees for all
  using ( is_trustee() ) with check ( is_trustee() );

drop policy if exists "trustee all gardeners" on gardeners;
create policy "trustee all gardeners" on gardeners for all
  using ( is_trustee() ) with check ( is_trustee() );

drop policy if exists "trustee all providers" on service_providers;
create policy "trustee all providers" on service_providers for all
  using ( is_trustee() ) with check ( is_trustee() );
