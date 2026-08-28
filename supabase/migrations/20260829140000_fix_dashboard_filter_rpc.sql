create or replace function public.dashboard_filter_where(p_filters jsonb default '{}'::jsonb)
returns text language plpgsql stable as $$
declare k text; v text; out_where text:='true'; map jsonb:=jsonb_build_object('department_id','e.department_id','team_id','e.team_id','position_id','e.position_id','project_id','e.project_id','governorate_id','e.governorate_id','leaving_reason_id','e.leaving_reason_id','shift_type_id','e.shift_type_id','bank_id','e.bank_id','gender','e.gender','employee_status','e.employee_status','employee_classification','e.employee_classification','marital_status_id','e.marital_status_id','religion_id','e.religion_id','diploma_id','e.diploma_id');
begin
  for k in select jsonb_object_keys(map) loop
    v:=nullif(p_filters->>k,''); if v is not null then out_where:=out_where||format(' and %s = %L',map->>k,v); end if;
  end loop;
  v:=nullif(p_filters->>'search',''); if v is not null then out_where:=out_where||format(' and (e.employee_number::text ilike %L or e.english_full_name ilike %L or e.arabic_full_name ilike %L)','%'||v||'%','%'||v||'%','%'||v||'%'); end if;
  return out_where;
end $$;
