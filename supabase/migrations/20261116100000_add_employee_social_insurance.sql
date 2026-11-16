-- Social Insurance final model: one employee record containing the Form 1 and
-- Form 6 business fields. Existing audit rows and concurrency metadata remain.

create table if not exists public.employee_social_insurance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete restrict,
  form_1_installation_date date,
  form_1_social_insurance_number text,
  form_1_incoming_number text,
  form_1_incoming_date date,
  form_1_insurance_status_text text,
  form_1_notes text,
  form_6_termination_date date,
  form_6_termination_reason text,
  form_6_social_insurance_number text,
  form_6_incoming_number text,
  form_6_incoming_date date,
  form_6_insurance_status_text text,
  form_6_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  version integer not null default 1
);

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
  add column if not exists form_6_notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users(id),
  add column if not exists version integer not null default 1;

create unique index if not exists employee_social_insurance_employee_uidx
  on public.employee_social_insurance(employee_id);

-- Stop the previous RPC/trigger versions before removing their status columns.
drop trigger if exists employees_social_insurance_seed on public.employees;
drop trigger if exists employee_social_insurance_audit_change on public.employee_social_insurance;
drop trigger if exists employee_social_insurance_updated_at on public.employee_social_insurance;
drop function if exists public.employee_social_insurance_records(text,text,text,bigint,text,date,date,uuid,boolean,integer,integer);
drop function if exists public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer);
drop function if exists public.update_employee_social_insurance(uuid,jsonb,integer,uuid);

-- Carry forward the old tracking values into final business text/notes fields.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_social_insurance' and column_name='insured_status') then
    execute $q$
      update public.employee_social_insurance
      set form_1_insurance_status_text = coalesce(
            form_1_insurance_status_text,
            case insured_status when 'insured' then 'تم التأمين عليه' when 'not_insured' then 'غير مؤمن عليه' end
          ),
          form_1_notes = nullif(concat_ws(E'\n', nullif(form_1_notes,''), case when nullif(insured_status,'') is not null and insured_status not in ('insured','not_insured') then 'Legacy insured state: ' || insured_status end), '')
    $q$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_social_insurance' and column_name='insurance_code_status') then
    execute $q$
      update public.employee_social_insurance
      set form_1_notes = nullif(concat_ws(E'\n', nullif(form_1_notes,''), case when insurance_code_status is not null then 'Legacy insurance code state: ' || insurance_code_status end), '')
    $q$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_social_insurance' and column_name='form_1_status') then
    execute $q$
      update public.employee_social_insurance
      set form_1_notes = nullif(concat_ws(E'\n', nullif(form_1_notes,''), case when nullif(form_1_status,'') is not null then 'Legacy Form 1 tracking state: ' || form_1_status end), '')
    $q$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_social_insurance' and column_name='form_6_status') then
    execute $q$
      update public.employee_social_insurance
      set form_6_notes = nullif(concat_ws(E'\n', nullif(form_6_notes,''), case when nullif(form_6_status,'') is not null then 'Legacy Form 6 tracking state: ' || form_6_status end), '')
    $q$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_social_insurance' and column_name='notes') then
    execute $q$
      update public.employee_social_insurance s
      set form_1_notes = nullif(concat_ws(E'\n',nullif(s.form_1_notes,''),nullif(s.notes,'')),''),
          form_6_notes = case when e.employee_status='resigned' then nullif(concat_ws(E'\n',nullif(s.form_6_notes,''),nullif(s.notes,'')),'') else s.form_6_notes end
      from public.employees e where e.id=s.employee_id
    $q$;
  end if;

  update public.employee_social_insurance s
  set form_1_incoming_number=coalesce(s.form_1_incoming_number,e.form_1_incoming_number),
      form_1_incoming_date=coalesce(s.form_1_incoming_date,e.form_1_incoming_date),
      form_1_insurance_status_text=coalesce(s.form_1_insurance_status_text,case when e.social_insurance_active then 'تم التأمين عليه' else 'غير مؤمن عليه' end),
      form_1_notes=nullif(concat_ws(E'\n',nullif(s.form_1_notes,''),nullif(e.social_insurance_comment,'')),''),
      form_6_termination_date=coalesce(s.form_6_termination_date,case when e.employee_status='resigned' then e.leaving_date end),
      form_6_termination_reason=coalesce(s.form_6_termination_reason,case when e.employee_status='resigned' then e.form_6_reason end),
      form_6_social_insurance_number=coalesce(s.form_6_social_insurance_number,s.form_1_social_insurance_number),
      form_6_incoming_number=coalesce(s.form_6_incoming_number,case when e.employee_status='resigned' then e.form_6_incoming_number end),
      form_6_incoming_date=coalesce(s.form_6_incoming_date,case when e.employee_status='resigned' then e.form_6_incoming_date end),
      form_6_insurance_status_text=coalesce(s.form_6_insurance_status_text,case when e.employee_status='resigned' and nullif(e.form_6_incoming_number,'') is not null then 'تم الفصل' end)
  from public.employees e where e.id=s.employee_id;
