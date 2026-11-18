-- Align staged employee writes with the live employee schema. The original
-- bank-account migration intentionally removed these unused columns.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.import_export_process_batch(uuid,integer)'::regprocedure)
    into v_definition;

  if position('bank_account_holder_name=coalesce' in v_definition) = 0
     or position('bank_id,bank_account_holder_name,bank_account_number,iban,bank_branch,created_by,updated_by' in v_definition) = 0
     or position('v_data->>''bank_account_holder_name'',v_data->>''bank_account_number'',v_data->>''iban'',v_data->>''bank_branch''' in v_definition) = 0 then
    raise exception 'Import/export employee function does not match the expected pre-fix definition.';
  end if;

  v_definition := regexp_replace(
    v_definition,
    'bank_account_holder_name=coalesce\(v_data->>''bank_account_holder_name'',bank_account_holder_name\),[[:space:]]*bank_account_number=coalesce\(v_data->>''bank_account_number'',bank_account_number\),[[:space:]]*iban=coalesce\(v_data->>''iban'',iban\),[[:space:]]*bank_branch=coalesce\(v_data->>''bank_branch'',bank_branch\),',
    'bank_account_number=coalesce(v_data->>''bank_account_number'',bank_account_number),',
    'g'
  );
  v_definition := replace(
    v_definition,
    'bank_id,bank_account_holder_name,bank_account_number,iban,bank_branch,created_by,updated_by',
    'bank_id,bank_account_number,created_by,updated_by'
  );
  v_definition := replace(
    v_definition,
    '(v_data->>''bank_id'')::bigint,v_data->>''bank_account_holder_name'',v_data->>''bank_account_number'',v_data->>''iban'',v_data->>''bank_branch'',v_job.actor_id,v_job.actor_id',
    '(v_data->>''bank_id'')::bigint,v_data->>''bank_account_number'',v_job.actor_id,v_job.actor_id'
  );

  if position('bank_account_holder_name' in v_definition) > 0
     or position('iban' in v_definition) > 0
     or position('bank_branch' in v_definition) > 0 then
    raise exception 'Import/export employee function still references removed employee columns.';
  end if;

  execute v_definition;
end;
$$;
