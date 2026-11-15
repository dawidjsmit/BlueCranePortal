-- ============================================================
--  Blue Crane Vistas Portal — communal entity groupings
--
--  A managed list of groupings (name + description). Each communal entity
--  type can belong to one grouping (optional). Wherever a type is chosen,
--  the app shows "Grouping – Type".
--
--  Read: any signed-in user (needed when logging a ticket). Write: trustees.
--  Run AFTER 27_drop_type_sort_order.sql.  Safe to re-run.
-- ============================================================

create table if not exists communal_area_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

alter table communal_area_types
  add column if not exists group_id uuid references communal_area_groups(id) on delete set null;

alter table communal_area_groups enable row level security;
drop policy if exists "read area groups" on communal_area_groups;
create policy "read area groups" on communal_area_groups for select
  using ( auth.uid() is not null );
drop policy if exists "trustee writes area groups" on communal_area_groups;
create policy "trustee writes area groups" on communal_area_groups for all
  using ( is_trustee() ) with check ( is_trustee() );
