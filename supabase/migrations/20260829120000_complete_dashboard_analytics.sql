-- Database-owned drill-through and expanded metric predicates.
create or replace function public.dashboard_metric_where(p_metric text, p_from date, p_to date)
returns text language plpgsql immutable as $$
begin
  return case p_metric
    when 'total_employees' then 'true'
    when 'active_employees' then 'e.employee_status = ''active'''
    when 'resigned_employees' then format('e.employee_status = ''resigned'' and e.leaving_date between %L and %L',coalesce(p_from,'0001-01-01'),coalesce(p_to,'9999-12-31'))
    when 'inactive_employees' then 'e.employee_status = ''inactive'''
    when 'new_hires' then format('e.joining_date between %L and %L',coalesce(p_from,'0001-01-01'),coalesce(p_to,'9999-12-31'))
    when 'five_percent' then 'e.employee_classification = ''five_percent'''
    when 'missing_form_1' then 'nullif(btrim(e.form_1_incoming_number),'''') is null'
    when 'missing_form_6' then 'e.employee_status in (''resigned'',''inactive'') and nullif(btrim(e.form_6_incoming_number),'''') is null'
    when 'missing_bank' then 'e.bank_id is null'
    when 'contracts_expired' then 'e.contract_expiration_date < current_date'
    when 'in_probation' then 'e.joining_date <= current_date and e.probation_due_date >= current_date'
    when 'identity_expired' then 'e.identity_card_expiration_date < current_date'
    when 'licenses_expired' then 'exists (select 1 from public.employee_licenses lx where lx.employee_id=e.id and lx.expiry_date < current_date)'
    when 'open_notifications' then 'exists (select 1 from public.employee_notifications n where n.employee_id=e.id and n.status=''open'')'
    when 'overdue' then 'exists (select 1 from public.employee_notifications n where n.employee_id=e.id and n.status=''open'' and n.due_date < current_date)'
    when 'comprehensive_health_participating' then 'g.participates_in_comprehensive_health_insurance'
    else null end;
end $$;

create or replace function public.dashboard_employees(p_metric text,p_filters jsonb default '{}'::jsonb,p_page int default 1,p_page_size int default 25)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare pred text; total bigint; rows jsonb; f date:=nullif(p_filters->>'from','')::date; t date:=nullif(p_filters->>'to','')::date; size int:=least(greatest(p_page_size,1),100); offset_rows int:=greatest(p_page-1,0)*size;
begin pred:=public.dashboard_metric_where(p_metric,f,t);if pred is null then raise exception 'Unsupported dashboard metric';end if;execute format('select count(*) from public.employees e left join public.governorates g on g.id=e.governorate_id where %s',pred) into total;execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from (select e.id,e.employee_number,e.arabic_full_name,e.english_full_name,e.employee_status,e.department_id,e.position_id,e.joining_date,e.leaving_date,e.leaving_reason_id,e.contract_signing_date,e.contract_expiration_date,e.probation_due_date,e.identity_card_expiration_date,e.form_1_incoming_number,(e.contract_signing_date+interval ''1 month'')::date form_1_deadline from public.employees e left join public.governorates g on g.id=e.governorate_id where %s order by e.employee_number limit %s offset %s)x',pred,size,offset_rows) into rows;return jsonb_build_object('rows',rows,'total',total,'page',p_page,'page_size',size,'total_pages',ceil(total::numeric/size));end $$;
grant execute on function public.dashboard_employees(text,jsonb,int,int) to service_role;
create index if not exists employees_joining_dashboard_idx on public.employees(joining_date);
create index if not exists employees_leaving_dashboard_idx on public.employees(leaving_date) where employee_status='resigned';
create index if not exists employees_contract_dashboard_idx on public.employees(contract_expiration_date);
create index if not exists employees_identity_dashboard_idx on public.employees(identity_card_expiration_date);
create index if not exists employee_notifications_metric_idx on public.employee_notifications(status,due_date,employee_id);
create index if not exists employee_licenses_metric_idx on public.employee_licenses(expiry_date,employee_id);
