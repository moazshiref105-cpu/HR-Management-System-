-- Executive dashboard aggregates. All employee filters remain delegated to the
-- existing dashboard_filter_where helper so executive cards and Advanced
-- Analysis use the same global context.
create or replace function public.dashboard_executive(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  fw text := public.dashboard_filter_where(p_filters);
  v_from date := coalesce(nullif(p_filters->>'from', '')::date, (date_trunc('month', current_date) - interval '11 months')::date);
  v_to date := coalesce(nullif(p_filters->>'to', '')::date, current_date);
  kpis jsonb := '{}'::jsonb;
  movement jsonb := '[]'::jsonb;
  departments jsonb := '[]'::jsonb;
  reasons jsonb := '[]'::jsonb;
  turnover_departments jsonb := '[]'::jsonb;
  composition jsonb := '{}'::jsonb;
  attention jsonb := '[]'::jsonb;
  start_headcount bigint := 0;
  end_headcount bigint := 0;
  resigned_count bigint := 0;
begin
  if v_to < v_from then raise exception 'Dashboard end date cannot be before start date'; end if;

  execute format($query$
    select jsonb_build_object(
      'total_employees', count(*),
      'active_employees', count(*) filter (where e.employee_status = 'active'),
      'new_hires', count(*) filter (where e.joining_date between %L and %L),
      'resigned_employees', count(*) filter (where e.employee_status = 'resigned' and e.leaving_date between %L and %L),
      'in_probation', count(*) filter (where e.employee_status = 'active' and e.probation_due_date >= current_date),
      'start_headcount', count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L)),
      'end_headcount', count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L))
    ) from public.employees e where (%s)
  $query$, v_from, v_to, v_from, v_to, v_from, v_from, v_to, v_to, fw) into kpis;

  start_headcount := coalesce((kpis->>'start_headcount')::bigint, 0);
  end_headcount := coalesce((kpis->>'end_headcount')::bigint, 0);
  resigned_count := coalesce((kpis->>'resigned_employees')::bigint, 0);
  kpis := kpis || jsonb_build_object(
    'average_headcount', round((start_headcount + end_headcount)::numeric / 2, 2),
    'turnover_rate', case when start_headcount + end_headcount = 0 then 0 else round((resigned_count::numeric / ((start_headcount + end_headcount)::numeric / 2)) * 100, 2) end,
    'period_from', v_from, 'period_to', v_to
  );

  execute format($query$
    with periods as (
      select d::date as period_start, least((d + interval '1 month - 1 day')::date, %L::date) as period_end
      from generate_series(date_trunc('month', %L::date), date_trunc('month', %L::date), interval '1 month') d
    )
    select coalesce(jsonb_agg(jsonb_build_object('period', to_char(period_start, 'YYYY-MM'), 'active_workforce', active_workforce, 'new_hires', new_hires, 'resignations', resignations, 'turnover_rate', turnover_rate) order by period_start), '[]'::jsonb)
    from (
      select p.period_start,
        (select count(*) from public.employees e where (%s) and e.joining_date <= p.period_end and (e.leaving_date is null or e.leaving_date > p.period_end)) as active_workforce,
        (select count(*) from public.employees e where (%s) and e.joining_date between p.period_start and p.period_end) as new_hires,
        (select count(*) from public.employees e where (%s) and e.employee_status = 'resigned' and e.leaving_date between p.period_start and p.period_end) as resignations,
        (select case when count(*) filter (where e.joining_date <= p.period_start and (e.leaving_date is null or e.leaving_date > p.period_start)) + count(*) filter (where e.joining_date <= p.period_end and (e.leaving_date is null or e.leaving_date > p.period_end)) = 0 then 0 else round((count(*) filter (where e.employee_status = 'resigned' and e.leaving_date between p.period_start and p.period_end))::numeric / ((count(*) filter (where e.joining_date <= p.period_start and (e.leaving_date is null or e.leaving_date > p.period_start)) + count(*) filter (where e.joining_date <= p.period_end and (e.leaving_date is null or e.leaving_date > p.period_end)))::numeric / 2) * 100, 2) end from public.employees e where (%s)) as turnover_rate
      from periods p
    ) rows
  $query$, v_to, v_from, v_to, fw, fw, fw, fw) into movement;

  execute format($query$
    select coalesce(jsonb_agg(jsonb_build_object('key', id, 'label', name, 'count', employee_count) order by employee_count desc, name), '[]'::jsonb)
    from (select d.id, coalesce(d.name, 'Unassigned') name, count(*) employee_count from public.employees e left join public.departments d on d.id = e.department_id where (%s) and e.employee_status = 'active' group by d.id, d.name) rows
  $query$, fw) into departments;

  execute format($query$
    select coalesce(jsonb_agg(jsonb_build_object('key', id, 'label', name, 'count', employee_count) order by employee_count desc, name), '[]'::jsonb)
    from (select lr.id, coalesce(lr.name, 'Unassigned') name, count(*) employee_count from public.employees e left join public.leaving_reasons lr on lr.id = e.leaving_reason_id where (%s) and e.employee_status = 'resigned' and e.leaving_date between %L and %L group by lr.id, lr.name) rows
  $query$, fw, v_from, v_to) into reasons;

  execute format($query$
    select coalesce(jsonb_agg(jsonb_build_object('key', id, 'label', name, 'resigned', resigned, 'start_headcount', start_headcount, 'end_headcount', end_headcount, 'turnover_rate', turnover_rate) order by turnover_rate desc, name), '[]'::jsonb)
    from (
      select d.id, coalesce(d.name, 'Unassigned') name,
        count(*) filter (where e.employee_status = 'resigned' and e.leaving_date between %L and %L) resigned,
        count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L)) start_headcount,
        count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L)) end_headcount,
        case when count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L)) + count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L)) = 0 then 0 else round((count(*) filter (where e.employee_status = 'resigned' and e.leaving_date between %L and %L))::numeric / ((count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L)) + count(*) filter (where e.joining_date <= %L and (e.leaving_date is null or e.leaving_date > %L)))::numeric / 2) * 100, 2) end turnover_rate
      from public.employees e left join public.departments d on d.id = e.department_id where (%s) group by d.id, d.name
    ) rows
  $query$, v_from, v_to, v_from, v_from, v_to, v_to, v_from, v_from, v_to, v_to, v_from, v_to, v_from, v_from, v_to, v_to, fw) into turnover_departments;

  execute format($query$
    select jsonb_build_object(
      'gender', coalesce((select jsonb_agg(jsonb_build_object('key', gender, 'label', initcap(gender), 'count', count) order by count desc) from (select e.gender, count(*) from public.employees e where (%s) and e.employee_status = 'active' group by e.gender) q), '[]'::jsonb),
      'classification', coalesce((select jsonb_agg(jsonb_build_object('key', employee_classification, 'label', case when employee_classification = 'five_percent' then '5%%' else 'Standard' end, 'count', count) order by count desc) from (select e.employee_classification, count(*) from public.employees e where (%s) and e.employee_status = 'active' group by e.employee_classification) q), '[]'::jsonb),
      'governorate', coalesce((select jsonb_agg(jsonb_build_object('key', id, 'label', name, 'count', count) order by count desc, name) from (select g.id, coalesce(g.name, 'Unassigned') name, count(*) from public.employees e left join public.governorates g on g.id = e.governorate_id where (%s) and e.employee_status = 'active' group by g.id, g.name) q), '[]'::jsonb),
      'age_bands', coalesce((select jsonb_agg(jsonb_build_object('key', band, 'label', band, 'count', count) order by order_key) from (select case when extract(year from age(current_date, e.date_of_birth)) < 25 then '<25' when extract(year from age(current_date, e.date_of_birth)) < 35 then '25–34' when extract(year from age(current_date, e.date_of_birth)) < 45 then '35–44' when extract(year from age(current_date, e.date_of_birth)) < 55 then '45–54' else '55+' end band, case when extract(year from age(current_date, e.date_of_birth)) < 25 then 1 when extract(year from age(current_date, e.date_of_birth)) < 35 then 2 when extract(year from age(current_date, e.date_of_birth)) < 45 then 3 when extract(year from age(current_date, e.date_of_birth)) < 55 then 4 else 5 end order_key, count(*) from public.employees e where (%s) and e.employee_status = 'active' group by 1,2) q), '[]'::jsonb)
    )
  $query$, fw, fw, fw, fw) into composition;

  select coalesce(jsonb_agg(jsonb_build_object('metric', item.metric, 'label', item.label, 'count', item.count, 'severity', item.severity, 'recommended_filters', item.recommended_filters) order by item.count desc), '[]'::jsonb) into attention from public.dashboard_attention(p_filters) item;
  return jsonb_build_object('kpis', kpis, 'movement', movement, 'departments', departments, 'resignation_reasons', reasons, 'turnover_departments', turnover_departments, 'composition', composition, 'attention', attention);
end;
$$;

grant execute on function public.dashboard_executive(jsonb) to service_role;