end $$;

-- The employee table still owns the legacy fields used by existing workflows.
-- Copy them into the single normalized record; do not remove or rewrite them.
insert into public.employee_social_insurance (
  employee_id, form_1_incoming_number, form_1_incoming_date,
  form_1_insurance_status_text, form_1_notes,
  form_6_termination_date, form_6_termination_reason,
  form_6_social_insurance_number, form_6_incoming_number, form_6_incoming_date,
  form_6_insurance_status_text, form_6_notes, updated_by
)
select e.id, e.form_1_incoming_number, e.form_1_incoming_date,
  case when e.social_insurance_active then 'تم التأمين عليه' else 'غير مؤمن عليه' end,
  nullif(e.social_insurance_comment,''),
  case when e.employee_status='resigned' then e.leaving_date end,
  case when e.employee_status='resigned' then e.form_6_reason end,
  case when e.employee_status='resigned' then s.form_1_social_insurance_number end,
  case when e.employee_status='resigned' then e.form_6_incoming_number end,
  case when e.employee_status='resigned' then e.form_6_incoming_date end,
  case when e.employee_status='resigned' and nullif(e.form_6_incoming_number,'') is not null then 'تم الفصل' end,
  null, e.updated_by
from public.employees e
left join public.employee_social_insurance s on s.employee_id=e.id
where e.employee_status in ('active','resigned')
on conflict(employee_id) do nothing;

-- Snapshot the insured number and termination details when an employee resigns.
create or replace function public.ensure_employee_social_insurance()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.employee_status in ('active','resigned') then
    insert into public.employee_social_insurance (
      employee_id, form_1_incoming_number, form_1_incoming_date,
      form_1_insurance_status_text, form_1_notes, updated_by
    ) values (
      new.id, new.form_1_incoming_number, new.form_1_incoming_date,
      case when new.social_insurance_active then 'تم التأمين عليه' end,
      nullif(new.social_insurance_comment,''), new.updated_by
    ) on conflict(employee_id) do nothing;
  end if;

  if new.employee_status='resigned' and (tg_op='INSERT' or old.employee_status is distinct from 'resigned') then
    update public.employee_social_insurance
    set form_6_termination_date=coalesce(form_6_termination_date,new.leaving_date),
        form_6_termination_reason=coalesce(form_6_termination_reason,new.form_6_reason),
        form_6_social_insurance_number=coalesce(nullif(form_6_social_insurance_number,''),form_1_social_insurance_number),
        form_6_incoming_number=coalesce(form_6_incoming_number,new.form_6_incoming_number),
        form_6_incoming_date=coalesce(form_6_incoming_date,new.form_6_incoming_date),
        form_6_insurance_status_text=coalesce(form_6_insurance_status_text,case when nullif(new.form_6_incoming_number,'') is not null then 'تم الفصل' end),
        updated_by=new.updated_by
    where employee_id=new.id;
  end if;
  return new;
end $$;
create trigger employees_social_insurance_seed after insert or update on public.employees
for each row execute function public.ensure_employee_social_insurance();

-- Remove only fields and constraints from the former tracking/status model.
alter table public.employee_social_insurance
  drop constraint if exists employee_social_insurance_form1_receipt,
  drop constraint if exists employee_social_insurance_form6_receipt,
  drop constraint if exists employee_social_insurance_number_format;
drop index if exists public.employee_social_insurance_form1_idx;
drop index if exists public.employee_social_insurance_form6_idx;
alter table public.employee_social_insurance
  drop column if exists insured_status,
  drop column if exists insurance_code_status,
  drop column if exists form_1_status,
  drop column if exists form_6_status,
  drop column if exists notes;

create table if not exists public.employee_social_insurance_audit (
  id bigint generated by default as identity primary key,
  employee_id uuid not null references public.employees(id) on delete restrict,
  actor_id uuid references public.users(id),
  changed_at timestamptz not null default now(),
  changes jsonb not null
);
create index if not exists employee_social_insurance_audit_history_idx
  on public.employee_social_insurance_audit(employee_id, changed_at desc);

