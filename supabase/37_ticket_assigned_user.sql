-- ============================================================
--  Blue Crane Vistas Portal — "Assigned to user" on tickets
--
--  Next to the assigned ROLE (unchanged, still drives who sees and handles
--  a ticket), a ticket can now also have an assigned USER (optional).
--
--  Rules:
--    * whenever the ticket moves to another role, the assigned user is
--      cleared — someone in the new role picks it up;
--    * someone holding the ticket's role can assign it to themselves only
--      (and unassign themselves);
--    * a trustee can assign it to anybody in the ticket's role, any time.
--  Each change adds a note to the ticket's feedback history.
--
--  Run AFTER 36_garden_whats_new.sql.  Safe to re-run.
-- ============================================================

alter table tickets add column if not exists assigned_user_id   uuid references profiles(id) on delete set null;
alter table tickets add column if not exists assigned_user_name text;

-- Moving to another role clears the assigned user.
create or replace function clear_ticket_user_on_role_change()
returns trigger language plpgsql as $$
begin
  if new.assigned_role is distinct from old.assigned_role then
    new.assigned_user_id := null;
    new.assigned_user_name := null;
  end if;
  return new;
end;
$$;
drop trigger if exists tickets_clear_user_on_role_change on tickets;
create trigger tickets_clear_user_on_role_change before update on tickets
  for each row execute function clear_ticket_user_on_role_change();

-- Only these functions may set the assigned user (not a direct edit).
create or replace function guard_ticket_assigned_user()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('bcv.assigning_user', true), '') <> 'on'
     and new.assigned_user_id is distinct from old.assigned_user_id
     and new.assigned_role is not distinct from old.assigned_role then
    raise exception 'Use Assign user on the ticket to change who it is assigned to.';
  end if;
  return new;
end;
$$;
drop trigger if exists tickets_guard_assigned_user on tickets;
create trigger tickets_guard_assigned_user before update on tickets
  for each row execute function guard_ticket_assigned_user();

-- Active users who hold this ticket's role (the people it can be assigned to).
create or replace function ticket_role_users(p_ticket uuid)
returns table (id uuid, name text) language plpgsql stable security definer set search_path = public as $$
declare t tickets%rowtype;
begin
  select * into t from tickets where tickets.id = p_ticket;
  if not found then return; end if;
  if not (is_trustee() or holds_ticket_role(p_ticket)) then return; end if;
  return query
    select p.id, coalesce(nullif(trim(p.full_name), ''), p.email)
    from profiles p
    where p.status = 'approved' and p.deactivated_at is null
      and case t.assigned_role
        when 'trustee'          then p.role = 'trustee'
        when 'gardener'         then p.role = 'gardener'
        when 'service_provider' then p.role = 'service_provider'
        when 'owner' then t.unit_id is not null and (
             exists (select 1 from unit_owners uo join owners o on o.id = uo.owner_id
                     where uo.unit_id = t.unit_id and uo.active and o.profile_id = p.id)
          or exists (select 1 from unit_members m where m.unit_id = t.unit_id and m.profile_id = p.id and m.relation = 'owner'))
        when 'tenant' then t.unit_id is not null and (
             exists (select 1 from tenants x where x.unit_id = t.unit_id and x.active and x.profile_id = p.id)
          or exists (select 1 from unit_members m where m.unit_id = t.unit_id and m.profile_id = p.id and m.relation = 'tenant'))
        when 'occupant' then t.unit_id is not null and
             exists (select 1 from occupants x where x.unit_id = t.unit_id and x.active and x.profile_id = p.id)
        else false
      end
    order by 2;
end;
$$;

-- Assign (or unassign with p_user = null) the ticket's user.
create or replace function assign_ticket_user(p_ticket uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tickets%rowtype;
  uname text;
  me_trustee boolean := is_trustee();
begin
  select * into t from tickets where id = p_ticket;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if t.status = 'create' or t.assigned_role is null then
    raise exception 'Submit the ticket first.';
  end if;
  if t.assigned_user_id is not distinct from p_user then return; end if;

  if not me_trustee then
    if not holds_ticket_role(p_ticket) then
      raise exception 'Only a trustee or someone in the assigned role can assign this ticket.';
    end if;
    if p_user is not null and p_user <> auth.uid() then
      raise exception 'You can only assign the ticket to yourself.';
    end if;
    if p_user is null and t.assigned_user_id is distinct from auth.uid() then
      raise exception 'Only a trustee can unassign someone else.';
    end if;
  end if;

  if p_user is not null then
    select r.name into uname from ticket_role_users(p_ticket) r where r.id = p_user;
    if uname is null then
      raise exception 'That person is not in the role this ticket is assigned to.';
    end if;
  end if;

  perform set_config('bcv.assigning_user', 'on', true);
  update tickets set assigned_user_id = p_user, assigned_user_name = uname where id = p_ticket;
  perform set_config('bcv.assigning_user', 'off', true);

  insert into ticket_feedback (ticket_id, author_id, author_role, body)
  values (p_ticket, auth.uid(), my_role(),
          case when p_user is null then '👤 Unassigned ' || coalesce(t.assigned_user_name, 'the user') || '.'
               when p_user = auth.uid() then '👤 ' || uname || ' took this ticket.'
               else '👤 Assigned to ' || uname || '.' end);
end;
$$;

revoke all on function ticket_role_users(uuid) from public;
revoke all on function assign_ticket_user(uuid, uuid) from public;
grant execute on function ticket_role_users(uuid) to authenticated;
grant execute on function assign_ticket_user(uuid, uuid) to authenticated;
