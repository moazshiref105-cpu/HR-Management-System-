-- Normalize employee status and classification without deleting or rewriting
-- employee history. Inactive employee rows must already carry the same leaving
-- details required for a resigned employee; otherwise stop for manual review.
do $$
declare
  missing_leaving_details bigint;
  converted_statuses bigint;
  converted_classifications bigint;
  constraint_row record;
begin
  select count(*) into missing_leaving_details
  from public.employees
  where employee_status = 'inactive'
    and (leaving_date is null or leaving_reason_id is null);

  if missing_leaving_details > 0 then
    raise exception 'Cannot normalize % inactive employee record(s): leaving date or leaving reason is missing. Review those rows before applying this migration.', missing_leaving_details;
  end if;

  for constraint_row in
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.employees'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%inactive%'
        or pg_get_constraintdef(oid) ilike '%five_percent%')
  loop
    execute format('alter table public.employees drop constraint %I', constraint_row.conname);
  end loop;

  update public.employees
  set employee_status = 'resigned'
  where employee_status = 'inactive';
  get diagnostics converted_statuses = row_count;
  raise notice 'Converted % inactive employee record(s) to resigned; existing leaving data was preserved.', converted_statuses;

  update public.employees
  set employee_classification = '5_percent'
  where employee_classification = 'five_percent';
  get diagnostics converted_classifications = row_count;
  raise notice 'Converted % legacy five_percent classification record(s) to 5_percent.', converted_classifications;

  alter table public.employees
    add constraint employees_employee_status_normalized_check
      check (employee_status in ('active', 'resigned')),
    add constraint employees_employee_classification_normalized_check
      check (employee_classification in ('standard', '5_percent'));
end $$;

create or replace function public.dashboard_metric_where(
  p_metric text,
  p_from date default null,
  p_to date default null
)
returns text
language plpgsql
stable
as $$
declare
  f text := coalesce(p_from::text, '0001-01-01');
  t text := coalesce(p_to::text, '9999-12-31');
begin
  return case p_metric
    when 'total_employees' then 'true'
    when 'active_employees' then 'e.employee_status = ''active'''
    when 'resigned_employees' then format('e.employee_status = ''resigned'' and e.leaving_date between %L and %L', f, t)
    when 'new_hires' then format('e.joining_date between %L and %L', f, t)
    when 'five_percent' then 'e.employee_classification = ''5_percent'''
    when 'missing_form_1' then 'nullif(btrim(e.form_1_incoming_number),'''') is null'
    when 'missing_form_6' then 'e.employee_status = ''resigned'' and nullif(btrim(e.form_6_incoming_number),'''') is null'
    when 'missing_bank' then 'e.bank_id is null'
    when 'contracts_expiring' then format('e.contract_expiration_date between %L and %L', coalesce(p_from, current_date)::text, coalesce(p_to, current_date + 30)::text)
    when 'contracts_expired' then 'e.contract_expiration_date < current_date'
    when 'in_probation' then 'e.employee_status = ''active'' and e.joining_date <= current_date and e.probation_due_date >= current_date'
    when 'probation_due' then format('e.employee_status = ''active'' and e.probation_due_date between %L and %L', coalesce(p_from, current_date)::text, coalesce(p_to, current_date + 30)::text)
    when 'identity_expiring' then format('e.identity_card_expiration_date between %L and %L', coalesce(p_from, current_date)::text, coalesce(p_to, current_date + 30)::text)
    when 'identity_expired' then 'e.identity_card_expiration_date < current_date'
    when 'licenses_expiring' then format('exists (select 1 from public.employee_licenses lx where lx.employee_id=e.id and lx.expiry_date between %L and %L)', coalesce(p_from, current_date)::text, coalesce(p_to, current_date + 30)::text)
    when 'licenses_expired' then 'exists (select 1 from public.employee_licenses lx where lx.employee_id=e.id and lx.expiry_date < current_date)'
    when 'open_notifications' then 'exists (select 1 from public.employee_notifications n where n.employee_id=e.id and n.status = ''open'')'
    when 'due_soon' then 'exists (select 1 from public.employee_notifications n where n.employee_id=e.id and n.status = ''open'' and n.due_date between current_date and current_date + 30)'
    when 'overdue' then 'exists (select 1 from public.employee_notifications n where n.employee_id=e.id and n.status = ''open'' and n.due_date < current_date)'
    when 'medical_eligible' then '(e.joining_date + make_interval(months => coalesce((select value::int from public.insurance_settings where setting_key=''medical_insurance_eligibility_months'' and is_active),0)))::date <= current_date'
    when 'medical_not_yet_eligible' then '(e.joining_date + make_interval(months => coalesce((select value::int from public.insurance_settings where setting_key=''medical_insurance_eligibility_months'' and is_active),0)))::date > current_date'
    when 'life_eligible' then '(e.joining_date + make_interval(months => coalesce((select value::int from public.insurance_settings where setting_key=''life_insurance_eligibility_months'' and is_active),0)))::date <= current_date'
    when 'comprehensive_health_participating' then 'g.participates_in_comprehensive_health_insurance is true'
    else null
  end;
end $$;

create or replace function public.dashboard_filter_where(p_filters jsonb default '{}'::jsonb)
returns text
language plpgsql
immutable
as $$
declare
  k text;
  v text;
  out_where text := 'true';
  map jsonb := jsonb_build_object(
    'department_id','e.department_id','team_id','e.team_id','position_id','e.position_id',
    'project_id','e.project_id','governorate_id','e.governorate_id','leaving_reason_id','e.leaving_reason_id',
    'shift_type_id','e.shift_type_id','bank_id','e.bank_id','gender','e.gender',
    'employee_status','e.employee_status','employee_classification','e.employee_classification',
    'marital_status_id','e.marital_status_id','religion_id','e.religion_id','diploma_id','e.diploma_id'
  );
begin
  v := nullif(p_filters->>'employee_status', '');
  if v is not null and v not in ('active', 'resigned') then
    raise exception 'employee_status must be active or resigned';
  end if;
  v := nullif(p_filters->>'employee_classification', '');
  if v = '5%' or v = 'five_percent' then v := '5_percent'; end if;
  if v is not null and v not in ('standard', '5_percent') then
    raise exception 'employee_classification must be standard or 5_percent';
  end if;

  for k in select jsonb_object_keys(map) loop
    v := nullif(p_filters->>k, '');
    if k = 'employee_classification' and (v = '5%' or v = 'five_percent') then v := '5_percent'; end if;
    if v is not null then out_where := out_where || format(' and %s = %L', map->>k, v); end if;
  end loop;
  v := nullif(p_filters->>'search', '');
  if v is not null then
    out_where := out_where || format(' and (e.employee_number::text ilike %L or e.english_full_name ilike %L or e.arabic_full_name ilike %L)', '%'||v||'%', '%'||v||'%', '%'||v||'%');
  end if;
  return out_where;
end $$;

-- Preserve the existing executive analytics query and grants while switching
-- its classification label predicate to the canonical stored value.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.dashboard_executive(jsonb)'::regprocedure) into definition;
  if definition is not null then
    execute replace(definition, 'five_percent', '5_percent');
  end if;
end $$;
