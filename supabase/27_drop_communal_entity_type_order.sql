-- ============================================================
--  Blue Crane Vistas Portal — remove "Sort order" from communal entity types
--
--  Communal entity types are now always shown alphabetically by name, so
--  the sort_order column is no longer used.
--
--  Run AFTER the matching app update is live (merge the PR, wait a couple
--  of minutes for the site to update). Safe to re-run.
-- ============================================================

alter table communal_area_types drop column if exists sort_order;
