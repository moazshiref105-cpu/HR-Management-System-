-- Persisted operational lists for contract renewals.  The employee contract
-- history remains the canonical completed-renewal record.
create table public.contract_renewal_lists (
  id uuid primary key default gen_random_uuid(),
  due_period date not null,
  name text not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_renewal_lists_due_period_month check (due_period = date_trunc('month', due_period)::date),
  constraint contract_renewal_lists_due_period_key unique (due_period)
);

create table public.contract_renewal_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.contract_renewal_lists(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  employee_number integer not null,
  employee_name_ar text not null,
  employee_name_en text not null,
  department_name text,
  position_name text,
  original_due_date date not null,
  original_contract_signing_date date not null,
  signed_contract_received_at timestamptz,
  signed_contract_received_by uuid references public.users(id),
  renewal_application_received_at timestamptz,
  renewal_application_received_by uuid references public.users(id),
  finalized_at timestamptz,
  finalized_by uuid references public.users(id),
  renewal_id bigint references public.employee_contract_renewals(id),
  finalization_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_renewal_list_items_cycle_key unique (employee_id, original_due_date),
  constraint contract_renewal_list_items_finalized_once check ((finalized_at is null and renewal_id is null) or (finalized_at is not null and renewal_id is not null))
);

create index contract_renewal_list_items_list_status_idx on public.contract_renewal_list_items (list_id, finalized_at, original_due_date);
create index contract_renewal_list_items_overdue_idx on public.contract_renewal_list_items (original_due_date) where finalized_at is null;

create trigger contract_renewal_lists_set_updated_at before update on public.contract_renewal_lists for each row execute function public.set_updated_at();
create trigger contract_renewal_list_items_set_updated_at before update on public.contract_renewal_list_items for each row execute function public.set_updated_at();

create or replace function public.create_contract_renewal_list(p_due_period date, p_name text, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_period date := date_trunc('month', p_due_period)::date;
  v_list_id uuid;
begin
  if p_due_period is null then raise exception 'A renewal due month is required'; end if;
  insert into public.contract_renewal_lists (due_period, name, created_by)
  values (v_period, coalesce(nullif(trim(p_name), ''), to_char(v_period, 'FMMonth YYYY') || ' Renewals'), p_actor_id)
  on conflict (due_period) do update set updated_at = now()
  returning id into v_list_id;

  insert into public.contract_renewal_list_items (
    list_id, employee_id, employee_number, employee_name_ar, employee_name_en,
    department_name, position_name, original_due_date, original_contract_signing_date
  )
  select v_list_id, e.id, e.employee_number, e.arabic_full_name, e.english_full_name,
    d.name, p.name, e.contract_expiration_date, e.contract_signing_date
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.positions p on p.id = e.position_id
  where e.employee_status = 'active'
    and e.contract_expiration_date >= v_period
    and e.contract_expiration_date < (v_period + interval '1 month')::date
  on conflict (employee_id, original_due_date) do nothing;
  return v_list_id;
end;
$$;

create or replace function public.contract_renewal_tracker_items(p_list_id uuid, p_status text, p_search text, p_page integer, p_page_size integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_offset integer := greatest(coalesce(p_page, 1) - 1, 0) * least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_total bigint;
  v_rows jsonb;
begin
  with filtered as (
    select i.*, case
      when i.finalized_at is not null then 'complete'
      when i.original_due_date < current_date then 'overdue'
      when i.signed_contract_received_at is null and i.renewal_application_received_at is null then 'waiting_documents'
      when i.signed_contract_received_at is null then 'waiting_contract'
      else 'waiting_application'
    end as status
    from public.contract_renewal_list_items i
    where i.list_id = p_list_id
      and (coalesce(p_search, '') = '' or i.employee_number::text ilike '%' || p_search || '%' or i.employee_name_ar ilike '%' || p_search || '%' or i.employee_name_en ilike '%' || p_search || '%')
  ), matched as (
    select * from filtered where coalesce(p_status, 'all') = 'all' or status = p_status
  )
  select count(*) into v_total from matched;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select id, employee_id, employee_number, employee_name_ar, employee_name_en, department_name, position_name,
      original_due_date, original_contract_signing_date, signed_contract_received_at, renewal_application_received_at,
      finalized_at, finalization_error, status
    from matched
    order by (status = 'overdue') desc, original_due_date asc, employee_number asc
    offset v_offset limit v_size
  ) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', greatest(coalesce(p_page, 1), 1), 'page_size', v_size, 'total_pages', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::integer end);
end;
$$;

create or replace function public.record_contract_renewal_receipts(p_item_ids uuid[], p_receipt text, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_item public.contract_renewal_list_items%rowtype;
  v_renewal public.employee_contract_renewals%rowtype;
  v_results jsonb := '[]'::jsonb;
begin
  if p_receipt not in ('signed_contract', 'renewal_application') then raise exception 'Unsupported receipt type'; end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then raise exception 'Select at least one renewal item'; end if;
  for v_item in select * from public.contract_renewal_list_items where id = any(p_item_ids) for update loop
    if v_item.finalized_at is null then
      if p_receipt = 'signed_contract' and v_item.signed_contract_received_at is null then
        update public.contract_renewal_list_items set signed_contract_received_at = now(), signed_contract_received_by = p_actor_id where id = v_item.id;
      elsif p_receipt = 'renewal_application' and v_item.renewal_application_received_at is null then
        update public.contract_renewal_list_items set renewal_application_received_at = now(), renewal_application_received_by = p_actor_id where id = v_item.id;
      end if;
      select * into v_item from public.contract_renewal_list_items where id = v_item.id for update;
      if v_item.signed_contract_received_at is not null and v_item.renewal_application_received_at is not null then
        begin
          select * into v_renewal from public.renew_employee_contract(v_item.employee_id, v_item.original_due_date + 1, p_actor_id);
          update public.contract_renewal_list_items set finalized_at = now(), finalized_by = p_actor_id, renewal_id = v_renewal.id, finalization_error = null where id = v_item.id;
        exception when others then
          update public.contract_renewal_list_items set finalization_error = sqlerrm where id = v_item.id;
        end;
      end if;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_item.id, 'finalized', exists(select 1 from public.contract_renewal_list_items i where i.id = v_item.id and i.finalized_at is not null)));
  end loop;
  return v_results;
end;
$$;

alter table public.contract_renewal_lists enable row level security;
alter table public.contract_renewal_list_items enable row level security;
revoke all on public.contract_renewal_lists, public.contract_renewal_list_items from anon, authenticated;
revoke all on function public.create_contract_renewal_list(date, text, uuid) from public, anon, authenticated;
revoke all on function public.contract_renewal_tracker_items(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_contract_renewal_receipts(uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.create_contract_renewal_list(date, text, uuid) to service_role;
grant execute on function public.contract_renewal_tracker_items(uuid, text, text, integer, integer) to service_role;
grant execute on function public.record_contract_renewal_receipts(uuid[], text, uuid) to service_role;
