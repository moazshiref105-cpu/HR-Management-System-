-- Server-side, whitelist-only dashboard analytics. No request parameter becomes SQL.
create or replace function public.dashboard_analysis(p_metric text, p_dimension text, p_filters jsonb default '{}'::jsonb)
returns table(key text, label text, count bigint)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare dim text; pair text[]; metric_where text; filter_where text := 'true'; from_date date := nullif(p_filters->>'from','')::date; to_date date := nullif(p_filters->>'to','')::date;
begin
  dim := case p_dimension
    when 'department' then 'coalesce(d.id::text,''none'')|coalesce(d.name,''Unassigned'')'
    when 'team' then 'coalesce(t.id::text,''none'')|coalesce(t.name,''Unassigned'')'
    when 'position' then 'coalesce(po.id::text,''none'')|coalesce(po.name,''Unassigned'')'
    when 'project' then 'coalesce(pr.id::text,''none'')|coalesce(pr.name,''Unassigned'')'
    when 'governorate' then 'coalesce(g.id::text,''none'')|coalesce(g.name,''Unassigned'')'
    when 'leaving_reason' then 'coalesce(lr.id::text,''none'')|coalesce(lr.name,''Unassigned'')'
    when 'employee_status' then 'e.employee_status'
    when 'gender' then 'e.gender'
    when 'classification' then 'e.employee_classification'
    when 'shift_type' then 'coalesce(st.id::text,''none'')|coalesce(st.name,''Unassigned'')'
    when 'bank' then 'coalesce(b.id::text,''none'')|coalesce(b.name,''Unassigned'')'
    when 'comprehensive_health_participation' then 'case when g.participates_in_comprehensive_health_insurance then ''participating'' else ''not_participating'' end'
    else null end;
  if dim is null then raise exception 'Unsupported dashboard dimension'; end if;
  metric_where := case p_metric
    when 'total_employees' then 'true'
    when 'active_employees' then 'e.employee_status=''active'''
    when 'resigned_employees' then 'e.employee_status=''resigned'' and e.leaving_date between coalesce($1,''0001-01-01'') and coalesce($2,''9999-12-31'')'
    when 'inactive_employees' then 'e.employee_status=''inactive'''
    when 'new_hires' then 'e.joining_date between coalesce($1,''0001-01-01'') and coalesce($2,''9999-12-31'')'
    when 'five_percent' then 'e.employee_classification=''five_percent'''
    when 'missing_form_1' then 'nullif(btrim(e.form_1_incoming_number),'''') is null'
    when 'missing_form_6' then 'e.employee_status in (''resigned'',''inactive'') and nullif(btrim(e.form_6_incoming_number),'''') is null'
    when 'missing_bank' then 'e.bank_id is null'
    when 'contracts_expiring' then 'e.contract_expiration_date between coalesce($1,current_date) and coalesce($2,current_date + 30)'
    when 'contracts_expired' then 'e.contract_expiration_date < current_date'
    when 'in_probation' then 'e.joining_date <= current_date and e.probation_due_date >= current_date'
    when 'probation_due' then 'e.probation_due_date between coalesce($1,current_date) and coalesce($2,current_date + 30)'
    when 'identity_expiring' then 'e.identity_card_expiration_date between coalesce($1,current_date) and coalesce($2,current_date + 30)'
    when 'identity_expired' then 'e.identity_card_expiration_date < current_date'
    when 'comprehensive_health_participating' then 'g.participates_in_comprehensive_health_insurance=true'
    else null end;
  if metric_where is null then raise exception 'Unsupported dashboard metric'; end if;
  foreach pair slice 1 in array array[['department_id','e.department_id'],['team_id','e.team_id'],['position_id','e.position_id'],['project_id','e.project_id'],['governorate_id','e.governorate_id'],['leaving_reason_id','e.leaving_reason_id'],['shift_type_id','e.shift_type_id'],['bank_id','e.bank_id'],['gender','e.gender'],['employee_status','e.employee_status'],['employee_classification','e.employee_classification']]
  loop if p_filters ? pair[1] and p_filters->>pair[1] <> '' then filter_where:=filter_where||format(' and %s = %L',pair[2],p_filters->>pair[1]);end if;end loop;
  return query execute format('select split_part(%1$s,''|'',1), split_part(%1$s,''|'',2), count(*) from public.employees e left join public.departments d on d.id=e.department_id left join public.teams t on t.id=e.team_id left join public.positions po on po.id=e.position_id left join public.projects pr on pr.id=e.project_id left join public.governorates g on g.id=e.governorate_id left join public.leaving_reasons lr on lr.id=e.leaving_reason_id left join public.shift_types st on st.id=e.shift_type_id left join public.banks b on b.id=e.bank_id where (%2$s) and (%3$s) group by 1,2 order by 3 desc,2',dim,metric_where,filter_where) using from_date,to_date;
end $$;
grant execute on function public.dashboard_analysis(text,text,jsonb) to service_role;

create index if not exists employees_joining_date_dashboard_idx on public.employees (joining_date);
create index if not exists employees_leaving_date_dashboard_idx on public.employees (leaving_date) where employee_status = 'resigned';
create index if not exists employees_contract_expiration_dashboard_idx on public.employees (contract_expiration_date);
create index if not exists employees_identity_expiration_dashboard_idx on public.employees (identity_card_expiration_date);
