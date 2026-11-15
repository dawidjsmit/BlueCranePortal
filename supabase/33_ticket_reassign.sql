-- ============================================================
--  Blue Crane Vistas Portal — reassigning tickets
--
--  Reassigning is now its own action (separate from posting feedback).
--
--  Also fixes a gap: only trustees (and a logger on their own draft) may
--  update a ticket row directly, so when a gardener, service provider or
--  resident who held the ticket tried to send it on, or posted feedback
--  (which should mark it Busy), the change was silently not saved.
--  These two functions do those steps safely for whoever holds the ticket.
--
--  Run AFTER 32_ticket_relates_to.sql.  Safe to re-run.
-- ============================================================

-- Does the current user hold the role this ticket is assigned to?
create or replace function holds_ticket_role(p_ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case t.assigned_role
      when 'trustee'          then is_trustee()
      when 'owner'            then t.unit_id is not null and is_unit_owner(t.unit_id)
      when 'tenant'           then t.unit_id is not null and is_unit_tenant(t.unit_id)
      when 'occupant'         then t.unit_id is not null and exists (
                                     select 1 from occupants o
                                     where o.unit_id = t.unit_id and o.profile_id = auth.uid() and o.active)
      when 'gardener'         then my_role() = 'gardener'
      when 'service_provider' then my_role() = 'service_provider'
      else false
    end
    from tickets t where t.id = p_ticket
  ), false);
$$;

-- Reassign a ticket to another role. Trustees, or whoever holds it now.
-- Adds a note to the feedback history and sets the status to Waiting.
create or replace function reassign_ticket(p_ticket uuid, p_role app_role)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tickets%rowtype;
  labels jsonb := '{"trustee":"Trustee","owner":"Owner","tenant":"Tenant","occupant":"Occupant","gardener":"Gardener","service_provider":"Service provider"}';
begin
  select * into t from tickets where id = p_ticket;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if not (is_trustee() or holds_ticket_role(p_ticket)) then
    raise exception 'Only a trustee or whoever the ticket is assigned to can reassign it.';
  end if;
  if t.status in ('create', 'complete', 'cancelled') then
    raise exception 'This ticket can''t be reassigned in its current status.';
  end if;
  if t.assigned_role = p_role then
    raise exception 'The ticket is already assigned to that role.';
  end if;

  insert into ticket_feedback (ticket_id, author_id, author_role, body)
  values (p_ticket, auth.uid(), my_role(),
          '↪ Reassigned from ' || coalesce(labels ->> t.assigned_role::text, '—')
          || ' to ' || (labels ->> p_role::text) || '.');

  update tickets set assigned_role = p_role, status = 'waiting' where id = p_ticket;
end;
$$;

-- After feedback is posted: if the poster holds the ticket, mark it Busy.
create or replace function mark_ticket_busy(p_ticket uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if holds_ticket_role(p_ticket) then
    update tickets set status = 'busy'
    where id = p_ticket and status in ('sent', 'waiting', 'parked');
  end if;
end;
$$;

revoke all on function holds_ticket_role(uuid) from public;
revoke all on function reassign_ticket(uuid, app_role) from public;
revoke all on function mark_ticket_busy(uuid) from public;
grant execute on function holds_ticket_role(uuid) to authenticated;
grant execute on function reassign_ticket(uuid, app_role) to authenticated;
grant execute on function mark_ticket_busy(uuid) to authenticated;
