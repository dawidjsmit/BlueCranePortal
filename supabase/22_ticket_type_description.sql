-- ============================================================
--  Blue Crane Vistas Portal — ticket types get a description
--
--  Adds an optional description to each ticket type, edited on the
--  Ticket types screen. Existing types are unchanged (description empty).
--
--  Run once. Safe to re-run.
-- ============================================================

alter table ticket_types add column if not exists description text;
