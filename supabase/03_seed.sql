-- ============================================================
--  Complex Comms — Optional seed data
--  Run AFTER 01_schema.sql and 02_policies.sql, only if you want
--  some example units to start with. Safe to skip.
--
--  Note: this seeds UNITS only (no fake people), because real
--  users are created when they sign in via magic link.
-- ============================================================

insert into units (number, notes) values
  ('1A',  'Owner-occupied. Bay 3.'),
  ('4C',  'Rented. 1 dog approved.'),
  ('7B',  'Rented via agent.')
on conflict (number) do nothing;

-- To create your real 35 units quickly, duplicate the pattern:
-- insert into units (number) values ('1A'),('1B'),('2A'), ... ;
