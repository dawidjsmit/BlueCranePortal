-- ============================================================
--  Blue Crane Vistas Portal — Dashboard "what's new"
--
--  Lets the Dashboard point people at what happened since they last looked:
--    * tickets that newly ARRIVED in their Needs my Feedback (moved to their
--      role, or came back to Sent/Busy/Waiting) and that they haven't opened;
--    * NEW COMMENTS by others on tickets they have a stake in (tickets they
--      logged or are the assigned user of; trustees: every ticket) that they
--      haven't opened since;
--    * trustees: new sign-ins on User activity and new AI questions since
--      they last opened those screens.
--  Opening a ticket marks it as seen. Your own actions never count as new.
--  Nothing counts as new from before this script was first used.
--
--  Run AFTER 38_ticket_assign_rules.sql.  Safe to re-run.
-- ============================================================

-- 1) When a ticket last landed in a role's queue.
alter table tickets add column if not exists arrived_at timestamptz;
update tickets set arrived_at = coalesce(updated_at, created_at) where arrived_at is null;

create or replace function set_ticket_arrived_at()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.arrived_at := now();
  elsif new.assigned_role is distinct from old.assigned_role
     or (new.status in ('sent', 'busy', 'waiting') and old.status not in ('sent', 'busy', 'waiting')) then
    new.arrived_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists tickets_set_arrived_at on tickets;
create trigger tickets_set_arrived_at before insert or update on tickets
  for each row execute function set_ticket_arrived_at();

-- 2) Per user: where "new" starts, which tickets they've opened, and when
--    they last opened certain screens.
create table if not exists user_news_baseline (
  profile_id uuid primary key references profiles(id) on delete cascade,
  since      timestamptz not null default now()
);
create table if not exists ticket_seen (
  profile_id uuid not null references profiles(id) on delete cascade,
  ticket_id  uuid not null references tickets(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (profile_id, ticket_id)
);
create table if not exists screen_seen (
  profile_id uuid not null references profiles(id) on delete cascade,
  screen     text not null,
  seen_at    timestamptz not null default now(),
  primary key (profile_id, screen)
);

alter table user_news_baseline enable row level security;
alter table ticket_seen        enable row level security;
alter table screen_seen        enable row level security;
drop policy if exists "own news baseline" on user_news_baseline;
create policy "own news baseline" on user_news_baseline for select using ( profile_id = auth.uid() );
drop policy if exists "own ticket seen" on ticket_seen;
create policy "own ticket seen" on ticket_seen for select using ( profile_id = auth.uid() );
drop policy if exists "own screen seen" on screen_seen;
create policy "own screen seen" on screen_seen for select using ( profile_id = auth.uid() );

-- 3) Ticket news for the Dashboard: my baseline, the tickets I've opened
--    (so the app can work out new arrivals), and new comments by others on
--    tickets I have a stake in.
create or replace function ticket_news()
returns json language plpgsql security definer set search_path = public as $$
declare
  b timestamptz;
  trustee boolean := is_trustee();
begin
  select since into b from user_news_baseline where profile_id = auth.uid();
  if not found then
    insert into user_news_baseline (profile_id) values (auth.uid()) returning since into b;
  end if;
  return json_build_object(
    'baseline', b,
    'seen', coalesce((select json_object_agg(ticket_id, seen_at) from ticket_seen where profile_id = auth.uid()), '{}'::json),
    'comments', coalesce((select json_agg(json_build_object('ticket_id', x.ticket_id, 'n', x.n)) from (
        select f.ticket_id, count(*) as n
        from ticket_feedback f
        join tickets t on t.id = f.ticket_id
        left join ticket_seen s on s.ticket_id = f.ticket_id and s.profile_id = auth.uid()
        where f.author_id is distinct from auth.uid()
          and f.created_at > greatest(b, coalesce(s.seen_at, b))
          and t.status <> 'create'
          and (trustee or t.logged_by = auth.uid() or t.assigned_user_id = auth.uid())
        group by f.ticket_id) x), '[]'::json));
end;
$$;

-- Opening a ticket marks it as seen for me.
create or replace function mark_ticket_seen(p_ticket uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into ticket_seen (profile_id, ticket_id, seen_at) values (auth.uid(), p_ticket, now())
  on conflict (profile_id, ticket_id) do update set seen_at = excluded.seen_at;
end;
$$;

-- 4) Trustees: new sign-ins (User activity) and new AI questions since I last
--    opened those screens. The first time, the clock starts now.
create or replace function screen_news()
returns json language plpgsql security definer set search_path = public as $$
declare a timestamptz; q timestamptz;
begin
  if not is_trustee() then return json_build_object('activity', 0, 'ai', 0); end if;
  insert into screen_seen (profile_id, screen) values (auth.uid(), 'activity'), (auth.uid(), 'aiengagement')
  on conflict do nothing;
  select seen_at into a from screen_seen where profile_id = auth.uid() and screen = 'activity';
  select seen_at into q from screen_seen where profile_id = auth.uid() and screen = 'aiengagement';
  return json_build_object(
    'activity', (select count(*) from user_activity where occurred_at > a and profile_id <> auth.uid()),
    'ai',       (select count(*) from rule_questions where created_at > q and user_id is distinct from auth.uid()));
end;
$$;

create or replace function mark_screen_seen(p_screen text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_screen not in ('activity', 'aiengagement') or not is_trustee() then return; end if;
  insert into screen_seen (profile_id, screen, seen_at) values (auth.uid(), p_screen, now())
  on conflict (profile_id, screen) do update set seen_at = excluded.seen_at;
end;
$$;

revoke all on function ticket_news() from public;
revoke all on function mark_ticket_seen(uuid) from public;
revoke all on function screen_news() from public;
revoke all on function mark_screen_seen(text) from public;
grant execute on function ticket_news() to authenticated;
grant execute on function mark_ticket_seen(uuid) to authenticated;
grant execute on function screen_news() to authenticated;
grant execute on function mark_screen_seen(text) to authenticated;
