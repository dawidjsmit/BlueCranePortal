-- ============================================================
--  Blue Crane Vistas Portal — communal entity types get a description
--
--  Adds an optional description to each communal entity type, edited on
--  the Communal entity types screen. (The table keeps its original name,
--  communal_area_types.) Existing types are unchanged.
--
--  Run once. Safe to re-run.
-- ============================================================

alter table communal_area_types add column if not exists description text;
