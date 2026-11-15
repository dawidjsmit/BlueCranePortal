-- ============================================================
--  Blue Crane Vistas Portal — Gardening Report
--
--  Gardeners report what they did, without tickets. Each report line has:
--  action date, gardening task (managed list), optional description, one
--  or more gardeners, zero or more units, zero or more communal entities,
--  and a conversation of comments.
--
--  Rules (enforced here):
--    * trustees and active gardeners can see and add report lines;
--    * no lines for a future date;
--    * a line for a past date is marked "captured late";
--    * gardeners can edit/delete only today's lines that were not captured
--      late (and can't change their date); trustees can edit/delete any;
--    * trustees and gardeners can comment; authors can edit their comments.
--
--  "Today" is South African time.
--  Run AFTER 34_feedback_keeps_parked.sql.  Safe to re-run.
-- ============================================================

-- ---------- helpers ----------
create or replace function sa_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Johannesburg')::date;
$$;

create or replace function is_active_gardener()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and role = 'gardener'
                   and status = 'approved' and deactivated_at is null);
$$;

create or replace function can_garden()
returns boolean language sql stable security definer set search_path = public as $$
  select is_trustee() or is_active_gardener();
$$;

-- ---------- tables ----------
create table if not exists gardening_tasks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);
insert into gardening_tasks (name, description) values
  ('Cut grass',        'Mow and edge the lawn'),
  ('Weed flower beds', 'Remove weeds from beds and borders'),
  ('Water',            'Water plants, beds and lawns'),
  ('Trim hedges',      'Trim hedges and shrubs'),
  ('Clean up',         'Sweep paths and remove garden refuse')
on conflict (name) do nothing;

