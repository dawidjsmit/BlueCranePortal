-- ============================================================
--  Blue Crane Vistas Portal — "Ask the rules" question log
--
--  Saves each AI question + answer per user, so:
--   - a user sees their own history (avoid re-asking),
--   - trustees can see engagement across all users.
--
--  Run AFTER 15_ticket_communal_area.sql.
-- ============================================================

create table if not exists rule_questions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  question    text not null,
  answer      text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_rule_questions_user on rule_questions(user_id, created_at desc);
create index if not exists idx_rule_questions_time on rule_questions(created_at desc);

alter table rule_questions enable row level security;

-- Read: a user sees their own; trustees see all.
drop policy if exists "read own or trustee all qs" on rule_questions;
create policy "read own or trustee all qs" on rule_questions for select
  using ( user_id = auth.uid() or is_trustee() );

-- Insert: a user may log their own question rows.
drop policy if exists "insert own qs" on rule_questions;
create policy "insert own qs" on rule_questions for insert
  with check ( user_id = auth.uid() );

-- Update: a user may update their own row (used to save the answer
-- after the AI responds). Trustees may update too.
drop policy if exists "update own qs" on rule_questions;
create policy "update own qs" on rule_questions for update
  using ( user_id = auth.uid() or is_trustee() )
  with check ( user_id = auth.uid() or is_trustee() );

-- Delete: trustees only (cleanup).
drop policy if exists "trustee deletes qs" on rule_questions;
create policy "trustee deletes qs" on rule_questions for delete
  using ( is_trustee() );
