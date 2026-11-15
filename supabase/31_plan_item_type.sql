-- ============================================================
--  Blue Crane Vistas Portal — communal entity type on 10 Year Plan items
--
--  A plan item can now also have a communal entity type (optional), next
--  to its grouping (also optional). When a type is chosen, the item's
--  grouping must be that type's grouping, so the matrix row stays right.
--
--  Run AFTER 30_ten_year_plan.sql.  Safe to re-run.
-- ============================================================

alter table plan_items
  add column if not exists type_id uuid references communal_area_types(id) on delete set null;

-- Replace the save function with one that also takes the type.
drop function if exists save_plan_item(uuid, text, text, int, numeric, numeric, uuid, uuid, uuid[]);

create or replace function save_plan_item(
  p_id          uuid,
  p_name        text,
  p_description text,
  p_year        int,
  p_budget      numeric,
  p_actual      numeric,
  p_group       uuid,
  p_type        uuid,
  p_status      uuid,
  p_projects    uuid[]
) returns uuid language plpgsql set search_path = public as $$
declare
  pid uuid := p_id;
  type_group uuid;
begin
  if not is_trustee() then
    raise exception 'Only a trustee can save plan items.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Please enter the plan item name.';
  end if;
  if p_type is not null then
    select group_id into type_group from communal_area_types where id = p_type;
    if not found then raise exception 'That communal entity type no longer exists.'; end if;
    if type_group is distinct from p_group then
      raise exception 'The communal entity type does not belong to the chosen grouping.';
    end if;
  end if;

  if pid is null then
    insert into plan_items (name, description, year, budget, actual_spend, group_id, type_id, status_id)
    values (trim(p_name), nullif(trim(p_description), ''), p_year, coalesce(p_budget, 0),
            coalesce(p_actual, 0), p_group, p_type, p_status)
    returning id into pid;
  else
    update plan_items set
      name = trim(p_name), description = nullif(trim(p_description), ''),
      year = p_year, budget = coalesce(p_budget, 0), actual_spend = coalesce(p_actual, 0),
      group_id = p_group, type_id = p_type, status_id = p_status
    where id = pid;
    if not found then raise exception 'That plan item no longer exists.'; end if;
  end if;

  delete from plan_item_projects where plan_item_id = pid;
  insert into plan_item_projects (plan_item_id, project_id)
    select pid, x from unnest(coalesce(p_projects, '{}')) as x group by x;
  return pid;
end;
$$;

revoke all on function save_plan_item(uuid, text, text, int, numeric, numeric, uuid, uuid, uuid, uuid[]) from public;
grant execute on function save_plan_item(uuid, text, text, int, numeric, numeric, uuid, uuid, uuid, uuid[]) to authenticated;
