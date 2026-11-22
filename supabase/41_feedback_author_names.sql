-- ============================================================
--  Blue Crane Vistas Portal — names on ticket history for everyone
--
--  Only trustees can read the users list, so gardeners and residents saw
--  "User" instead of the name of whoever wrote a history entry (and "—"
--  for who logged the ticket). The name is now saved with each entry and
--  each ticket, so everybody sees it.
--
--  Every history entry is also stamped with the person who actually did
--  it (the signed-in user who clicked the button), with their name and role.
--
--  Run AFTER 40_helper_trustees.sql.  Safe to re-run.
-- ============================================================

-- 1) History entries: author name, filled in automatically.
alter table ticket_feedback add column if not exists author_name text;

update ticket_feedback f
   set author_name = coalesce(nullif(trim(p.full_name), ''), p.email)
  from profiles p
 where p.id = f.author_id and f.author_name is null;

create or replace function stamp_feedback_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The person who did it is the signed-in user (not whatever the app sent).
  if auth.uid() is not null then
    new.author_id := auth.uid();
    select role into new.author_role from profiles where id = auth.uid();
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into new.author_name
    from profiles where id = new.author_id;
  return new;
end;
$$;
drop trigger if exists ticket_feedback_stamp_author on ticket_feedback;
create trigger ticket_feedback_stamp_author before insert on ticket_feedback
  for each row execute function stamp_feedback_author();

-- 2) Tickets: the logger's name, for the "Logged by" line.
alter table tickets add column if not exists logged_by_name text;

update tickets t
   set logged_by_name = coalesce(nullif(trim(p.full_name), ''), p.email)
  from profiles p
 where p.id = t.logged_by and t.logged_by_name is null;

create or replace function stamp_ticket_logger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select coalesce(nullif(trim(full_name), ''), email) into new.logged_by_name
    from profiles where id = new.logged_by;
  return new;
end;
$$;
drop trigger if exists tickets_stamp_logger on tickets;
create trigger tickets_stamp_logger before insert on tickets
  for each row execute function stamp_ticket_logger();
