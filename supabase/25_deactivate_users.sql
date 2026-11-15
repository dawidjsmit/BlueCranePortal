-- ============================================================
--  Blue Crane Vistas Portal — deactivate users
--
--  A trustee can deactivate a user so they can no longer use the system.
--  Deactivation is done by the manage-users Edge Function, which:
--    1. sets profiles.deactivated_at (this file), and
--    2. bans the login in Supabase Auth, so they cannot sign in again.
--  Reactivating clears both. The user's registry record and history stay.
--
--  Rules enforced here, whatever route is used:
--    * only trustees can deactivate / reactivate anyone;
--    * you cannot deactivate yourself;
--    * the last active trustee cannot be deactivated;
--    * a deactivated trustee loses trustee powers immediately.
--
--  Run AFTER 24_ticket_status_descriptions.sql.  Safe to re-run.
-- ============================================================

-- 1) The flag.
alter table profiles add column if not exists deactivated_at timestamptz;

-- 2) A deactivated trustee is no longer a trustee, effective immediately.
create or replace function is_trustee()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'trustee'
      and status = 'approved'
      and deactivated_at is null
  );
$$;

-- 3) Guard: role, status and deactivation are trustee-only, with safety rules.
create or replace function guard_profile_role_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.deactivated_at is distinct from old.deactivated_at)
     and not is_trustee() then
    raise exception 'Only a trustee can change a user''s role, status or active state.';
  end if;

  if new.deactivated_at is not null and old.deactivated_at is null then
    if new.id = auth.uid() then
      raise exception 'You cannot deactivate your own account.';
    end if;
    if new.role = 'trustee' and new.status = 'approved'
       and not exists (select 1 from profiles
                       where id <> new.id and role = 'trustee'
                         and status = 'approved' and deactivated_at is null) then
      raise exception 'This is the only active trustee. Make someone else a trustee first.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_status on profiles;
create trigger profiles_guard_role_status
  before update on profiles
  for each row execute function guard_profile_role_status();

-- 4) Linking: the "last trustee" safety check now counts ACTIVE trustees only.
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
     and exists (select 1 from profiles where id = p_user and role = 'trustee' and status = 'approved' and deactivated_at is null)
     and (select count(*) from profiles where role = 'trustee' and status = 'approved' and deactivated_at is null) <= 1 then
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

revoke all on function link_user_to_record(uuid, app_role, uuid) from public;
grant execute on function link_user_to_record(uuid, app_role, uuid) to authenticated;