create table if not exists garden_reports (
  id              uuid primary key default gen_random_uuid(),
  action_date     date not null,
  task_id         uuid not null references gardening_tasks(id),
  description     text,
  captured_late   boolean not null default false,
  created_by      uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create index if not exists idx_garden_reports_date on garden_reports(action_date desc);

create table if not exists garden_report_gardeners (
  report_id   uuid not null references garden_reports(id) on delete cascade,
  gardener_id uuid not null references gardeners(id) on delete cascade,
  primary key (report_id, gardener_id)
);
create table if not exists garden_report_units (
  report_id uuid not null references garden_reports(id) on delete cascade,
  unit_id   uuid not null references units(id) on delete cascade,
  primary key (report_id, unit_id)
);
create table if not exists garden_report_areas (
  report_id uuid not null references garden_reports(id) on delete cascade,
  area_id   uuid not null references communal_areas(id) on delete cascade,
  primary key (report_id, area_id)
);
create table if not exists garden_report_comments (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references garden_reports(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  author_name text,
  author_role app_role,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create index if not exists idx_garden_comments_report on garden_report_comments(report_id);

-- Comment author is always the signed-in user (name/role filled in here).
create or replace function garden_comment_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    select coalesce(nullif(trim(full_name), ''), email), role
      into new.author_name, new.author_role
      from profiles where id = auth.uid();
    new.created_at := now();
    new.updated_at := null;
  else
    new.author_id := old.author_id; new.author_name := old.author_name;
    new.author_role := old.author_role; new.report_id := old.report_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists garden_comment_author on garden_report_comments;
create trigger garden_comment_author before insert or update on garden_report_comments
  for each row execute function garden_comment_author();

-- ---------- access ----------
alter table gardening_tasks         enable row level security;
alter table garden_reports          enable row level security;
alter table garden_report_gardeners enable row level security;
alter table garden_report_units     enable row level security;
alter table garden_report_areas     enable row level security;
alter table garden_report_comments  enable row level security;

drop policy if exists "garden read tasks" on gardening_tasks;
create policy "garden read tasks" on gardening_tasks for select using ( can_garden() );
drop policy if exists "trustees write tasks" on gardening_tasks;
create policy "trustees write tasks" on gardening_tasks for all
  using ( is_trustee() ) with check ( is_trustee() );

-- Report lines and their links: read here; written only by the functions below.
drop policy if exists "garden read reports" on garden_reports;
create policy "garden read reports" on garden_reports for select using ( can_garden() );
drop policy if exists "garden read report gardeners" on garden_report_gardeners;
create policy "garden read report gardeners" on garden_report_gardeners for select using ( can_garden() );
drop policy if exists "garden read report units" on garden_report_units;
create policy "garden read report units" on garden_report_units for select using ( can_garden() );
drop policy if exists "garden read report areas" on garden_report_areas;
create policy "garden read report areas" on garden_report_areas for select using ( can_garden() );

drop policy if exists "garden read comments" on garden_report_comments;
create policy "garden read comments" on garden_report_comments for select using ( can_garden() );
drop policy if exists "garden add comments" on garden_report_comments;
create policy "garden add comments" on garden_report_comments for insert with check ( can_garden() );
drop policy if exists "garden edit own comments" on garden_report_comments;
create policy "garden edit own comments" on garden_report_comments for update
  using ( can_garden() and author_id = auth.uid() ) with check ( can_garden() and author_id = auth.uid() );

-- ---------- lists the screen needs (units + gardener names) ----------
-- Gardeners can't read the full unit or gardener registries (personal
-- details), so this returns just what the report form needs.
create or replace function garden_lookups()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not can_garden() then raise exception 'Not allowed.'; end if;
  return json_build_object(
    'units', coalesce((select json_agg(json_build_object('id', id, 'number', number) order by number) from units), '[]'),
    'gardeners', coalesce((select json_agg(json_build_object(
        'id', id, 'name', trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')),
        'current', (service_end is null or service_end >= sa_today()),
        'profile_id', profile_id) order by first_name, last_name) from gardeners), '[]'));
end;
$$;

-- ---------- may the current user edit / delete this line? ----------
create or replace function can_edit_garden_report(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_trustee() or (is_active_gardener() and exists (
    select 1 from garden_reports r
    where r.id = p_id and r.action_date = sa_today() and not r.captured_late));
$$;

-- ---------- add lines (one per task) or edit one line ----------
create or replace function save_garden_reports(
  p_id          uuid,
  p_date        date,
  p_tasks       uuid[],
  p_description text,
  p_gardeners   uuid[],
  p_units       uuid[],
  p_areas       uuid[]
) returns int language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  task uuid;
  n int := 0;
  me_name text;
  old_date date;
begin
  if not can_garden() then raise exception 'Only trustees and gardeners can capture the gardening report.'; end if;
  if p_date is null then raise exception 'Please choose the action date.'; end if;
  if p_date > sa_today() then raise exception 'You can''t report work for a future date.'; end if;
  if coalesce(array_length(p_tasks, 1), 0) = 0 then raise exception 'Please choose at least one gardening task.'; end if;
  if coalesce(array_length(p_gardeners, 1), 0) = 0 then raise exception 'Please choose at least one gardener.'; end if;

  if p_id is not null then
    if array_length(p_tasks, 1) <> 1 then raise exception 'A report line has exactly one task.'; end if;
    if not can_edit_garden_report(p_id) then
      raise exception 'This report line can no longer be changed (only today''s lines can be edited).';
    end if;
    select action_date into old_date from garden_reports where id = p_id;
    if not is_trustee() and p_date <> old_date then
      raise exception 'Only a trustee can change the date of a report line.';
    end if;
    update garden_reports set action_date = p_date, task_id = p_tasks[1],
      description = nullif(trim(p_description), ''), updated_at = now()
      where id = p_id;
    delete from garden_report_gardeners where report_id = p_id;
    delete from garden_report_units     where report_id = p_id;
    delete from garden_report_areas     where report_id = p_id;
    insert into garden_report_gardeners select p_id, x from unnest(p_gardeners) x group by x;
    insert into garden_report_units     select p_id, x from unnest(coalesce(p_units, '{}')) x group by x;
    insert into garden_report_areas     select p_id, x from unnest(coalesce(p_areas, '{}')) x group by x;
    return 1;
  end if;

  select coalesce(nullif(trim(full_name), ''), email) into me_name from profiles where id = auth.uid();
  foreach task in array (select array_agg(distinct t) from unnest(p_tasks) t) loop
    insert into garden_reports (action_date, task_id, description, captured_late, created_by, created_by_name)
    values (p_date, task, nullif(trim(p_description), ''), p_date < sa_today(), auth.uid(), me_name)
    returning id into rid;
    insert into garden_report_gardeners select rid, x from unnest(p_gardeners) x group by x;
    insert into garden_report_units     select rid, x from unnest(coalesce(p_units, '{}')) x group by x;
    insert into garden_report_areas     select rid, x from unnest(coalesce(p_areas, '{}')) x group by x;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function delete_garden_report(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit_garden_report(p_id) then
    raise exception 'This report line can no longer be deleted (only today''s lines can be deleted).';
  end if;
  delete from garden_reports where id = p_id;
end;
$$;

revoke all on function garden_lookups() from public;
revoke all on function can_edit_garden_report(uuid) from public;
revoke all on function save_garden_reports(uuid, date, uuid[], text, uuid[], uuid[], uuid[]) from public;
revoke all on function delete_garden_report(uuid) from public;
grant execute on function garden_lookups() to authenticated;
grant execute on function can_edit_garden_report(uuid) to authenticated;
grant execute on function save_garden_reports(uuid, date, uuid[], text, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function delete_garden_report(uuid) to authenticated;
