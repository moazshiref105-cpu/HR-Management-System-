-- A single, scalable employee work-queue reader. It delegates its eligibility
-- predicate to the established dashboard metric definitions so Analytics and
-- People Operations can never drift apart.
create or replace function public.employee_work_queue(
  p_metric text,
  p_filters jsonb default '{}'::jsonb,
  p_page int default 1,
  p_page_size int default 25,
  p_sort text default 'employee_number',
  p_direction text default 'asc'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  pred text;
  fw text;
  total bigint;
  rows jsonb;
  f date := nullif(p_filters->>'from', '')::date;
  t date := nullif(p_filters->>'to', '')::date;
  size int := least(greatest(p_page_size, 1), 100);
  off int := greatest(p_page - 1, 0) * least(greatest(p_page_size, 1), 100);
  sort_expr text;
  direction text;
begin
  pred := public.dashboard_metric_where(p_metric, f, t);
  if pred is null then raise exception 'Unsupported work queue metric'; end if;
  fw := public.dashboard_filter_where(p_filters);
  sort_expr := case p_sort
    when 'employee_number' then 'e.employee_number'
    when 'full_name_ar' then 'e.arabic_full_name'
    when 'full_name_en' then 'e.english_full_name'
    when 'joining_date' then 'e.joining_date'
    when 'employee_status' then 'e.employee_status'
    when 'queue_date' then 'queue_date'
    else null end;
  if sort_expr is null then raise exception 'Unsupported work queue sort'; end if;
  direction := case lower(p_direction) when 'desc' then 'desc' when 'asc' then 'asc' else null end;
  if direction is null then raise exception 'Unsupported work queue direction'; end if;

  execute format('select count(*) from public.employees e left join public.governorates g on g.id=e.governorate_id where (%s) and (%s)', pred, fw) into total;
  execute format($query$
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    from (
      select e.id,e.employee_number,e.arabic_full_name,e.english_full_name,e.employee_status,
        e.joining_date,e.leaving_date,e.contract_expiration_date,e.contract_signing_date,
        e.probation_due_date,e.identity_card_expiration_date,e.form_1_incoming_number,
        d.name as department_name,po.name as position_name,tm.name as team_name,pr.name as project_name,
        case %L
          when 'contracts_expiring' then e.contract_expiration_date
          when 'contracts_expired' then e.contract_expiration_date
          when 'identity_expiring' then e.identity_card_expiration_date
          when 'identity_expired' then e.identity_card_expiration_date
          when 'probation_due' then e.probation_due_date
          when 'in_probation' then e.probation_due_date
          when 'missing_form_1' then (e.contract_signing_date + interval '1 month')::date
          when 'new_hires' then e.joining_date
          when 'resigned_employees' then e.leaving_date
          when 'licenses_expiring' then (select min(l.expiry_date) from public.employee_licenses l where l.employee_id=e.id and l.expiry_date between coalesce(%L::date,current_date) and coalesce(%L::date,current_date + 30))
          when 'licenses_expired' then (select min(l.expiry_date) from public.employee_licenses l where l.employee_id=e.id and l.expiry_date < current_date)
          else null end as queue_date,
        case %L
          when 'missing_form_1' then 'Form 1'
          when 'missing_form_6' then 'Form 6'
          when 'missing_bank' then 'Bank account'
          when 'licenses_expiring' then 'License'
          when 'licenses_expired' then 'License'
          when 'identity_expiring' then 'Identity document'
          when 'identity_expired' then 'Identity document'
          else null end as queue_item
      from public.employees e
      left join public.departments d on d.id=e.department_id
      left join public.positions po on po.id=e.position_id
      left join public.teams tm on tm.id=e.team_id
      left join public.projects pr on pr.id=e.project_id
      left join public.governorates g on g.id=e.governorate_id
      where (%s) and (%s)
      order by %s %s nulls last, e.id asc
      limit %s offset %s
    ) x
  $query$, p_metric, f, t, p_metric, pred, fw, sort_expr, direction, size, off) into rows;

  return jsonb_build_object('rows', rows, 'total', total, 'page', greatest(p_page, 1), 'page_size', size, 'total_pages', ceil(total::numeric / size));
end;
$$;

grant execute on function public.employee_work_queue(text, jsonb, int, int, text, text) to service_role;
