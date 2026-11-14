-- ============================================================
--  Blue Crane Vistas Portal — make the unit number a real number
--
--  units.number was free text, so it sorted alphabetically (1, 10, 11,
--  2 ...) and accepted values like "12A". It becomes a whole number >= 1.
--  It stays UNIQUE.
--
--  SAFE: if any unit number is not a plain number, or two units would
--  collapse to the same number (e.g. "1" and "01"), this stops with a
--  message listing them, and changes nothing. Fix or delete those units
--  on the Units screen and run it again.
--
--  Note: "01" becomes 1 (leading zeros are not kept).
--
--  Run AFTER the matching app update is deployed (the app works with
--  either column type, so the order is not critical).
-- ============================================================

do $$
declare
  not_numeric text;
  duplicates  text;
begin
  select string_agg(number, ', ' order by number) into not_numeric
  from units
  where number !~ '^\s*[0-9]+\s*$';

  if not_numeric is not null then
    raise exception
      'Cannot convert: these unit numbers are not plain numbers: %. Rename or delete them first.',
      not_numeric;
  end if;

  select string_agg(n::text, ', ' order by n) into duplicates
  from (
    select trim(number)::int as n
    from units
    group by trim(number)::int
    having count(*) > 1
  ) d;

  if duplicates is not null then
    raise exception
      'Cannot convert: more than one unit has the number(s): %. Delete the duplicates first.',
      duplicates;
  end if;
end $$;

alter table units
  alter column number type integer using trim(number)::integer;

alter table units
  drop constraint if exists units_number_positive;
alter table units
  add constraint units_number_positive check (number >= 1);

-- Check: all units, in numeric order.
select number, layout_id, notes from units order by number;
