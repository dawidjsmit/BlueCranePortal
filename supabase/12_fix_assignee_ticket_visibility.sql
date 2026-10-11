-- ============================================================
--  Blue Crane Vistas Portal — Fix: gardener / service-provider
--  ticket visibility.
--
--  Problem: can_see_ticket() let gardeners/service providers see a
--  ticket only via is_unit_assignee(), which queried the old (now
--  dropped) `requests` table and a person-level assignee. Tickets are
--  assigned to a ROLE (assigned_role), so that check never matched —
--  a gardener would log in and see no tickets at all.
--
--  Fix: a gardener/service provider sees a ticket when the ticket's
--  assigned_role matches their own login role. (They work across the
--  whole complex, so no unit link is required.)
--
--  Run AFTER 11_phase_t2_drop_requests.sql.
-- ============================================================

-- Current user's login role (from their profile).
create or replace function my_role()
returns app_role language sql security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

-- Rewrite is_unit_assignee to not depend on the dropped requests table.
-- "Assignee of a unit" now means: I have a ticket on this unit that is
-- currently assigned to my role.
create or replace function is_unit_assignee(target_unit uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from tickets t
    where t.unit_id = target_unit
      and t.assigned_role = my_role()
  );
$$;

-- Rewrite can_see_ticket: gardeners/service providers see a ticket when
-- its assigned_role equals their own role (anywhere in the complex).
create or replace function can_see_ticket(t_unit uuid, t_status ticket_status,
                                          t_assigned app_role, t_logger uuid)
returns boolean language sql security definer set search_path = public as $$
  select
    is_trustee()
    or t_logger = auth.uid()
    or is_unit_owner(t_unit)
    or is_unit_tenant(t_unit)
    or exists (                                   -- occupant of the unit
      select 1 from occupants o
      where o.unit_id = t_unit and o.profile_id = auth.uid() and o.active)
    or ( t_assigned in ('gardener','service_provider')
         and t_assigned = my_role() );            -- assigned to MY role
$$;
