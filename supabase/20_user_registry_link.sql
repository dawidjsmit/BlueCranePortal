-- ============================================================
--  Blue Crane Vistas Portal — link each login user to their registry
--  record (PR 3 of 3)
--
--  Rule: a user's role decides which registry they belong to, and the user
--  is linked to exactly ONE record there:
--    trustee          -> trustees
--    owner            -> owners
--    tenant           -> tenants
--    occupant         -> occupants
--    gardener         -> gardeners
--    service_provider -> service_providers
--  The record's profile_id points at the user. A user's UNITS then come from
--  that record (trustee: its unit; owner: its unit links; tenant/occupant:
--  its unit) — so units are no longer linked to users by hand.
--
--  Also fixes a security gap: any signed-in user could change their OWN role
--  or status through the API. Role and status are now trustee-only.
--
--  Unit membership (used by many security rules) is now worked out from the
--  registry. Old hand-made user<->unit links are removed only where the
--  registry already covers them, so nobody loses access. Users without a
--  registry record keep working and show as "needs a registry record" on the
--  Users screen until a trustee links them.
--
--  Run AFTER 19_owners_many_units.sql.
-- ============================================================

-- 1) "Is this user a member of this unit?" — now derived from the REGISTRY
--    (the user's owner unit links, tenant record, occupant record, or trustee
--    record). Many row-level-security rules use this check, so it must be in
--    place BEFORE the hand-made links are removed in step 3.
create or replace function is_unit_member(target_unit uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from unit_owners uo join owners o on o.id = uo.owner_id
                 where uo.unit_id = target_unit and uo.active and o.profile_id = auth.uid())
      or exists (select 1 from tenants
                 where unit_id = target_unit and active and profile_id = auth.uid())
      or exists (select 1 from occupants
                 where unit_id = target_unit and active and profile_id = auth.uid())
      or exists (select 1 from trustees
                 where unit_id = target_unit and profile_id = auth.uid())
      or exists (select 1 from unit_members
                 where unit_id = target_unit and profile_id = auth.uid());
$$;

-- 2) Before removing the hand-made links, make sure each one is represented
--    in the registry — so nobody silently loses access. Where a user was
--    linked to a unit by hand as tenant/occupant but has no record carrying
--    their login for that unit, attach them to a matching unlinked record on
--    that unit (same email) if one exists.
update tenants t set profile_id = m.profile_id
from unit_members m join profiles p on p.id = m.profile_id
where m.relation = 'tenant' and t.unit_id = m.unit_id and t.profile_id is null
  and lower(coalesce(t.email, '')) = lower(p.email)
  and not exists (select 1 from tenants t2 where t2.profile_id = m.profile_id);

update occupants o set profile_id = m.profile_id
from unit_members m join profiles p on p.id = m.profile_id
where m.relation = 'occupant' and o.unit_id = m.unit_id and o.profile_id is null
  and lower(coalesce(o.email, '')) = lower(p.email)
  and not exists (select 1 from occupants o2 where o2.profile_id = m.profile_id);

-- 3) Remove hand-made owner/tenant/occupant links that the registry now
--    covers. Any link the registry does NOT cover is kept, so no one loses
--    access; such users show as "needs a registry record" in the app.
delete from unit_members m
where m.relation in ('owner', 'tenant', 'occupant')
  and (
    exists (select 1 from unit_owners uo join owners o on o.id = uo.owner_id
            where uo.unit_id = m.unit_id and o.profile_id = m.profile_id)
    or exists (select 1 from tenants   where unit_id = m.unit_id and profile_id = m.profile_id)
    or exists (select 1 from occupants where unit_id = m.unit_id and profile_id = m.profile_id)
  );

-- 4) At most one login user per owner / tenant / occupant record
--    (trustees, gardeners, service providers already have this from 18).
--    If this fails, the same user is attached to two records — the error
--    names the table; unlink one record and run again.
create unique index if not exists uq_owners_profile    on owners(profile_id)    where profile_id is not null;
create unique index if not exists uq_tenants_profile   on tenants(profile_id)   where profile_id is not null;
create unique index if not exists uq_occupants_profile on occupants(profile_id) where profile_id is not null;

-- 5) Only trustees may change anyone's role or status — including their own.
create or replace function guard_profile_role_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not is_trustee() then
    raise exception 'Only a trustee can change a user''s role or status.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_status on profiles;
create trigger profiles_guard_role_status
  before update on profiles
  for each row execute function guard_profile_role_status();

-- 6) Link a user to their registry record — everything in one transaction.
--    Trustee only. Clears the user from every registry, links the chosen
--    record, and sets the user's role (and approves them).
create or replace function link_user_to_record(p_user uuid, p_role app_role, p_record uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  found_it boolean;
begin
  if not is_trustee() then
    raise exception 'Only a trustee can link users.';
  end if;
  if p_record is null then
    raise exception 'Choose the registry record to link this user to.';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'That user no longer exists.';
  end if;

  -- Never remove the LAST approved trustee (would lock everyone out of admin).
  if p_role <> 'trustee'
     and exists (select 1 from profiles where id = p_user and role = 'trustee' and status = 'approved')
     and (select count(*) from profiles where role = 'trustee' and status = 'approved') <= 1 then
    raise exception 'This is the only trustee. Make someone else a trustee first.';
  end if;

  -- The chosen record must exist in the registry for that role, and must not
  -- already belong to a DIFFERENT user.
  execute format(
    'select exists (select 1 from %I where id = $1 and (profile_id is null or profile_id = $2))',
    case p_role
      when 'trustee'          then 'trustees'
      when 'owner'            then 'owners'
      when 'tenant'           then 'tenants'
      when 'occupant'         then 'occupants'
      when 'gardener'         then 'gardeners'
      when 'service_provider' then 'service_providers'
    end)
  into found_it using p_record, p_user;
  if not found_it then
    raise exception 'That record was not found, or is already linked to another user.';
  end if;

  -- Detach the user from every registry (a role change re-links cleanly).
  update trustees          set profile_id = null where profile_id = p_user;
  update owners            set profile_id = null where profile_id = p_user;
  update tenants           set profile_id = null where profile_id = p_user;
  update occupants         set profile_id = null where profile_id = p_user;
  update gardeners         set profile_id = null where profile_id = p_user;
  update service_providers set profile_id = null where profile_id = p_user;

  -- Attach to the chosen record.
  case p_role
    when 'trustee'          then update trustees          set profile_id = p_user where id = p_record;
    when 'owner'            then update owners            set profile_id = p_user where id = p_record;
    when 'tenant'           then update tenants           set profile_id = p_user where id = p_record;
    when 'occupant'         then update occupants         set profile_id = p_user where id = p_record;
    when 'gardener'         then update gardeners         set profile_id = p_user where id = p_record;
    when 'service_provider' then update service_providers set profile_id = p_user where id = p_record;
  end case;

  update profiles set role = p_role, status = 'approved' where id = p_user;
end;
$$;

-- Only signed-in users can call it (and inside it, only trustees succeed).
revoke all on function link_user_to_record(uuid, app_role, uuid) from public;
grant execute on function link_user_to_record(uuid, app_role, uuid) to authenticated;
