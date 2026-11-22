-- ============================================================
--  Blue Crane Vistas Portal — tighter rules for reassigning tickets
--
--  Reassign (change the ROLE):
--    * only a trustee, or the person the ticket is assigned to (the
--      assigned user, who must still hold the role);
--    * only while Sent, Busy or Waiting (not Parked, Complete, Cancelled);
--    * a ticket without a unit (communal entity / general) can't go to
--      Owner, Tenant or Occupant.
--  Assign user:
--    * not on Complete or Cancelled tickets (for anybody).
--    * unchanged otherwise: anyone in the role may take it for themselves,
--      also from someone else; trustees may assign anybody in the role.
--
--  Run AFTER 37_ticket_assigned_user.sql.  Safe to re-run.
-- ============================================================

create or replace function reassign_ticket(p_ticket uuid, p_role app_role)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tickets%rowtype;
  labels jsonb := '{"trustee":"Trustee","owner":"Owner","tenant":"Tenant","occupant":"Occupant","gardener":"Gardener","service_provider":"Service provider"}';
begin
  select * into t from tickets where id = p_ticket;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if not (is_trustee() or (t.assigned_user_id = auth.uid() and holds_ticket_role(p_ticket))) then
    raise exception 'Only a trustee or the person this ticket is assigned to can reassign it. Assign it to yourself first.';
  end if;
  if t.status not in ('sent', 'busy', 'waiting') then
    raise exception 'A % ticket can''t be reassigned.', lower(t.status::text);
  end if;
  if t.assigned_role = p_role then
    raise exception 'The ticket is already assigned to that role.';
  end if;
  if t.unit_id is null and p_role in ('owner', 'tenant', 'occupant') then
    raise exception 'This ticket isn''t about a unit, so it can''t go to an owner, tenant or occupant.';
  end if;

  insert into ticket_feedback (ticket_id, author_id, author_role, body)
  values (p_ticket, auth.uid(), my_role(),
          '↪ Reassigned from ' || coalesce(labels ->> t.assigned_role::text, '—')
          || ' to ' || (labels ->> p_role::text) || '.');

  update tickets set assigned_role = p_role, status = 'waiting' where id = p_ticket;
end;
$$;

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
  if t.status in ('complete', 'cancelled') then
    raise exception 'This ticket is closed. Mark it Busy first to change who it is assigned to.';
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

revoke all on function reassign_ticket(uuid, app_role) from public;
revoke all on function assign_ticket_user(uuid, uuid) from public;
grant execute on function reassign_ticket(uuid, app_role) to authenticated;
grant execute on function assign_ticket_user(uuid, uuid) to authenticated;
