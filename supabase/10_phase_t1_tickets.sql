-- ============================================================
--  Blue Crane Vistas Portal — Ticket system (Phase T1: data model)
--
--  Replaces the old "requests" with a full Ticket workflow:
--  type (managed list), status lifecycle, assigned-to ROLE,
--  a feedback conversation, and ticket + feedback photos.
--
--  NOTE: the old `requests`/`request_log` tables are DROPPED in
--  Phase T2 (together with the app swap) so the live app keeps
--  working until then. This file only ADDS the new structures.
--
--  Run AFTER 09_phase5_resident_permissions.sql.
-- ============================================================

-- ⚠️ IMPORTANT: the 6th role 'occupant' is added to the app_role enum in a
-- SEPARATE file, 10a_add_occupant_role.sql, which you MUST run and let
-- finish FIRST. PostgreSQL does not allow using a newly-added enum value in
-- the same transaction that adds it, so it has to be its own step.

-- ---------- Occupants get a login link (like owners/tenants) ----------
-- Needed so an 'occupant' user can be linked to their unit (Q4).
alter table occupants
  add column if not exists profile_id uuid references profiles(id) on delete set null;

-- ---------- Ticket status ----------
do $$ begin
  create type ticket_status as enum
    ('create','sent','busy','waiting','complete','cancelled','parked');
exception when duplicate_object then null; end $$;

-- ---------- ticket_types (trustee-managed list) ----------
create table if not exists ticket_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into ticket_types (name, sort_order) values
  ('Question', 1), ('Problem', 2), ('Request', 3),
  ('Complaint', 4), ('Maintenance', 5)
on conflict (name) do nothing;

