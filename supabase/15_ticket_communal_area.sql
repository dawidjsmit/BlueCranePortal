-- ============================================================
--  Blue Crane Vistas Portal — Tickets: Unit OR Communal Area (PR 2)
--
--  A ticket is now about EITHER a unit OR a communal area — exactly one.
--  Makes unit_id nullable, adds communal_area_id, and a CHECK enforcing
--  "exactly one of the two". Updates can_see_ticket() so communal-area
--  tickets are visible to trustees, the logger, and the routed role.
--
--  Run AFTER 14_communal_areas.sql.
-- ============================================================

-- 1) Allow tickets without a unit, and add the communal-area link.
alter table tickets alter column unit_id drop not null;
alter table tickets
  add column if not exists communal_area_id uuid references communal_areas(id) on delete cascade;

create index if not exists idx_tickets_area on tickets(communal_area_id);

-- 2) Enforce exactly one of unit_id / communal_area_id.
--    (num_nonnulls returns how many of the args are NOT NULL.)
alter table tickets drop constraint if exists ticket_target_exactly_one;
alter table tickets
  add constraint ticket_target_exactly_one
  check ( num_nonnulls(unit_id, communal_area_id) = 1 );

-- 3) Update visibility: a communal-area ticket (unit_id IS NULL) is
--    visible to trustees, the logger, and anyone holding the assigned
--    role. Unit tickets keep their existing rule.
create or replace function can_see_ticket(t_unit uuid, t_status ticket_status,
                                          t_assigned app_role, t_logger uuid)
returns boolean language sql security definer set search_path = public as $$
  select
    is_trustee()
    or t_logger = auth.uid()
    or (
      t_unit is not null and (
        is_unit_owner(t_unit)
        or is_unit_tenant(t_unit)
        or exists (select 1 from occupants o
                   where o.unit_id = t_unit and o.profile_id = auth.uid() and o.active)
      )
    )
    -- gardeners / service providers see tickets assigned to their role
    -- (works for both unit and communal-area tickets)
    or ( t_assigned in ('gardener','service_provider') and t_assigned = my_role() );
$$;

-- NOTE: can_see_ticket is called with the ticket's unit_id (may be NULL for
-- communal-area tickets) — the policies below already pass t.unit_id, which
-- is fine because the function now null-guards it.
