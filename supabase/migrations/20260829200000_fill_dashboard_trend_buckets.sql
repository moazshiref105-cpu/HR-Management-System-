-- Keep movement series continuous so zero-activity periods remain visible.
create or replace function public.dashboard_trend(p_metric text,p_from date,p_to date,p_granularity text default 'month',p_filters jsonb default '{}'::jsonb)
returns table(period text,count bigint)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare expr text; pred text; fw text; fmt text; step text;
begin
  if p_metric not in ('new_hires','resigned_employees') then raise exception 'Unsupported trend metric'; end if;
  if p_granularity not in ('day','week','month','quarter','year') then raise exception 'Unsupported trend granularity'; end if;
  if p_to < p_from then raise exception 'Trend end date cannot be before start date'; end if;
  expr:=case when p_metric='new_hires' then 'e.joining_date' else 'e.leaving_date' end;
  pred:=public.dashboard_metric_where(p_metric,p_from,p_to); fw:=public.dashboard_filter_where(p_filters);
  step:=case p_granularity when 'day' then '1 day' when 'week' then '1 week' when 'month' then '1 month' when 'quarter' then '3 months' else '1 year' end;
  fmt:=case p_granularity when 'day' then 'YYYY-MM-DD' when 'week' then 'IYYY-"W"IW' when 'month' then 'YYYY-MM' when 'quarter' then 'YYYY-"Q"Q' else 'YYYY' end;
  return query execute format('with buckets as (select date_trunc(%L, d)::date bucket from generate_series(date_trunc(%L, $1::timestamp), date_trunc(%L, $2::timestamp), %L::interval) d), counts as (select date_trunc(%L, %s)::date bucket,count(*)::bigint n from public.employees e where (%s) and (%s) group by 1) select to_char(b.bucket,%L),coalesce(c.n,0)::bigint from buckets b left join counts c using(bucket) order by b.bucket',p_granularity,p_granularity,p_granularity,step,p_granularity,expr,pred,fw,fmt) using p_from,p_to;
end $$;
grant execute on function public.dashboard_trend(text,date,date,text,jsonb) to service_role;
