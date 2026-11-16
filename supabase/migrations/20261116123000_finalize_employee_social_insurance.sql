-- Finalize an already-applied Social Insurance schema.
alter table public.employee_social_insurance
  add column if not exists form_1_installation_date date,
  add column if not exists form_1_social_insurance_number text,
  add column if not exists form_1_incoming_number text,
  add column if not exists form_1_incoming_date date,
  add column if not exists form_1_insurance_status_text text,
  add column if not exists form_1_notes text,
  add column if not exists form_6_termination_date date,
  add column if not exists form_6_termination_reason text,
  add column if not exists form_6_social_insurance_number text,
  add column if not exists form_6_incoming_number text,
  add column if not exists form_6_incoming_date date,
  add column if not exists form_6_insurance_status_text text,
  add column if not exists form_6_notes text;

update public.employee_social_insurance s
set form_1_incoming_number=coalesce(s.form_1_incoming_number,e.form_1_incoming_number),
    form_1_incoming_date=coalesce(s.form_1_incoming_date,e.form_1_incoming_date),
    form_1_insurance_status_text=coalesce(s.form_1_insurance_status_text,case when e.social_insurance_active then 'تم التأمين عليه' when s.insured_status='not_insured' then 'غير مؤمن عليه' end),
    form_1_notes=coalesce(s.form_1_notes,nullif(e.social_insurance_comment,'')),
    form_6_termination_date=coalesce(s.form_6_termination_date,case when e.employee_status='resigned' then e.leaving_date end),
    form_6_termination_reason=coalesce(s.form_6_termination_reason,case when e.employee_status='resigned' then e.form_6_reason end),
    form_6_social_insurance_number=coalesce(s.form_6_social_insurance_number,s.form_1_social_insurance_number),
    form_6_incoming_number=coalesce(s.form_6_incoming_number,case when e.employee_status='resigned' then e.form_6_incoming_number end),
    form_6_incoming_date=coalesce(s.form_6_incoming_date,case when e.employee_status='resigned' then e.form_6_incoming_date end),
    form_6_insurance_status_text=coalesce(s.form_6_insurance_status_text,case when e.employee_status='resigned' and nullif(e.form_6_incoming_number,'') is not null then 'تم الفصل' end)
from public.employees e where e.id=s.employee_id;

drop trigger if exists employees_social_insurance_seed on public.employees;
drop function if exists public.employee_social_insurance_records(text,text,text,bigint,text,date,date,uuid,boolean,integer,integer);
drop function if exists public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer);
drop function if exists public.update_employee_social_insurance(uuid,jsonb,integer,uuid);
alter table public.employee_social_insurance
  drop column if exists insured_status,
  drop column if exists insurance_code_status,
  drop column if exists form_1_status,
  drop column if exists form_6_status,
  drop column if exists notes;

create or replace function public.ensure_employee_social_insurance()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $func$
begin
  if new.employee_status in ('active','resigned') then
    insert into public.employee_social_insurance(employee_id,form_1_incoming_number,form_1_incoming_date,form_1_insurance_status_text,form_1_notes,updated_by)
    values(new.id,new.form_1_incoming_number,new.form_1_incoming_date,case when new.social_insurance_active then 'تم التأمين عليه' end,nullif(new.social_insurance_comment,''),new.updated_by)
    on conflict(employee_id) do nothing;
  end if;
  if new.employee_status='resigned' and (tg_op='INSERT' or old.employee_status is distinct from 'resigned') then
    update public.employee_social_insurance set form_6_termination_date=coalesce(form_6_termination_date,new.leaving_date),form_6_termination_reason=coalesce(form_6_termination_reason,new.form_6_reason),form_6_social_insurance_number=coalesce(form_6_social_insurance_number,form_1_social_insurance_number),form_6_incoming_number=coalesce(form_6_incoming_number,new.form_6_incoming_number),form_6_incoming_date=coalesce(form_6_incoming_date,new.form_6_incoming_date),form_6_insurance_status_text=coalesce(form_6_insurance_status_text,case when nullif(new.form_6_incoming_number,'') is not null then 'تم الفصل' end),updated_by=new.updated_by where employee_id=new.id;
  end if;
  return new;
end $func$;
create trigger employees_social_insurance_seed after insert or update on public.employees for each row execute function public.ensure_employee_social_insurance();

