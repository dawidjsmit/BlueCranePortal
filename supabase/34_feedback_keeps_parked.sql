-- ============================================================
--  Blue Crane Vistas Portal — feedback no longer un-parks a ticket
--
--  Posting feedback marks a ticket Busy only when it is Sent or Waiting.
--  A Parked ticket stays Parked (you can keep adding feedback); a trustee
--  brings it back with the "Mark Busy" button.
--
--  Run AFTER 33_ticket_reassign.sql.  Safe to re-run.
-- ============================================================

create or replace function mark_ticket_busy(p_ticket uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if holds_ticket_role(p_ticket) then
    update tickets set status = 'busy'
    where id = p_ticket and status in ('sent', 'waiting');
  end if;
end;
$$;

revoke all on function mark_ticket_busy(uuid) from public;
grant execute on function mark_ticket_busy(uuid) to authenticated;
