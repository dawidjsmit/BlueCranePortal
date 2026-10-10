-- ============================================================
--  Blue Crane Vistas Portal — Phase 5 migration
--  Role-based resident permissions (owners & tenants can edit
--  their own unit's ACTIVE registry data).
--
--  Permission summary (for a user linked to a unit):
--    trustee           -> everything, incl. inactive history
--    owner             -> view+edit owners/tenants/occupants/pets/photos
--                         (active); may NOT edit unit basics
--    tenant            -> view+edit tenants/occupants/pets (active) and
--                         view photos; NO owner details; NO unit basics
--    gardener / s.p.   -> view unit basics + photos only
--
--  Residents only ever see ACTIVE records; inactive (left) records
--  remain visible to trustees for history.
--
--  Run AFTER 07_phase4_photos.sql and 08_storage_policies.sql.
-- ============================================================

-- ---------- Membership helpers ----------
-- True if the user has a request assigned to them on this unit
-- (gardeners / service providers get basics + photo READ access this way).
create or replace function is_unit_assignee(target_unit uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.unit_id = target_unit and r.assignee_id = auth.uid()
  );
$$;

-- is_unit_owner already created in 07; redefine to also honour the
-- owners table profile_id link (belt and braces).
create or replace function is_unit_owner(target_unit uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from owners o
    where o.unit_id = target_unit and o.profile_id = auth.uid() and o.active
  ) or exists (
    select 1 from unit_members m
    where m.unit_id = target_unit and m.profile_id = auth.uid() and m.relation = 'owner'
  );
$$;

create or replace function is_unit_tenant(target_unit uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from tenants t
    where t.unit_id = target_unit and t.profile_id = auth.uid() and t.active
  ) or exists (
    select 1 from unit_members m
    where m.unit_id = target_unit and m.profile_id = auth.uid() and m.relation = 'tenant'
  );
$$;

-- ============================================================
--  UNITS — basics stay trustee-only to EDIT. Reading is allowed for
--  members (owners/tenants) and now also assignees (gardener/s.p.) who
--  have a request on the unit, so they can view basics + photos.
-- ============================================================
drop policy if exists "read units: trustee or member" on units;
create policy "read units: trustee or member" on units for select
  using ( is_trustee() or is_unit_member(id)
          or is_unit_owner(id) or is_unit_tenant(id) or is_unit_assignee(id) );

-- ============================================================
--  OWNERS
--   read:   trustee(all) | owner of unit(active only) | (tenants: NONE)
--   write:  trustee(all) | owner of unit (active rows)
-- ============================================================
drop policy if exists "read owners" on owners;
create policy "read owners" on owners for select
  using ( is_trustee() or (is_unit_owner(unit_id) and active) );

drop policy if exists "trustee writes owners" on owners;  -- replace broad policy
drop policy if exists "owner insert owners" on owners;
create policy "owner insert owners" on owners for insert
  with check ( is_trustee() or (is_unit_owner(unit_id) and active) );

drop policy if exists "owner update owners" on owners;
create policy "owner update owners" on owners for update
  using ( is_trustee() or (is_unit_owner(unit_id) and active) )
  with check ( is_trustee() or is_unit_owner(unit_id) );

drop policy if exists "trustee delete owners" on owners;
create policy "trustee delete owners" on owners for delete
  using ( is_trustee() );

-- ============================================================
--  TENANTS
--   read:   trustee(all) | owner of unit(active) | tenant of unit(active)
--   write:  trustee(all) | owner of unit(active) | tenant of unit(active)
-- ============================================================
drop policy if exists "read tenants" on tenants;
create policy "read tenants" on tenants for select
  using ( is_trustee() or ((is_unit_owner(unit_id) or is_unit_tenant(unit_id)) and active) );

drop policy if exists "trustee writes tenants" on tenants;
drop policy if exists "resident insert tenants" on tenants;
create policy "resident insert tenants" on tenants for insert
  with check ( is_trustee() or ((is_unit_owner(unit_id) or is_unit_tenant(unit_id)) and active) );

drop policy if exists "resident update tenants" on tenants;
create policy "resident update tenants" on tenants for update
  using ( is_trustee() or ((is_unit_owner(unit_id) or is_unit_tenant(unit_id)) and active) )
  with check ( is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id) );

drop policy if exists "trustee delete tenants" on tenants;
create policy "trustee delete tenants" on tenants for delete
  using ( is_trustee() );

-- ============================================================
--  OCCUPANTS  (owners & tenants may view+edit active)
-- ============================================================
drop policy if exists "read occupants" on occupants;
create policy "read occupants" on occupants for select
  using ( is_trustee() or ((is_unit_owner(unit_id) or is_unit_tenant(unit_id)) and active) );

drop policy if exists "trustee writes occupants" on occupants;
drop policy if exists "resident insert occupants" on occupants;
create policy "resident insert occupants" on occupants for insert
  with check ( is_trustee() or ((is_unit_owner(unit_id) or is_unit_tenant(unit_id)) and active) );

drop policy if exists "resident update occupants" on occupants;
create policy "resident update occupants" on occupants for update
  using ( is_trustee() or ((is_unit_owner(unit_id) or is_unit_tenant(unit_id)) and active) )
  with check ( is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id) );

drop policy if exists "trustee delete occupants" on occupants;
create policy "trustee delete occupants" on occupants for delete
  using ( is_trustee() );

-- ============================================================
--  PETS  (owners & tenants may view+edit)
-- ============================================================
drop policy if exists "read pets" on pets;
create policy "read pets" on pets for select
  using ( is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id)
          or is_unit_member(unit_id) );

drop policy if exists "trustee writes pets" on pets;
drop policy if exists "resident insert pets" on pets;
create policy "resident insert pets" on pets for insert
  with check ( is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id) );

drop policy if exists "resident update pets" on pets;
create policy "resident update pets" on pets for update
  using ( is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id) )
  with check ( is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id) );

drop policy if exists "resident delete pets" on pets;
create policy "resident delete pets" on pets for delete
  using ( is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id) );

-- ============================================================
--  UNIT PHOTOS
--   read:   trustee | any unit member
--   insert/delete: trustee | owner of unit  (tenants/gardeners view only)
--  (already defined this way in 07; re-affirm to be safe)
-- ============================================================
drop policy if exists "read unit photos" on unit_photos;
create policy "read unit photos" on unit_photos for select
  using ( is_trustee() or is_unit_member(unit_id)
          or is_unit_owner(unit_id) or is_unit_tenant(unit_id)
          or is_unit_assignee(unit_id) );

drop policy if exists "add unit photos" on unit_photos;
create policy "add unit photos" on unit_photos for insert
  with check ( is_trustee() or is_unit_owner(unit_id) );

drop policy if exists "delete unit photos" on unit_photos;
create policy "delete unit photos" on unit_photos for delete
  using ( is_trustee() or is_unit_owner(unit_id) );
