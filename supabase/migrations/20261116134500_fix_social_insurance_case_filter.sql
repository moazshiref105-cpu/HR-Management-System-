-- Align the deployed Social Insurance RPC with the API contract.
drop function if exists public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer);
drop function if exists public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer,text);

create or replace function public.employee_social_insurance_records(
  p_form_type text default 'all', p_view text default 'all',
  p_department_id bigint default null, p_search text default null,
  p_from date default null, p_to date default null, p_employee_id uuid default null,
  p_page integer default 1, p_page_size integer default 25, p_case text default 'all'
)
returns jsonb
language sql security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with records as (
    select s.*,
      e.employee_number, e.arabic_full_name, e.english_full_name,
      e.leaving_reason_id, lr.name as leaving_reason_name,
      e.employee_status, e.department_id, d.name as department_name,
      u.full_name as updated_by_name,
      case when e.employee_status = 'active' then
        s.form_1_installation_date is null
        or nullif(btrim(s.form_1_social_insurance_number), '') is null
        or nullif(btrim(s.form_1_incoming_number), '') is null
        or s.form_1_incoming_date is null
        or nullif(btrim(s.form_1_insurance_status_text), '') is null
      when e.employee_status = 'resigned' then
        s.form_6_termination_date is null
        or nullif(btrim(s.form_6_termination_reason), '') is null
        or nullif(btrim(s.form_6_social_insurance_number), '') is null
        or nullif(btrim(s.form_6_incoming_number), '') is null
        or s.form_6_incoming_date is null
        or nullif(btrim(s.form_6_insurance_status_text), '') is null
      else false end as needs_attention,
      case when e.employee_status = 'resigned'
        then coalesce(s.form_6_incoming_date, s.form_6_termination_date, s.updated_at::date)
        else coalesce(s.form_1_incoming_date, s.form_1_installation_date, s.updated_at::date)
      end as relevant_date
    from public.employee_social_insurance s
    join public.employees e on e.id = s.employee_id
    left join public.departments d on d.id = e.department_id
    left join public.leaving_reasons lr on lr.id = e.leaving_reason_id
    left join public.users u on u.id = s.updated_by
    where (p_employee_id is null or s.employee_id = p_employee_id)
      and (p_department_id is null or e.department_id = p_department_id)
      and (p_search is null or e.employee_number::text ilike '%' || p_search || '%'
        or e.arabic_full_name ilike '%' || p_search || '%'
        or e.english_full_name ilike '%' || p_search || '%')
  ), filtered as (
    select * from records r
    where (p_form_type = 'all'
      or (p_form_type = 'form_1' and r.employee_status = 'active')
      or (p_form_type = 'form_6' and r.employee_status = 'resigned'))
      and (p_view = 'all'
        or (p_view = 'needs_attention' and r.needs_attention)
        or (p_view = 'form_1_needs_attention' and r.employee_status = 'active' and r.needs_attention)
        or (p_view = 'form_6_needs_attention' and r.employee_status = 'resigned' and r.needs_attention))
      and (p_case = 'all'
        or (p_case = 'needs_attention' and r.needs_attention)
        or (p_case = 'complete' and not r.needs_attention))
      and (p_from is null or r.relevant_date >= p_from)
      and (p_to is null or r.relevant_date <= p_to)
  ), paged as (
    select * from filtered
    order by updated_at desc, employee_number
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', greatest(p_page, 1),
    'page_size', least(greatest(p_page_size, 1), 100)
  );
$$;

revoke all on function public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer,text)
  to service_role;
