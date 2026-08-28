-- A renewal date identifies one contractual renewal event for one employee.
alter table public.employee_contract_renewals
  add constraint employee_contract_renewals_employee_renewal_date_key
  unique (employee_id, renewal_signing_date);

create or replace function public.renew_employee_contract(p_employee_id uuid, p_renewal_signing_date date, p_actor_id uuid)
returns public.employee_contract_renewals language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_employee public.employees%rowtype;
  v_renewal public.employee_contract_renewals%rowtype;
begin
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then raise exception 'Employee does not exist'; end if;
  if p_renewal_signing_date is null or p_renewal_signing_date < v_employee.joining_date then
    raise exception 'Renewal signing date must be on or after joining date';
  end if;
  if exists (
    select 1 from public.employee_contract_renewals
    where employee_id = p_employee_id and renewal_signing_date = p_renewal_signing_date
  ) then
    raise exception 'Contract renewal already exists for this date';
  end if;
  insert into public.employee_contract_renewals (
    employee_id, previous_contract_signing_date, previous_contract_expiration_date,
    renewal_signing_date, renewal_expiration_date, created_by
  ) values (
    v_employee.id, v_employee.contract_signing_date, v_employee.contract_expiration_date,
    p_renewal_signing_date, (p_renewal_signing_date + interval '1 year - 1 day')::date, p_actor_id
  ) returning * into v_renewal;
  update public.employees set contract_signing_date = p_renewal_signing_date, updated_by = p_actor_id where id = p_employee_id;
  return v_renewal;
end;
$$;