-- ---------- tickets ----------
-- assigned_role is which ROLE currently owns the ticket (app_role).
create table if not exists tickets (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references units(id) on delete cascade,
  type_id       uuid references ticket_types(id) on delete set null,
  logged_by     uuid references profiles(id) on delete set null,
  logged_by_role app_role,                 -- the logger's role at creation
  heading       text not null,
  description   text,
  status        ticket_status not null default 'create',
  assigned_role app_role,                   -- null while in 'create'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_tickets_unit     on tickets(unit_id);
create index if not exists idx_tickets_status    on tickets(status);
create index if not exists idx_tickets_assigned  on tickets(assigned_role);
create index if not exists idx_tickets_loggedby  on tickets(logged_by);

-- keep updated_at fresh
drop trigger if exists tickets_touch on tickets;
create trigger tickets_touch before update on tickets
  for each row execute function touch_updated_at();

-- ---------- ticket_feedback (the conversation) ----------
create table if not exists ticket_feedback (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  author_role app_role,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_feedback_ticket on ticket_feedback(ticket_id);

-- ---------- ticket_photos & feedback_photos ----------
-- Ticket photos: added only while the logger can still edit (status 'create')
-- or by a trustee. Feedback photos: evidence attached to a feedback entry.
create table if not exists ticket_photos (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references tickets(id) on delete cascade,
  storage_path text not null,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ticket_photos on ticket_photos(ticket_id);

create table if not exists feedback_photos (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references ticket_feedback(id) on delete cascade,
  storage_path text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_feedback_photos on feedback_photos(feedback_id);

-- ============================================================
--  Helper: does the current user hold `role` on `unit`?
--  Used to decide "a ticket assigned to role X is actionable by me".
-- ============================================================
create or replace function has_unit_role(target_unit uuid, target_role app_role)
returns boolean language sql security definer set search_path = public as $$
  select case target_role
    when 'trustee' then is_trustee()
    when 'owner'   then is_unit_owner(target_unit)
    when 'tenant'  then is_unit_tenant(target_unit)
    when 'occupant' then exists (
      select 1 from occupants o
      where o.unit_id = target_unit and o.profile_id = auth.uid() and o.active)
      or exists (select 1 from unit_members m
        where m.unit_id = target_unit and m.profile_id = auth.uid() and m.relation = 'occupant')
    when 'gardener' then is_unit_assignee(target_unit)
    when 'service_provider' then is_unit_assignee(target_unit)
    else false end;
$$;

-- True if the user may SEE this ticket at all.
--  trustee: all
--  owner/tenant/occupant: any ticket on a unit they belong to
--  gardener/service_provider: only while the ticket is assigned to their role
--  logger: always their own
create or replace function can_see_ticket(t_unit uuid, t_status ticket_status,
                                          t_assigned app_role, t_logger uuid)
returns boolean language sql security definer set search_path = public as $$
  select
    is_trustee()
    or t_logger = auth.uid()
    or is_unit_owner(t_unit)
    or is_unit_tenant(t_unit)
    or exists (                                   -- occupant of the unit
      select 1 from occupants o
      where o.unit_id = t_unit and o.profile_id = auth.uid() and o.active)
    or ( t_assigned in ('gardener','service_provider')
         and is_unit_assignee(t_unit) );
$$;

-- ============================================================
--  RLS
-- ============================================================
alter table ticket_types     enable row level security;
alter table tickets          enable row level security;
alter table ticket_feedback  enable row level security;
alter table ticket_photos    enable row level security;
alter table feedback_photos  enable row level security;

-- ticket_types: everyone signed in reads; trustees manage.
drop policy if exists "read types" on ticket_types;
create policy "read types" on ticket_types for select using ( auth.uid() is not null );
drop policy if exists "trustee writes types" on ticket_types;
create policy "trustee writes types" on ticket_types for all
  using ( is_trustee() ) with check ( is_trustee() );

-- tickets:
--  read  -> can_see_ticket(...)
--  insert-> any signed-in member/assignee of the unit (logger = self)
--  update-> trustee anytime; logger ONLY while status = 'create'
--  delete-> trustee; logger ONLY while status = 'create'
drop policy if exists "read tickets" on tickets;
create policy "read tickets" on tickets for select
  using ( can_see_ticket(unit_id, status, assigned_role, logged_by) );

drop policy if exists "insert tickets" on tickets;
create policy "insert tickets" on tickets for insert
  with check (
    logged_by = auth.uid() and (
      is_trustee() or is_unit_owner(unit_id) or is_unit_tenant(unit_id)
      or is_unit_assignee(unit_id)
      or exists (select 1 from occupants o
                 where o.unit_id = unit_id and o.profile_id = auth.uid() and o.active)
    )
  );

drop policy if exists "update tickets" on tickets;
create policy "update tickets" on tickets for update
  using ( is_trustee() or (logged_by = auth.uid() and status = 'create') )
  with check ( is_trustee() or (logged_by = auth.uid() and status = 'create') );

drop policy if exists "delete tickets" on tickets;
create policy "delete tickets" on tickets for delete
  using ( is_trustee() or (logged_by = auth.uid() and status = 'create') );

-- ticket_feedback:
--  read  -> if you can see the parent ticket
--  insert-> if you can see the parent ticket (author = self)
--  (feedback is immutable; no update/delete except trustee cleanup)
drop policy if exists "read feedback" on ticket_feedback;
create policy "read feedback" on ticket_feedback for select
  using ( exists (select 1 from tickets t where t.id = ticket_id
          and can_see_ticket(t.unit_id, t.status, t.assigned_role, t.logged_by)) );

drop policy if exists "insert feedback" on ticket_feedback;
create policy "insert feedback" on ticket_feedback for insert
  with check ( author_id = auth.uid() and exists (
    select 1 from tickets t where t.id = ticket_id
    and can_see_ticket(t.unit_id, t.status, t.assigned_role, t.logged_by)) );

drop policy if exists "trustee deletes feedback" on ticket_feedback;
create policy "trustee deletes feedback" on ticket_feedback for delete
  using ( is_trustee() );

-- ticket_photos: read if can see ticket; write if trustee or (logger & create).
drop policy if exists "read ticket photos" on ticket_photos;
create policy "read ticket photos" on ticket_photos for select
  using ( exists (select 1 from tickets t where t.id = ticket_id
          and can_see_ticket(t.unit_id, t.status, t.assigned_role, t.logged_by)) );

drop policy if exists "write ticket photos" on ticket_photos;
create policy "write ticket photos" on ticket_photos for insert
  with check ( exists (select 1 from tickets t where t.id = ticket_id
    and ( is_trustee() or (t.logged_by = auth.uid() and t.status = 'create') )) );

drop policy if exists "delete ticket photos" on ticket_photos;
create policy "delete ticket photos" on ticket_photos for delete
  using ( exists (select 1 from tickets t where t.id = ticket_id
    and ( is_trustee() or (t.logged_by = auth.uid() and t.status = 'create') )) );

-- feedback_photos: read if can see the ticket; insert if you can see the ticket.
drop policy if exists "read feedback photos" on feedback_photos;
create policy "read feedback photos" on feedback_photos for select
  using ( exists (
    select 1 from ticket_feedback f join tickets t on t.id = f.ticket_id
    where f.id = feedback_id
    and can_see_ticket(t.unit_id, t.status, t.assigned_role, t.logged_by)) );

drop policy if exists "insert feedback photos" on feedback_photos;
create policy "insert feedback photos" on feedback_photos for insert
  with check ( exists (
    select 1 from ticket_feedback f join tickets t on t.id = f.ticket_id
    where f.id = feedback_id
    and can_see_ticket(t.unit_id, t.status, t.assigned_role, t.logged_by)) );
