-- ============================================================
--  Blue Crane Vistas Portal — Projects (trustee-only registry)
--
--  A project has: name, description, create date (automatic), start date,
--  optional due and finish dates, a status (managed list, like ticket
--  types), and an optional "run by" trustee.
--  It can be linked to zero or more service providers, units and communal
--  entities. A ticket can belong to one project (optional).
--
--  Everything here is visible to trustees only. Only trustees can put a
--  ticket into a project (or take it out).
--
--  Run AFTER 28_communal_entity_groupings.sql.  Safe to re-run.
-- ============================================================

-- 1) Project statuses (managed list).
create table if not exists project_statuses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into project_statuses (name, description) values
  ('Planned',     'Agreed, not started yet'),
  ('In progress', 'Work is under way'),
  ('On hold',     'Paused for now'),
  ('Completed',   'Finished'),
  ('Cancelled',   'Will not go ahead')
on conflict (name) do nothing;

-- 2) Projects.
create table if not exists projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  status_id         uuid not null references project_statuses(id),
  start_date        date not null,
  due_date          date,
  finish_date       date,
  run_by_trustee_id uuid references trustees(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint projects_due_ok    check (due_date    is null or due_date    >= start_date),
  constraint projects_finish_ok check (finish_date is null or finish_date >= start_date)
);

-- 3) Links: service providers, units, communal entities.
create table if not exists project_providers (
  project_id  uuid not null references projects(id) on delete cascade,
  provider_id uuid not null references service_providers(id) on delete cascade,
  primary key (project_id, provider_id)
);
create table if not exists project_units (
  project_id uuid not null references projects(id) on delete cascade,
  unit_id    uuid not null references units(id) on delete cascade,
  primary key (project_id, unit_id)
);
create table if not exists project_areas (
  project_id uuid not null references projects(id) on delete cascade,
  area_id    uuid not null references communal_areas(id) on delete cascade,
  primary key (project_id, area_id)
);

-- 4) A ticket can belong to one project.
alter table tickets add column if not exists project_id uuid references projects(id) on delete set null;
create index if not exists idx_tickets_project on tickets(project_id);

-- Only trustees can put a ticket into a project or take it out.
create or replace function guard_ticket_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if ((tg_op = 'INSERT' and new.project_id is not null)
      or (tg_op = 'UPDATE' and new.project_id is distinct from old.project_id))
     and not is_trustee() then
    raise exception 'Only a trustee can link a ticket to a project.';
  end if;
  return new;
end;
$$;
drop trigger if exists tickets_guard_project on tickets;
create trigger tickets_guard_project
  before insert or update on tickets
  for each row execute function guard_ticket_project();

-- 5) Trustee-only access.
alter table project_statuses  enable row level security;
alter table projects          enable row level security;
alter table project_providers enable row level security;
alter table project_units     enable row level security;
alter table project_areas     enable row level security;

drop policy if exists "trustees manage project statuses" on project_statuses;
create policy "trustees manage project statuses" on project_statuses for all
  using ( is_trustee() ) with check ( is_trustee() );
drop policy if exists "trustees manage projects" on projects;
create policy "trustees manage projects" on projects for all
  using ( is_trustee() ) with check ( is_trustee() );
drop policy if exists "trustees manage project providers" on project_providers;
create policy "trustees manage project providers" on project_providers for all
  using ( is_trustee() ) with check ( is_trustee() );
drop policy if exists "trustees manage project units" on project_units;
create policy "trustees manage project units" on project_units for all
  using ( is_trustee() ) with check ( is_trustee() );
drop policy if exists "trustees manage project areas" on project_areas;
create policy "trustees manage project areas" on project_areas for all
  using ( is_trustee() ) with check ( is_trustee() );

-- 6) Save a project and its links in one go (all or nothing).
--    Runs as the caller, so the trustee-only rules above still apply.
create or replace function save_project(
  p_id          uuid,
  p_name        text,
  p_description text,
  p_status      uuid,
  p_start       date,
  p_due         date,
  p_finish      date,
  p_trustee     uuid,
  p_units       uuid[],
  p_areas       uuid[],
  p_providers   uuid[]
) returns uuid language plpgsql set search_path = public as $$
declare
  pid uuid := p_id;
begin
  if not is_trustee() then
    raise exception 'Only a trustee can save projects.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Please enter the project name.';
  end if;

  if pid is null then
    insert into projects (name, description, status_id, start_date, due_date, finish_date, run_by_trustee_id)
    values (trim(p_name), nullif(trim(p_description), ''), p_status, p_start, p_due, p_finish, p_trustee)
    returning id into pid;
  else
    update projects set
      name = trim(p_name), description = nullif(trim(p_description), ''),
      status_id = p_status, start_date = p_start, due_date = p_due,
      finish_date = p_finish, run_by_trustee_id = p_trustee
    where id = pid;
    if not found then raise exception 'That project no longer exists.'; end if;
  end if;

  delete from project_units     where project_id = pid;
  delete from project_areas     where project_id = pid;
  delete from project_providers where project_id = pid;
  insert into project_units (project_id, unit_id)
    select pid, x from unnest(coalesce(p_units, '{}')) as x group by x;
  insert into project_areas (project_id, area_id)
    select pid, x from unnest(coalesce(p_areas, '{}')) as x group by x;
  insert into project_providers (project_id, provider_id)
    select pid, x from unnest(coalesce(p_providers, '{}')) as x group by x;
  return pid;
end;
$$;

revoke all on function save_project(uuid, text, text, uuid, date, date, date, uuid, uuid[], uuid[], uuid[]) from public;
grant execute on function save_project(uuid, text, text, uuid, date, date, date, uuid, uuid[], uuid[], uuid[]) to authenticated;
