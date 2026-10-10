-- ============================================================
--  Blue Crane Vistas Portal — add the 6th login role: 'occupant'
--
--  RUN THIS FIRST, ON ITS OWN, and let it finish — BEFORE running
--  10_phase_t1_tickets.sql.
--
--  Why separate? PostgreSQL will not let a newly-added enum value be
--  USED in the same transaction that ADDS it. Running this as its own
--  statement commits the new value so the next migration can use it.
-- ============================================================

alter type app_role add value if not exists 'occupant';
