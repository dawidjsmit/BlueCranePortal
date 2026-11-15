-- ============================================================
--  Blue Crane Vistas Portal — 10 Year Plan (trustee-only)
--
--  Plan items: name, description, year, budget amount, actual spend
--  amount, optional communal
--  entity grouping, a status (managed list: name + description), and zero
--  or more linked projects.
--
--  The app shows them as a matrix: one row per grouping, one column per
--  year (this year + the next 9).
--
--  Run AFTER 29_projects.sql.  Safe to re-run.
-- ============================================================

-- 1) Plan item statuses (managed list).
create table if not exists plan_statuses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);
insert into plan_statuses (name, description) values
  ('Planned',     'On the plan for that year'),
  ('In progress', 'Work has started'),
  ('Done',        'Achieved in the planned year'),
  ('Postponed',   'Not achieved in the planned year; a new item is added in a later year'),
  ('Cancelled',   'Will not go ahead')
on conflict (name) do nothing;

-- 2) Plan items.
create table if not exists plan_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  year        int  not null check (year between 2000 and 2200),
  budget      numeric(12,2) not null default 0 check (budget >= 0),
  actual_spend numeric(12,2) not null default 0 check (actual_spend >= 0),
  group_id    uuid references communal_area_groups(id) on delete set null,
  status_id   uuid not null references plan_statuses(id),
  created_at  timestamptz not null default now()
);
-- (for anyone who ran an earlier version of this script)
alter table plan_items add column if not exists actual_spend numeric(12,2) not null default 0 check (actual_spend >= 0);
create index if not exists idx_plan_items_year on plan_items(year);

-- 3) Projects linked to a plan item (a project can serve more than one item,
--    e.g. a postponed item and its replacement).
create table if not exists plan_item_projects (
  plan_item_id uuid not null references plan_items(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  primary key (plan_item_id, project_id)
);

-- 4) Trustee-only access.
alter table plan_statuses      enable row level security;
alter table plan_items         enable row level security;
alter table plan_item_projects enable row level security;

drop policy if exists "trustees manage plan statuses" on plan_statuses;
create policy "trustees manage plan statuses" on plan_statuses for all
  using ( is_trustee() ) with check ( is_trustee() );
drop policy if exists "trustees manage plan items" on plan_items;
create policy "trustees manage plan items" on plan_items for all
  using ( is_trustee() ) with check ( is_trustee() );
drop policy if exists "trustees manage plan item projects" on plan_item_projects;
create policy "trustees manage plan item projects" on plan_item_projects for all
  using ( is_trustee() ) with check ( is_trustee() );

-- 5) Save a plan item and its projects in one go (all or nothing).
--    (Removes the earlier version without the actual spend amount.)
drop function if exists save_plan_item(uuid, text, text, int, numeric, uuid, uuid, uuid[]);
--    Runs as the caller, so the trustee-only rules above still apply.
create or replace function save_plan_item(
  p_id          uuid,
  p_name        text,
  p_description text,
  p_year        int,
  p_budget      numeric,
  p_actual      numeric,
  p_group       uuid,
  p_status      uuid,
  p_projects    uuid[]
) returns uuid language plpgsql set search_path = public as $$
declare
  pid uuid := p_id;
begin
  if not is_trustee() then
    raise exception 'Only a trustee can save plan items.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Please enter the plan item name.';
  end if;

  if pid is null then
    insert into plan_items (name, description, year, budget, actual_spend, group_id, status_id)
    values (trim(p_name), nullif(trim(p_description), ''), p_year, coalesce(p_budget, 0), coalesce(p_actual, 0), p_group, p_status)
    returning id into pid;
  else
    update plan_items set
      name = trim(p_name), description = nullif(trim(p_description), ''),
      year = p_year, budget = coalesce(p_budget, 0), actual_spend = coalesce(p_actual, 0), group_id = p_group, status_id = p_status
    where id = pid;
    if not found then raise exception 'That plan item no longer exists.'; end if;
  end if;

  delete from plan_item_projects where plan_item_id = pid;
  insert into plan_item_projects (plan_item_id, project_id)
    select pid, x from unnest(coalesce(p_projects, '{}')) as x group by x;
  return pid;
end;
$$;

revoke all on function save_plan_item(uuid, text, text, int, numeric, numeric, uuid, uuid, uuid[]) from public;
grant execute on function save_plan_item(uuid, text, text, int, numeric, numeric, uuid, uuid, uuid[]) to authenticated;
