-- Dashboard workforce data RPCs are called by the authenticated backend with
-- the service role. They must not be callable directly by browser roles.
revoke execute on function public.dashboard_metric_where(text, date, date) from public, anon, authenticated;
revoke execute on function public.dashboard_filter_where(jsonb) from public, anon, authenticated;
revoke execute on function public.dashboard_analysis(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.dashboard_employees(text, jsonb, integer, integer) from public, anon, authenticated;
revoke execute on function public.dashboard_trend(text, date, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public.dashboard_attention(jsonb) from public, anon, authenticated;
revoke execute on function public.dashboard_executive(jsonb) from public, anon, authenticated;
revoke execute on function public.dashboard_overview(text, text, jsonb, integer, integer) from public, anon, authenticated;

grant execute on function public.dashboard_metric_where(text, date, date) to service_role;
grant execute on function public.dashboard_filter_where(jsonb) to service_role;
grant execute on function public.dashboard_analysis(text, text, jsonb) to service_role;
grant execute on function public.dashboard_employees(text, jsonb, integer, integer) to service_role;
grant execute on function public.dashboard_trend(text, date, date, text, jsonb) to service_role;
grant execute on function public.dashboard_attention(jsonb) to service_role;
grant execute on function public.dashboard_executive(jsonb) to service_role;
grant execute on function public.dashboard_overview(text, text, jsonb, integer, integer) to service_role;
