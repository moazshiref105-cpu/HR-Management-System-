-- Consolidates the existing Dashboard overview reads into one PostgREST call.
-- It deliberately delegates to the established metric, employee, and attention
-- functions so their business definitions remain the single source of truth.
create or replace function public.dashboard_overview(
  p_metric text,
  p_dimension text,
  p_filters jsonb default '{}'::jsonb,
  p_page int default 1,
  p_page_size int default 10
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_metric text;
  v_summary jsonb := '{}'::jsonb;
  v_analysis jsonb;
  v_attention jsonb;
  v_total bigint;
begin
  foreach v_metric in array array[
    'total_employees',
    'active_employees',
    'new_hires',
    'resigned_employees',
    'contracts_expiring',
    'missing_form_1'
  ] loop
    select coalesce(sum(item.count), 0)
      into v_total
      from public.dashboard_analysis(v_metric, 'employee_status', p_filters) as item;
    v_summary := v_summary || jsonb_build_object(v_metric, v_total);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb)
    into v_analysis
    from public.dashboard_analysis(p_metric, p_dimension, p_filters) as item;

  select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb)
    into v_attention
    from public.dashboard_attention(p_filters) as item;

  return jsonb_build_object(
    'summary_counts', v_summary,
    'analysis', v_analysis,
    'employees', public.dashboard_employees(p_metric, p_filters, p_page, p_page_size),
    'attention', v_attention
  );
end;
$$;

grant execute on function public.dashboard_overview(text, text, jsonb, int, int) to service_role;
