-- ============================================================
--  Blue Crane Vistas Portal — "Helper" trustees
--
--  A flag on the Trustee registry record. A helper trustee is a full
--  trustee in every way (same role, same access); the app only shows a
--  🤝 Helper badge next to their name. If helpers are ever to be limited,
--  is_helper_trustee() is ready for that.
--
--  Run AFTER 39_dashboard_news.sql.  Safe to re-run.
-- ============================================================

alter table trustees add column if not exists is_helper boolean not null default false;

-- Is this user (default: me) a helper trustee?
create or replace function is_helper_trustee(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from trustees where profile_id = p_user and is_helper);
$$;

-- Which users are helper trustees (so everyone sees the badge, e.g. in a
-- ticket's feedback history). Only user ids — no other registry details.
create or replace function helper_trustee_ids()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(profile_id), '[]'::json)
  from trustees where is_helper and profile_id is not null;
$$;

revoke all on function is_helper_trustee(uuid) from public;
revoke all on function helper_trustee_ids() from public;
grant execute on function is_helper_trustee(uuid) to authenticated;
grant execute on function helper_trustee_ids() to authenticated;