create or replace function public.audit_employee_social_insurance()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_changes jsonb;
begin
  if tg_op='INSERT' then
    v_changes := to_jsonb(new) - array['id','employee_id','created_at','updated_at','updated_by','version'];
    insert into public.employee_social_insurance_audit(employee_id,actor_id,changes)
    values(new.employee_id,new.updated_by,jsonb_build_object('created',v_changes));
    return new;
  end if;
  select coalesce(jsonb_object_agg(key,jsonb_build_object('old',old_value,'new',new_value)),'{}'::jsonb)
    into v_changes
  from jsonb_each(to_jsonb(old)) o(key,old_value)
  join jsonb_each(to_jsonb(new)) n(key,new_value) using(key)
  where key not in ('id','employee_id','created_at','updated_at','updated_by','version')
    and old_value is distinct from new_value;
  if v_changes <> '{}'::jsonb then
    insert into public.employee_social_insurance_audit(employee_id,actor_id,changes)
    values(new.employee_id,new.updated_by,v_changes);
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger employee_social_insurance_audit_change before insert or update
on public.employee_social_insurance for each row execute function public.audit_employee_social_insurance();
create trigger employee_social_insurance_updated_at before update
on public.employee_social_insurance for each row execute function public.set_updated_at();

create or replace function public.employee_social_insurance_records(
  p_form_type text default 'all', p_view text default 'all',
  p_department_id bigint default null, p_search text default null,
  p_from date default null, p_to date default null, p_employee_id uuid default null,
  p_page integer default 1, p_page_size integer default 25, p_case text default 'all'
)
returns jsonb language sql security definer
set search_path = pg_catalog, public, pg_temp as $$
  with records as (
    select s.*,e.employee_number,e.arabic_full_name,e.english_full_name,e.leaving_reason_id,
      lr.name leaving_reason_name,
      e.employee_status,e.department_id,d.name department_name,u.full_name updated_by_name,
      case when e.employee_status='active' then
        s.form_1_installation_date is null
        or nullif(btrim(s.form_1_social_insurance_number),'') is null
        or nullif(btrim(s.form_1_incoming_number),'') is null
        or s.form_1_incoming_date is null
        or nullif(btrim(s.form_1_insurance_status_text),'') is null
      when e.employee_status='resigned' then
        s.form_6_termination_date is null
        or nullif(btrim(s.form_6_termination_reason),'') is null
        or nullif(btrim(s.form_6_social_insurance_number),'') is null
        or nullif(btrim(s.form_6_incoming_number),'') is null
        or s.form_6_incoming_date is null
        or nullif(btrim(s.form_6_insurance_status_text),'') is null
      else false end needs_attention,
      case when e.employee_status='resigned' then coalesce(s.form_6_incoming_date,s.form_6_termination_date,s.updated_at::date)
           else coalesce(s.form_1_incoming_date,s.form_1_installation_date,s.updated_at::date) end relevant_date
    from public.employee_social_insurance s
    join public.employees e on e.id=s.employee_id
    left join public.departments d on d.id=e.department_id
    left join public.leaving_reasons lr on lr.id=e.leaving_reason_id
    left join public.users u on u.id=s.updated_by
    where (p_employee_id is null or s.employee_id=p_employee_id)
      and (p_department_id is null or e.department_id=p_department_id)
      and (p_search is null or e.employee_number::text ilike '%'||p_search||'%'
        or e.arabic_full_name ilike '%'||p_search||'%' or e.english_full_name ilike '%'||p_search||'%')
  ), filtered as (
    select * from records r
    where (p_form_type='all' or (p_form_type='form_1' and r.employee_status='active')
      or (p_form_type='form_6' and r.employee_status='resigned'))
      and (p_view='all'
        or (p_view='needs_attention' and r.needs_attention)
        or (p_view='form_1_needs_attention' and r.employee_status='active' and r.needs_attention)
        or (p_view='form_6_needs_attention' and r.employee_status='resigned' and r.needs_attention))
      and (p_case='all' or (p_case='needs_attention' and r.needs_attention) or (p_case='complete' and not r.needs_attention))
      and (p_from is null or r.relevant_date>=p_from)
      and (p_to is null or r.relevant_date<=p_to)
  ), paged as (
    select * from filtered order by updated_at desc,employee_number
    limit least(greatest(p_page_size,1),100)
    offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),100)
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',greatest(p_page,1),
    'page_size',least(greatest(p_page_size,1),100)
  )
$$;

