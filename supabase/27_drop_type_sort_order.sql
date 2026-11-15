-- ============================================================
--  Blue Crane Vistas Portal — remove "Sort order" from type lists
--
--  Communal entity types and ticket types are now always shown
--  alphabetically by name, so their sort_order columns are no longer used.
--
--  Run AFTER the matching app update is live (merge the PR, wait a couple
--  of minutes for the site to update). Safe to re-run.
-- ============================================================

alter table communal_area_types drop column if exists sort_order;
alter table ticket_types        drop column if exists sort_order;
