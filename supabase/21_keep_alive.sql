-- ============================================================
--  Blue Crane Vistas Portal — keep-alive for the free Supabase plan
--
--  Free projects pause after about a week with no DATABASE activity.
--  A GitHub Actions workflow (.github/workflows/keep-alive.yml) reads this
--  table once a day, which counts as activity and stops the pausing.
--
--  The table holds one harmless row and nothing else. It is readable with
--  the public (anon) key so the workflow needs no secret. Nobody can write.
--
--  Run once. Safe to re-run.
-- ============================================================

create table if not exists keep_alive (
  id    int primary key,
  note  text not null
);

insert into keep_alive (id, note)
values (1, 'Read daily by a scheduled job to keep the project awake.')
on conflict (id) do nothing;

alter table keep_alive enable row level security;

drop policy if exists "anyone can read keep_alive" on keep_alive;
create policy "anyone can read keep_alive" on keep_alive for select
  using ( true );

-- The anon role needs table-level read rights for the policy to apply.
grant select on keep_alive to anon, authenticated;