create or replace function public.employee_social_insurance_records(p_form_type text default 'all',p_view text default 'all',p_department_id bigint default null,p_search text default null,p_from date default null,p_to date default null,p_employee_id uuid default null,p_page integer default 1,p_page_size integer default 25)
returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp as $func$
with records as (select s.*,e.employee_number,e.arabic_full_name,e.english_full_name,e.employee_status,e.department_id,d.name department_name,u.full_name updated_by_name,case when e.employee_status='active' then s.form_1_installation_date is null or nullif(btrim(s.form_1_social_insurance_number),'') is null or nullif(btrim(s.form_1_incoming_number),'') is null or s.form_1_incoming_date is null or nullif(btrim(s.form_1_insurance_status_text),'') is null when e.employee_status='resigned' then s.form_6_termination_date is null or nullif(btrim(s.form_6_termination_reason),'') is null or nullif(btrim(s.form_6_social_insurance_number),'') is null or nullif(btrim(s.form_6_incoming_number),'') is null or s.form_6_incoming_date is null or nullif(btrim(s.form_6_insurance_status_text),'') is null else false end needs_attention,case when e.employee_status='resigned' then coalesce(s.form_6_incoming_date,s.form_6_termination_date,s.updated_at::date) else coalesce(s.form_1_incoming_date,s.form_1_installation_date,s.updated_at::date) end relevant_date from public.employee_social_insurance s join public.employees e on e.id=s.employee_id left join public.departments d on d.id=e.department_id left join public.users u on u.id=s.updated_by where (p_employee_id is null or s.employee_id=p_employee_id) and (p_department_id is null or e.department_id=p_department_id) and (p_search is null or e.employee_number::text ilike '%'||p_search||'%' or e.arabic_full_name ilike '%'||p_search||'%' or e.english_full_name ilike '%'||p_search||'%')),filtered as (select * from records r where (p_form_type='all' or (p_form_type='form_1' and r.employee_status='active') or (p_form_type='form_6' and r.employee_status='resigned')) and (p_view='all' or (p_view='needs_attention' and r.needs_attention) or (p_view='form_1_needs_attention' and r.employee_status='active' and r.needs_attention) or (p_view='form_6_needs_attention' and r.employee_status='resigned' and r.needs_attention)) and (p_from is null or r.relevant_date>=p_from) and (p_to is null or r.relevant_date<=p_to)),paged as (select * from filtered order by updated_at desc,employee_number limit least(greatest(p_page_size,1),100) offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),100)) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),'total',(select count(*) from filtered),'page',greatest(p_page,1),'page_size',least(greatest(p_page_size,1),100))
$func$;

create or replace function public.update_employee_social_insurance(p_employee_id uuid,p_patch jsonb,p_expected_version integer,p_actor_id uuid)
returns public.employee_social_insurance language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $func$
declare v_row public.employee_social_insurance%rowtype;
begin
  insert into public.employee_social_insurance(employee_id,updated_by) select e.id,p_actor_id from public.employees e where e.id=p_employee_id and e.employee_status in ('active','resigned') on conflict(employee_id) do nothing;
  select * into v_row from public.employee_social_insurance where employee_id=p_employee_id for update;
  if not found then raise exception 'Employee does not exist or is not eligible.'; end if;
  if p_expected_version is not null and v_row.version<>p_expected_version then raise exception 'Social Insurance record changed. Reload before saving.' using errcode='40001'; end if;
  update public.employee_social_insurance set form_1_installation_date=case when p_patch?'form_1_installation_date' then nullif(p_patch->>'form_1_installation_date','')::date else form_1_installation_date end,form_1_social_insurance_number=case when p_patch?'form_1_social_insurance_number' then nullif(trim(p_patch->>'form_1_social_insurance_number'),'') else form_1_social_insurance_number end,form_1_incoming_number=case when p_patch?'form_1_incoming_number' then nullif(trim(p_patch->>'form_1_incoming_number'),'') else form_1_incoming_number end,form_1_incoming_date=case when p_patch?'form_1_incoming_date' then nullif(p_patch->>'form_1_incoming_date','')::date else form_1_incoming_date end,form_1_insurance_status_text=case when p_patch?'form_1_insurance_status_text' then nullif(trim(p_patch->>'form_1_insurance_status_text'),'') else form_1_insurance_status_text end,form_1_notes=case when p_patch?'form_1_notes' then nullif(p_patch->>'form_1_notes','') else form_1_notes end,form_6_termination_date=case when p_patch?'form_6_termination_date' then nullif(p_patch->>'form_6_termination_date','')::date else form_6_termination_date end,form_6_termination_reason=case when p_patch?'form_6_termination_reason' then nullif(trim(p_patch->>'form_6_termination_reason'),'') else form_6_termination_reason end,form_6_social_insurance_number=case when p_patch?'form_6_social_insurance_number' then nullif(trim(p_patch->>'form_6_social_insurance_number'),'') else form_6_social_insurance_number end,form_6_incoming_number=case when p_patch?'form_6_incoming_number' then nullif(trim(p_patch->>'form_6_incoming_number'),'') else form_6_incoming_number end,form_6_incoming_date=case when p_patch?'form_6_incoming_date' then nullif(p_patch->>'form_6_incoming_date','')::date else form_6_incoming_date end,form_6_insurance_status_text=case when p_patch?'form_6_insurance_status_text' then nullif(trim(p_patch->>'form_6_insurance_status_text'),'') else form_6_insurance_status_text end,form_6_notes=case when p_patch?'form_6_notes' then nullif(p_patch->>'form_6_notes','') else form_6_notes end,updated_by=p_actor_id where employee_id=p_employee_id returning * into v_row;
  return v_row;
end $func$;

revoke all on function public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.update_employee_social_insurance(uuid,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer) to service_role;
grant execute on function public.update_employee_social_insurance(uuid,jsonb,integer,uuid) to service_role;
