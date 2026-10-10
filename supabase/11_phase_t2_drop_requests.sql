-- ============================================================
--  Blue Crane Vistas Portal — Phase T2 cleanup
--  The app now uses Tickets everywhere, so remove the old Requests.
--
--  Run AFTER you've deployed the Phase T2 app (PR for T2 merged) and
--  confirmed Tickets work. This permanently drops the old data.
-- ============================================================

drop table if exists request_log cascade;
drop table if exists requests cascade;

-- (The request_status enum from 01_schema.sql is now unused; drop if present.)
do $$ begin
  drop type if exists request_status;
exception when others then null; end $$;
