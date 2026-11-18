-- Backfill existing spouse-linked employees, then keep their marital status
-- consistent whenever a spouse row is inserted or updated.

alter table public.marital_statuses
  add column if not exists is_married_status boolean not null default false;

do $$
declare
  v_match_count bigint;
  v_married_status_id bigint;
begin
  select count(*), min(id)
    into v_match_count, v_married_status_id
  from public.marital_statuses
  where lower(btrim(name)) = 'married';

  if v_match_count = 0 then
    raise exception 'HMS_MARRIED_STATUS_CANONICAL_MISSING: expected exactly one marital status whose normalized name is Married.';
  elsif v_match_count > 1 then
    raise exception 'HMS_MARRIED_STATUS_CANONICAL_AMBIGUOUS: found % marital statuses whose normalized name is Married.', v_match_count;
  end if;

  update public.marital_statuses
  set is_married_status = (id = v_married_status_id)
  where is_married_status is distinct from (id = v_married_status_id);
end;
$$;

create unique index if not exists marital_statuses_single_married_marker_idx
  on public.marital_statuses (is_married_status)
  where is_married_status = true;

create or replace function public.mark_employee_married_for_spouse()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_match_count bigint;
  v_married_status_id bigint;
begin
  select count(*), min(id)
    into v_match_count, v_married_status_id
  from public.marital_statuses
  where is_married_status = true;

  if v_match_count = 0 then
    raise exception 'HMS_MARRIED_STATUS_MARKER_MISSING: no marital status is marked Married.';
  elsif v_match_count > 1 then
    raise exception 'HMS_MARRIED_STATUS_MARKER_AMBIGUOUS: more than one marital status is marked Married.';
  end if;

  -- Only touch the employee when the invariant needs correction. The existing
  -- employees_set_updated_at trigger maintains updated_at; updated_by follows
  -- the spouse mutation actor when present and otherwise retains its value.
  update public.employees as employee
  set marital_status_id = v_married_status_id,
      updated_by = coalesce(new.updated_by, employee.updated_by)
  where employee.id = new.employee_id
    and employee.marital_status_id is distinct from v_married_status_id;

  return new;
end;
$$;

revoke all on function public.mark_employee_married_for_spouse() from public, anon, authenticated;
grant execute on function public.mark_employee_married_for_spouse() to service_role;

drop trigger if exists employee_wives_mark_employee_married on public.employee_wives;
create trigger employee_wives_mark_employee_married
after insert or update on public.employee_wives
for each row execute function public.mark_employee_married_for_spouse();

-- Existing spouse rows predate the trigger. Bring every linked employee to
-- the canonical Married status in this migration transaction. Preserve the
-- existing updated_by actor; employees_set_updated_at records the migration
-- change time through the normal timestamp trigger.
update public.employees as employee
set marital_status_id = married_status.id
from public.marital_statuses as married_status
where married_status.is_married_status = true
  and employee.marital_status_id is distinct from married_status.id
  and exists (
    select 1
    from public.employee_wives as spouse
    where spouse.employee_id = employee.id
  );

comment on column public.marital_statuses.is_married_status is
  'System-managed canonical marker for the Married marital status; not editable through Setup or imports.';
