-- ============================================================
--  Blue Crane Vistas Portal — Database schema (Supabase / PostgreSQL)
--  Run this ONCE in your Supabase project:
--    Dashboard → SQL Editor → New query → paste → Run
--
--  Order matters: run 01_schema.sql, then 02_policies.sql,
--  then (optionally) 03_seed.sql.
-- ============================================================

-- ---------- Enums ----------

-- The five roles you asked for.
create type app_role as enum (
  'trustee',
  'owner',
  'tenant',
  'gardener',
  'service_provider'
);

-- Account approval lifecycle. New sign-ups start as 'pending'
-- until a trustee approves them.
create type account_status as enum (
  'pending',
  'approved',
  'rejected'
);

-- Request workflow (same statuses as the original app).
create type request_status as enum (
  'open',
  'in_progress',
  'waiting_on_resident',
  'resolved'
);

-- ---------- profiles ----------
-- One row per authenticated user. Auto-created on sign-up by a
-- trigger (see bottom of this file). A trustee then sets role +
-- status. The very first user can be promoted to trustee manually.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  role        app_role       not null default 'owner',
  status      account_status not null default 'pending',
  created_at  timestamptz not null default now()
);

-- ---------- units ----------
create table units (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,          -- e.g. "12A"
  notes       text,
  created_at  timestamptz not null default now()
);

-- ---------- unit_members ----------
-- Links a person (profile) to a unit, with their relationship.
-- This is how an owner/tenant is tied to the unit(s) they can see.
create table unit_members (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  relation    app_role not null,             -- 'owner' or 'tenant' typically
  unique (unit_id, profile_id)
);

-- ---------- requests ----------
-- A single logged issue against a unit. Can be assigned to a
-- gardener / service_provider (assignee_id) to give them access.
create table requests (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references units(id) on delete cascade,
  created_by   uuid references profiles(id) on delete set null,
  assignee_id  uuid references profiles(id) on delete set null,
  category     text not null default 'Maintenance',
  title        text not null,
  details      text,
  status       request_status not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- request_log ----------
-- Immutable audit trail: one row per status change / note.
create table request_log (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  text        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- Helper functions ----------

-- True if the current logged-in user is an APPROVED trustee.
-- SECURITY DEFINER so it can read profiles without tripping RLS
-- (prevents infinite recursion in policies).
create or replace function is_trustee()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'trustee'
      and status = 'approved'
  );
$$;

-- True if the current user is a member (owner/tenant) of the unit.
create or replace function is_unit_member(target_unit uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from unit_members
    where unit_id = target_unit
      and profile_id = auth.uid()
  );
$$;

-- ---------- Auto-create a profile on sign-up ----------
-- When someone completes a magic-link sign-in for the first time,
-- Supabase inserts into auth.users; this trigger mirrors a row into
-- public.profiles as a 'pending' 'owner' for a trustee to review.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Keep requests.updated_at fresh on every update.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists requests_touch on requests;
create trigger requests_touch
  before update on requests
  for each row execute function touch_updated_at();

-- Helpful indexes
create index idx_requests_unit    on requests(unit_id);
create index idx_requests_status  on requests(status);
create index idx_requests_assignee on requests(assignee_id);
create index idx_members_profile  on unit_members(profile_id);
create index idx_log_request      on request_log(request_id);
