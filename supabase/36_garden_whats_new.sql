-- ============================================================
--  Blue Crane Vistas Portal — "what's new" on the Gardening Report
--
--  Remembers, per user, when they last opened the Gardening Report and
--  when they last opened each report line's comments. From that the app
--  shows 🆕 on new lines, "💬 new" on lines with new comments, a
--  "since your last visit" note, and a box on the Dashboard.
--  Your own lines and comments never count as new for you.
--
--  Run AFTER 35_gardening_report.sql.  Safe to re-run.
-- ============================================================

create table if not exists garden_seen (
  profile_id    uuid primary key references profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create table if not exists garden_report_seen (
  profile_id uuid not null references profiles(id) on delete cascade,
  report_id  uuid not null references garden_reports(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (profile_id, report_id)
);

alter table garden_seen        enable row level security;
alter table garden_report_seen enable row level security;
drop policy if exists "own garden seen" on garden_seen;
create policy "own garden seen" on garden_seen for select using ( profile_id = auth.uid() );
drop policy if exists "own garden report seen" on garden_report_seen;
create policy "own garden report seen" on garden_report_seen for select using ( profile_id = auth.uid() );

-- Counts of new lines / comments for the current user since p_since.
-- A line's comments count from when you last opened them (or p_baseline).
create or replace function garden_new_counts(p_since timestamptz, p_baseline timestamptz)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'new_lines', (select count(*) from garden_reports r
                  where r.created_at > p_since and r.created_by is distinct from auth.uid()),
    'new_comments', (select count(*) from garden_report_comments c
                     left join garden_report_seen s on s.report_id = c.report_id and s.profile_id = auth.uid()
                     where c.author_id is distinct from auth.uid()
                       and c.created_at > coalesce(s.seen_at, p_baseline)));
$$;

-- Dashboard: what's new since my last visit (changes nothing).
create or replace function garden_whats_new()
returns json language plpgsql stable security definer set search_path = public as $$
declare g garden_seen%rowtype;
begin
  if not can_garden() then return json_build_object('new_lines', 0, 'new_comments', 0); end if;
  select * into g from garden_seen where profile_id = auth.uid();
  if not found then return json_build_object('new_lines', 0, 'new_comments', 0); end if;
  return garden_new_counts(g.last_seen_at, g.first_seen_at);
end;
$$;

-- Opening the Gardening Report: returns what was new since the previous
-- visit (and when that was), then records this visit.
create or replace function garden_open_screen()
returns json language plpgsql security definer set search_path = public as $$
declare
  g garden_seen%rowtype;
  counts json;
begin
  if not can_garden() then raise exception 'Not allowed.'; end if;
  select * into g from garden_seen where profile_id = auth.uid();
  if not found then
    -- First visit ever: nothing is "new" yet.
    insert into garden_seen (profile_id) values (auth.uid()) returning * into g;
    return json_build_object('previous', g.last_seen_at, 'baseline', g.first_seen_at, 'new_lines', 0, 'new_comments', 0);
  end if;
  counts := garden_new_counts(g.last_seen_at, g.first_seen_at);
  update garden_seen set last_seen_at = now() where profile_id = auth.uid();
  return json_build_object('previous', g.last_seen_at, 'baseline', g.first_seen_at,
                           'new_lines', counts->'new_lines', 'new_comments', counts->'new_comments');
end;
$$;

-- Opening a line's comments marks them as read for me.
create or replace function garden_mark_report_seen(p_report uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_garden() then return; end if;
  insert into garden_report_seen (profile_id, report_id, seen_at) values (auth.uid(), p_report, now())
  on conflict (profile_id, report_id) do update set seen_at = excluded.seen_at;
end;
$$;

revoke all on function garden_new_counts(timestamptz, timestamptz) from public;
revoke all on function garden_whats_new() from public;
revoke all on function garden_open_screen() from public;
revoke all on function garden_mark_report_seen(uuid) from public;
grant execute on function garden_whats_new() to authenticated;
grant execute on function garden_open_screen() to authenticated;
grant execute on function garden_mark_report_seen(uuid) to authenticated;
