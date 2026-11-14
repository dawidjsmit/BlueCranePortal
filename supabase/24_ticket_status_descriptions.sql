-- ============================================================
--  Blue Crane Vistas Portal — ticket status descriptions
--
--  The seven ticket statuses are fixed: the ticket workflow and the
--  security rules depend on them, so they cannot be added, renamed or
--  deleted. This table only holds a DESCRIPTION for each one, which a
--  trustee can edit and which the app shows as a hint wherever a status
--  appears.
--
--  Starter descriptions describing how each status currently behaves are
--  filled in; edit them on the Ticket statuses screen. Re-running this
--  script never overwrites your edits.
--
--  Run once. Safe to re-run.
-- ============================================================

create table if not exists ticket_status_info (
  status       ticket_status primary key,
  description  text
);

insert into ticket_status_info (status, description) values
  ('create',    'Draft. Only the person who logged it can see, edit or delete it. It has not been sent to anyone yet.'),
  ('sent',      'Submitted and assigned to the trustees, waiting for their first response.'),
  ('busy',      'Someone in the role the ticket is assigned to has responded and is working on it.'),
  ('waiting',   'Handed over to another role (for example an owner or the gardener) and waiting for their response.'),
  ('complete',  'Resolved and closed by a trustee. No further feedback can be added.'),
  ('cancelled', 'Cancelled by a trustee. No further feedback can be added.'),
  ('parked',    'Put on hold by a trustee. It stays open and feedback can still be added.')
on conflict (status) do nothing;

alter table ticket_status_info enable row level security;

-- Everyone signed in can read (needed to show the hints).
drop policy if exists "read status info" on ticket_status_info;
create policy "read status info" on ticket_status_info for select
  using ( auth.uid() is not null );

-- Trustees can edit descriptions. There is deliberately NO insert or delete
-- policy, so statuses cannot be added or removed through the app.
drop policy if exists "trustee edits status info" on ticket_status_info;
create policy "trustee edits status info" on ticket_status_info for update
  using ( is_trustee() ) with check ( is_trustee() );
