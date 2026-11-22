-- ============================================================
--  Blue Crane Vistas Portal — due date on tickets (optional)
--
--  * Not on drafts: a ticket gets a due date only once it has been sent.
--  * Only trustees can set, change or remove it, through set_ticket_due_date()
--    (a direct edit of the column is refused). Each change adds a 📅 note
--    to the ticket's history, stamped with who did it.
--  * "Overdue" (shown in red by the app) = Sent, Busy or Waiting and the due
--    date is before today.
--
--  Run AFTER 41_feedback_author_names.sql.  Safe to re-run.
-- ============================================================

alter table tickets add column if not exists due_date date;

create or replace function guard_ticket_due_date()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('bcv.setting_due_date', true), '') <> 'on' then
    if tg_op = 'INSERT' and new.due_date is not null then
      raise exception 'A new ticket can''t have a due date. A trustee sets it once the ticket is sent.';
    end if;
    if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date then
      raise exception 'Use Due date on the ticket to change it.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tickets_guard_due_date on tickets;
create trigger tickets_guard_due_date before insert or update on tickets
  for each row execute function guard_ticket_due_date();

-- Set (or remove, with p_date = null) the due date. Trustees only.
create or replace function set_ticket_due_date(p_ticket uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype;
begin
  if not is_trustee() then raise exception 'Only a trustee can set the due date.'; end if;
  select * into t from tickets where id = p_ticket;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if t.status = 'create' then raise exception 'Send the ticket first; a draft can''t have a due date.'; end if;
  if t.due_date is not distinct from p_date then return; end if;

  perform set_config('bcv.setting_due_date', 'on', true);
  update tickets set due_date = p_date where id = p_ticket;
  perform set_config('bcv.setting_due_date', 'off', true);

  insert into ticket_feedback (ticket_id, author_id, author_role, body)
  values (p_ticket, auth.uid(), my_role(),
          case when p_date is null then '📅 Due date removed.'
               else '📅 Due date set to ' || to_char(p_date, 'FMDD Mon YYYY') || '.' end);
end;
$$;

revoke all on function set_ticket_due_date(uuid, date) from public;
grant execute on function set_ticket_due_date(uuid, date) to authenticated;
