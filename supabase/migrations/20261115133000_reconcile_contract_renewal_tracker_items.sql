-- A receipt-complete tracker item may predate this tracker while its
-- canonical renewal history already exists. Reconcile that history before
-- attempting a new renewal so receipt processing is idempotent.
create or replace function public.record_contract_renewal_receipts(p_item_ids uuid[], p_receipt text, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_item public.contract_renewal_list_items%rowtype;
  v_renewal public.employee_contract_renewals%rowtype;
  v_signing_date date;
  v_expiration_date date;
  v_results jsonb := '[]'::jsonb;
begin
  if p_receipt not in ('signed_contract', 'renewal_application', 'retry_finalization') then
    raise exception 'Unsupported receipt type';
  end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then
    raise exception 'Select at least one renewal item';
  end if;

  for v_item in
    select * from public.contract_renewal_list_items where id = any(p_item_ids) for update
  loop
    if v_item.finalized_at is null then
      if p_receipt = 'signed_contract' and v_item.signed_contract_received_at is null then
        update public.contract_renewal_list_items
        set signed_contract_received_at = now(), signed_contract_received_by = p_actor_id
        where id = v_item.id;
      elsif p_receipt = 'renewal_application' and v_item.renewal_application_received_at is null then
        update public.contract_renewal_list_items
        set renewal_application_received_at = now(), renewal_application_received_by = p_actor_id
        where id = v_item.id;
      end if;

      select * into v_item from public.contract_renewal_list_items where id = v_item.id for update;
      if v_item.signed_contract_received_at is not null and v_item.renewal_application_received_at is not null then
        v_signing_date := v_item.original_due_date + 1;
        v_expiration_date := (v_signing_date + interval '1 year - 1 day')::date;

        select * into v_renewal
        from public.employee_contract_renewals
        where employee_id = v_item.employee_id
          and (renewal_signing_date = v_signing_date or renewal_expiration_date = v_expiration_date)
        order by id desc
        limit 1;

        if found then
          update public.contract_renewal_list_items
          set finalized_at = now(), finalized_by = p_actor_id, renewal_id = v_renewal.id, finalization_error = null
          where id = v_item.id;
        else
          begin
            select * into v_renewal
            from public.renew_employee_contract(v_item.employee_id, v_signing_date, p_actor_id);
            update public.contract_renewal_list_items
            set finalized_at = now(), finalized_by = p_actor_id, renewal_id = v_renewal.id, finalization_error = null
            where id = v_item.id;
          exception when others then
            -- A concurrent canonical renewal can win after the first read.
            select * into v_renewal
            from public.employee_contract_renewals
            where employee_id = v_item.employee_id
              and (renewal_signing_date = v_signing_date or renewal_expiration_date = v_expiration_date)
            order by id desc
            limit 1;

            if found then
              update public.contract_renewal_list_items
              set finalized_at = now(), finalized_by = p_actor_id, renewal_id = v_renewal.id, finalization_error = null
              where id = v_item.id;
            else
              update public.contract_renewal_list_items
              set finalization_error = sqlerrm
              where id = v_item.id;
            end if;
          end;
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_item.id,
      'finalized', exists(
        select 1 from public.contract_renewal_list_items i
        where i.id = v_item.id and i.finalized_at is not null
      )
    ));
  end loop;
  return v_results;
end;
$$;

notify pgrst, 'reload schema';