create or replace function public.update_employee_social_insurance(
  p_employee_id uuid,p_patch jsonb,p_expected_version integer,p_actor_id uuid
)
returns public.employee_social_insurance language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_row public.employee_social_insurance%rowtype; v_employee_status text; v_reason_id bigint; v_current_reason_id bigint; v_expected_reason_id bigint;
begin
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) k
    where k not in (
      'form_1_installation_date','form_1_social_insurance_number','form_1_incoming_number',
      'form_1_incoming_date','form_1_insurance_status_text','form_1_notes',
      'form_6_termination_date','form_6_termination_reason','form_6_social_insurance_number',
      'form_6_incoming_number','form_6_incoming_date','form_6_insurance_status_text','form_6_notes',
      'leaving_reason_id','expected_leaving_reason_id'
    )
  ) then raise exception 'Unsupported Social Insurance field.' using errcode='22023'; end if;

  insert into public.employee_social_insurance(employee_id,updated_by)
  select e.id,p_actor_id from public.employees e
  where e.id=p_employee_id and e.employee_status in ('active','resigned')
  on conflict(employee_id) do nothing;
  select * into v_row from public.employee_social_insurance
  where employee_id=p_employee_id for update;
  if not found then raise exception 'Employee does not exist or is not eligible.' using errcode='P0002'; end if;
  if p_expected_version is not null and v_row.version<>p_expected_version then
    raise exception 'Social Insurance record changed. Reload before saving.' using errcode='40001';
  end if;

  if p_patch?'leaving_reason_id' then
    if not p_patch?'expected_leaving_reason_id' then
      raise exception 'Reload the employee before changing the leaving reason.' using errcode='40001';
    end if;
    select employee_status,leaving_reason_id into v_employee_status,v_current_reason_id
      from public.employees where id=p_employee_id for update;
    if v_employee_status is distinct from 'resigned' then
      raise exception 'Leaving reasons apply only to resigned employees.' using errcode='22023';
    end if;
    v_reason_id := nullif(p_patch->>'leaving_reason_id','')::bigint;
    v_expected_reason_id := nullif(p_patch->>'expected_leaving_reason_id','')::bigint;
    if v_current_reason_id is distinct from v_expected_reason_id then
      raise exception 'The employee leaving reason changed. Reload before saving.' using errcode='40001';
    end if;
    if v_reason_id is not null and not exists(select 1 from public.leaving_reasons where id=v_reason_id) then
      raise exception 'Choose a valid leaving reason.' using errcode='22023';
    end if;
    update public.employees set leaving_reason_id=v_reason_id,updated_by=p_actor_id where id=p_employee_id;
  end if;

  update public.employee_social_insurance set
    form_1_installation_date=case when p_patch?'form_1_installation_date' then nullif(p_patch->>'form_1_installation_date','')::date else form_1_installation_date end,
    form_1_social_insurance_number=case when p_patch?'form_1_social_insurance_number' then p_patch->>'form_1_social_insurance_number' else form_1_social_insurance_number end,
    form_1_incoming_number=case when p_patch?'form_1_incoming_number' then p_patch->>'form_1_incoming_number' else form_1_incoming_number end,
    form_1_incoming_date=case when p_patch?'form_1_incoming_date' then nullif(p_patch->>'form_1_incoming_date','')::date else form_1_incoming_date end,
    form_1_insurance_status_text=case when p_patch?'form_1_insurance_status_text' then p_patch->>'form_1_insurance_status_text' else form_1_insurance_status_text end,
    form_1_notes=case when p_patch?'form_1_notes' then p_patch->>'form_1_notes' else form_1_notes end,
    form_6_termination_date=case when p_patch?'form_6_termination_date' then nullif(p_patch->>'form_6_termination_date','')::date else form_6_termination_date end,
    form_6_termination_reason=case when p_patch?'form_6_termination_reason' then p_patch->>'form_6_termination_reason' else form_6_termination_reason end,
    form_6_social_insurance_number=case when p_patch?'form_6_social_insurance_number' then p_patch->>'form_6_social_insurance_number' else form_6_social_insurance_number end,
    form_6_incoming_number=case when p_patch?'form_6_incoming_number' then p_patch->>'form_6_incoming_number' else form_6_incoming_number end,
    form_6_incoming_date=case when p_patch?'form_6_incoming_date' then nullif(p_patch->>'form_6_incoming_date','')::date else form_6_incoming_date end,
    form_6_insurance_status_text=case when p_patch?'form_6_insurance_status_text' then p_patch->>'form_6_insurance_status_text' else form_6_insurance_status_text end,
    form_6_notes=case when p_patch?'form_6_notes' then p_patch->>'form_6_notes' else form_6_notes end,
    updated_by=p_actor_id
  where employee_id=p_employee_id returning * into v_row;
  return v_row;
end $$;

alter table public.employee_social_insurance enable row level security;
alter table public.employee_social_insurance_audit enable row level security;
revoke all on public.employee_social_insurance,public.employee_social_insurance_audit from anon,authenticated;
revoke all on function public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer,text) from public,anon,authenticated;
revoke all on function public.update_employee_social_insurance(uuid,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function public.employee_social_insurance_records(text,text,bigint,text,date,date,uuid,integer,integer,text) to service_role;
grant execute on function public.update_employee_social_insurance(uuid,jsonb,integer,uuid) to service_role;
