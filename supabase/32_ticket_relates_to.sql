-- ============================================================
--  Blue Crane Vistas Portal — what a ticket relates to
--
--  A ticket now relates to a Unit, a Communal entity, or neither
--  (never both). Before, it had to be exactly one of the two.
--
--  Also fixes who may LOG a ticket. The old rule only let non-trustees
--  log a ticket for a unit they belong to, so residents, gardeners and
--  service providers could not log a communal-entity ticket (or, now, a
--  general one). New rule: any approved, active user may log a ticket in
--  their own name, about any unit, any communal entity, or nothing
--  specific (the form already lets them pick any unit). Who can SEE a
--  ticket is unchanged.
--
--  Run AFTER 31_plan_item_type.sql.  Safe to re-run.
-- ============================================================

-- 1) Unit, communal entity, or neither — never both.
alter table tickets drop constraint if exists ticket_target_exactly_one;
alter table tickets drop constraint if exists ticket_target_at_most_one;
alter table tickets
  add constraint ticket_target_at_most_one
  check ( num_nonnulls(unit_id, communal_area_id) <= 1 );

-- 2) Who may log a ticket.
drop policy if exists "insert tickets" on tickets;
create policy "insert tickets" on tickets for insert
  with check (
    logged_by = auth.uid()
    and exists (select 1 from profiles p
                where p.id = auth.uid()
                  and p.status = 'approved'
                  and p.deactivated_at is null)
  );
