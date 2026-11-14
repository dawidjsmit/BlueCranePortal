-- ============================================================
--  Blue Crane Vistas Portal — owners become people with many units
--  (PR 2 of 3)
--
--  BEFORE: one owner row per unit (so a person who owns 5 units had to be
--          entered 5 times).
--  AFTER : one owner row per PERSON (name, cell, email, optional login
--          link), plus a link row per unit they own (unit_owners) holding
--          the owner-since date, "is occupant", and active / left-on.
--
--  Rules enforced by the database:
--   * an owner can be the occupant of at most ONE unit (while active);
--   * an owner is linked to a given unit at most once.
--
--  SAFETY
--   1. Each existing owner row becomes one person (SAME id, so pets and
--      occupants that point at an owner stay valid) plus one unit link.
--   2. A check confirms every old row was carried over. If it did not, the
--      script stops with an error and, because it runs as one batch,
--      nothing is changed.
--   3. Safe to re-run: once converted, the conversion step is skipped.
--
--  People already entered twice (e.g. the same owner under two units)
--  convert as two people. To merge: edit one, add the other unit(s), then
--  delete the duplicate.
--
--  Run AFTER 18_registries_trustees_gardeners_providers.sql.
-- ============================================================

-- 1) Unit links.
create table if not exists unit_owners (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references units(id)  on delete cascade,
  owner_id     uuid not null references owners(id) on delete cascade,
  owner_since  date,
  is_occupant  boolean not null default false,
  active       boolean not null default true,
  left_on      date,
  created_at   timestamptz not null default now(),
  unique (unit_id, owner_id)
);
create index if not exists idx_unit_owners_unit  on unit_owners(unit_id);
create index if not exists idx_unit_owners_owner on unit_owners(owner_id);

-- An owner can live in only one unit at a time.
create unique index if not exists uq_owner_one_occupancy
  on unit_owners(owner_id) where is_occupant and active;

-- 2) Carry the existing rows over, then verify.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'owners'
               and column_name = 'unit_id') then

    insert into unit_owners (unit_id, owner_id, owner_since, is_occupant, active, left_on)
    select o.unit_id, o.id, o.owner_since,
           coalesce(o.is_occupant, false), coalesce(o.active, true), o.left_on
    from owners o
    where o.unit_id is not null
    on conflict (unit_id, owner_id) do nothing;

    if (select count(*) from unit_owners)
       < (select count(*) from owners where unit_id is not null) then
      raise exception
        'Safety check failed: not every owner row was carried over. Nothing has been changed.';
    end if;
  end if;
end $$;

-- 3) Remove the old per-unit policies (they reference the columns we drop).
drop policy if exists "read owners"          on owners;
drop policy if exists "trustee writes owners" on owners;
drop policy if exists "owner insert owners"  on owners;
drop policy if exists "owner update owners"  on owners;
drop policy if exists "trustee delete owners" on owners;

-- 4) Owners are now just people.
alter table owners drop column if exists unit_id;
alter table owners drop column if exists owner_since;
alter table owners drop column if exists is_occupant;
alter table owners drop column if exists active;
alter table owners drop column if exists left_on;

-- 5) Helper functions (security definer so they can read across tables).

-- "Am I an active owner of this unit?" — now via the unit links.
create or replace function is_unit_owner(target_unit uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1
    from unit_owners uo
    join owners o on o.id = uo.owner_id
    where uo.unit_id = target_unit
      and o.profile_id = auth.uid()
      and uo.active
  ) or exists (
    select 1 from unit_members m
    where m.unit_id = target_unit
      and m.profile_id = auth.uid()
      and m.relation = 'owner'
  );
$$;

-- "Is this owner record one of mine?"
create or replace function is_my_owner_record(target_owner uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from owners o
    where o.id = target_owner and o.profile_id = auth.uid()
  );
$$;

-- "Does this owner have an active link to a unit I own?"
create or replace function owner_in_my_units(target_owner uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from unit_owners uo
    where uo.owner_id = target_owner
      and uo.active
      and is_unit_owner(uo.unit_id)
  );
$$;

-- "Am I an owner at all?" (lets an owner add a co-owner to their unit.)
create or replace function is_owner_user()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from owners where profile_id = auth.uid())
      or exists (select 1 from unit_members
                 where profile_id = auth.uid() and relation = 'owner');
$$;

-- 6) Row-level security.
alter table unit_owners enable row level security;

-- owners (people)
drop policy if exists "read owners"   on owners;
drop policy if exists "insert owners" on owners;
drop policy if exists "update owners" on owners;
drop policy if exists "delete owners" on owners;

create policy "read owners" on owners for select
  using ( is_trustee() or is_my_owner_record(id) or owner_in_my_units(id) );

create policy "insert owners" on owners for insert
  with check ( is_trustee() or is_owner_user() );

create policy "update owners" on owners for update
  using      ( is_trustee() or is_my_owner_record(id) or owner_in_my_units(id) )
  with check ( is_trustee() or is_my_owner_record(id) or owner_in_my_units(id) );

create policy "delete owners" on owners for delete
  using ( is_trustee() );

-- unit_owners (links)
drop policy if exists "read unit owners"   on unit_owners;
drop policy if exists "insert unit owners" on unit_owners;
drop policy if exists "update unit owners" on unit_owners;
drop policy if exists "delete unit owners" on unit_owners;

create policy "read unit owners" on unit_owners for select
  using ( is_trustee()
          or (active and is_unit_owner(unit_id))
          or is_my_owner_record(owner_id) );

create policy "insert unit owners" on unit_owners for insert
  with check ( is_trustee() or is_unit_owner(unit_id) );

create policy "update unit owners" on unit_owners for update
  using      ( is_trustee() or is_unit_owner(unit_id) )
  with check ( is_trustee() or is_unit_owner(unit_id) );

create policy "delete unit owners" on unit_owners for delete
  using ( is_trustee() );

-- 7) Result: people and their unit links, for a quick eyeball.
select
  (select count(*) from owners)      as people,
  (select count(*) from unit_owners) as unit_links;
