-- Create an employee and their initial family records as one database transaction.
-- The API validates permissions and lookup references before calling this function;
-- this function owns the all-or-nothing persistence and temporary wife-ID mapping.

create or replace function public.create_employee_with_family(
  p_employee jsonb,
  p_wives jsonb default '[]'::jsonb,
  p_children jsonb default '[]'::jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_input public.employees%rowtype;
  v_employee public.employees%rowtype;
  v_wife jsonb;
  v_child jsonb;
  v_client_id text;
  v_wife_id bigint;
  v_wife_ids jsonb := '{}'::jsonb;
  v_wives jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
begin
  if p_actor_id is null then
    raise exception 'HMS_ACTOR_REQUIRED';
  end if;
  if jsonb_typeof(p_employee) <> 'object'
    or jsonb_typeof(p_wives) <> 'array'
    or jsonb_typeof(p_children) <> 'array' then
    raise exception 'HMS_INVALID_EMPLOYEE_FAMILY_PAYLOAD';
  end if;

  select * into v_input from jsonb_populate_record(null::public.employees, p_employee);
  insert into public.employees (
    employee_status, employee_classification, gender, arabic_full_name, english_full_name,
    identity_card_number, identity_card_expiration_date, date_of_birth, religion_id,
    marital_status_id, diploma_id, major, graduated_from, phone, governorate_id, address,
    department_id, shift_type_id, team_id, position_id, project_id, joining_date,
    contract_signing_date, social_insurance_active, social_insurance_comment,
    form_1_incoming_number, form_1_incoming_date, bank_id, bank_account_number,
    leaving_date, leaving_reason_id, leaving_comment, annual_days_settled,
    form_6_incoming_number, form_6_incoming_date, form_6_reason, created_by, updated_by
  ) values (
    coalesce(v_input.employee_status, 'active'), coalesce(v_input.employee_classification, 'standard'),
    v_input.gender, v_input.arabic_full_name, v_input.english_full_name,
    v_input.identity_card_number, v_input.identity_card_expiration_date, v_input.date_of_birth,
    v_input.religion_id, v_input.marital_status_id, v_input.diploma_id, v_input.major,
    v_input.graduated_from, v_input.phone, v_input.governorate_id, v_input.address,
    v_input.department_id, v_input.shift_type_id, v_input.team_id, v_input.position_id,
    v_input.project_id, v_input.joining_date, v_input.contract_signing_date,
    coalesce(v_input.social_insurance_active, false), v_input.social_insurance_comment,
    v_input.form_1_incoming_number, v_input.form_1_incoming_date, v_input.bank_id,
    v_input.bank_account_number, v_input.leaving_date, v_input.leaving_reason_id,
    v_input.leaving_comment, v_input.annual_days_settled, v_input.form_6_incoming_number,
    v_input.form_6_incoming_date, v_input.form_6_reason, p_actor_id, p_actor_id
  ) returning * into v_employee;

  for v_wife in select value from jsonb_array_elements(p_wives) loop
    v_client_id := nullif(btrim(coalesce(v_wife->>'client_id', '')), '');
    if v_client_id is null then raise exception 'HMS_WIFE_CLIENT_ID_REQUIRED'; end if;
    if v_wife_ids ? v_client_id then raise exception 'HMS_DUPLICATE_WIFE_CLIENT_ID'; end if;
    if nullif(btrim(coalesce(v_wife->>'wife_name', '')), '') is null then raise exception 'HMS_WIFE_NAME_REQUIRED'; end if;
    if coalesce(v_wife->>'identity_card_number', '') !~ '^[0-9]{14}$' then raise exception 'HMS_WIFE_IDENTITY_INVALID'; end if;
    insert into public.employee_wives (employee_id, wife_name, identity_card_number, is_working, created_by, updated_by)
    values (v_employee.id, btrim(v_wife->>'wife_name'), v_wife->>'identity_card_number', coalesce((v_wife->>'is_working')::boolean, false), p_actor_id, p_actor_id)
    returning id into v_wife_id;
    v_wife_ids := jsonb_set(v_wife_ids, array[v_client_id], to_jsonb(v_wife_id));
    v_wives := v_wives || jsonb_build_array(jsonb_build_object('id', v_wife_id, 'client_id', v_client_id));
  end loop;

  for v_child in select value from jsonb_array_elements(p_children) loop
    if nullif(btrim(coalesce(v_child->>'child_name', '')), '') is null then raise exception 'HMS_CHILD_NAME_REQUIRED'; end if;
    if coalesce(v_child->>'identity_card_number', '') !~ '^[0-9]{14}$' then raise exception 'HMS_CHILD_IDENTITY_INVALID'; end if;
    v_client_id := nullif(btrim(coalesce(v_child->>'wife_client_id', '')), '');
    if v_client_id is not null and not (v_wife_ids ? v_client_id) then raise exception 'HMS_CHILD_WIFE_NOT_FOUND'; end if;
    insert into public.employee_children (employee_id, wife_id, child_name, identity_card_number, created_by, updated_by)
    values (
      v_employee.id,
      case when v_client_id is null then null else (v_wife_ids->>v_client_id)::bigint end,
      btrim(v_child->>'child_name'), v_child->>'identity_card_number', p_actor_id, p_actor_id
    ) returning id into v_wife_id;
    v_children := v_children || jsonb_build_array(jsonb_build_object('id', v_wife_id));
  end loop;

  return jsonb_build_object('employee', to_jsonb(v_employee), 'wives', v_wives, 'children', v_children);
end;
$$;

revoke all on function public.create_employee_with_family(jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_employee_with_family(jsonb, jsonb, jsonb, uuid) to service_role;
