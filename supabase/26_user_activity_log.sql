-- ============================================================
--  Blue Crane Vistas Portal — user activity log (log-ins for now)
--
--  Every successful sign-in (password or magic link) is recorded by the
--  database itself: Supabase updates auth.users.last_sign_in_at on each
--  sign-in, and a trigger copies that into user_activity. The app can't
--  fake or skip it.
--
--  Only trustees can read the log. Nobody can edit or delete it from the app.
--  Later, other activity types can be added to the same table.
--
--  Run AFTER 25_deactivate_users.sql.  Safe to re-run.
-- ============================================================

-- 1) The log.
create table if not exists user_activity (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  activity    text not null default 'login',
  occurred_at timestamptz not null default now()
);
create index if not exists user_activity_occurred_idx on user_activity (occurred_at desc);
create index if not exists user_activity_profile_idx  on user_activity (profile_id, occurred_at desc);

-- 2) Trustees can read it. No insert/update/delete policies: only the
--    trigger below (running as the database owner) writes to it.
alter table user_activity enable row level security;
drop policy if exists "trustees read user activity" on user_activity;
create policy "trustees read user activity"
  on user_activity for select using (is_trustee());

-- 3) Record each sign-in.
create or replace function log_user_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is not null
     and new.last_sign_in_at is distinct from old.last_sign_in_at
     and exists (select 1 from profiles where id = new.id) then
    insert into user_activity (profile_id, activity, occurred_at)
    values (new.id, 'login', new.last_sign_in_at);
  end if;
  return new;
exception when others then
  -- Logging must never stop someone from signing in.
  return new;
end;
$$;

drop trigger if exists on_auth_user_login on auth.users;
create trigger on_auth_user_login
  after update of last_sign_in_at on auth.users
  for each row execute function log_user_login();

-- 4) Start the log with each user's most recent sign-in (so "Last log in"
--    is filled in from day one). Skipped if already there.
insert into user_activity (profile_id, activity, occurred_at)
select u.id, 'login', u.last_sign_in_at
from auth.users u
join profiles p on p.id = u.id
where u.last_sign_in_at is not null
  and not exists (select 1 from user_activity a
                  where a.profile_id = u.id and a.activity = 'login'
                    and a.occurred_at = u.last_sign_in_at);

-- 5) Last log-in per user, for the Users screen (respects the policy above).
create or replace view user_last_login with (security_invoker = true) as
  select profile_id, max(occurred_at) as last_login
  from user_activity
  where activity = 'login'
  group by profile_id;
grant select on user_last_login to authenticated;
