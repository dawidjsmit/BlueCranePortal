-- ============================================================
--  Blue Crane Vistas Portal — bulk add units 1 to 35
--
--  Adds units 1..35, EXCEPT 1, 4, 7, 30 and 31 (already captured).
--  Layout is left empty (set it later on the Units screen).
--
--  Safe to run more than once:
--   * units 1, 4, 7, 30, 31 are always skipped
--   * any unit whose number already exists (as 5, 05, ...) is skipped
--   * number style follows what you already have: if any existing unit
--     is zero-padded (01, 04, ...), new ones are padded too (02, 03, 05)
--
--  Run in: Supabase -> SQL Editor -> New query -> paste -> Run.
-- ============================================================

do $$
declare
  n        int;
  pad      boolean;
  inserted int := 0;
begin
  -- Match the style of the units you already captured.
  select exists (select 1 from units where number ~ '^0[0-9]+$') into pad;

  for n in 1..35 loop
    -- Already captured by hand: never touch these.
    continue when n in (1, 4, 7, 30, 31);

    -- Skip if a unit with this numeric value already exists (5, 05, ...).
    continue when exists (
      select 1 from units
      where case when trim(number) ~ '^[0-9]+$'
                 then trim(number)::int end = n
    );

    insert into units (number)
    values (case when pad then lpad(n::text, 2, '0') else n::text end);
    inserted := inserted + 1;
  end loop;

  raise notice 'Inserted % new units', inserted;
end $$;

-- Result: every unit now in the system, in number order.
select number, layout_id, notes
from units
order by case when number ~ '^[0-9]+$' then number::int end, number;
