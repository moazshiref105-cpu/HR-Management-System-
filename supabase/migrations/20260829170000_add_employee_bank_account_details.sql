-- Banking details are employee-specific and remain optional.
alter table public.employees
  add column if not exists bank_account_holder_name text,
  add column if not exists bank_account_number text,
  add column if not exists iban text,
  add column if not exists bank_branch text;

alter table public.employees
  add constraint employees_bank_account_holder_name_not_blank check (bank_account_holder_name is null or nullif(btrim(bank_account_holder_name), '') is not null),
  add constraint employees_bank_account_number_not_blank check (bank_account_number is null or nullif(btrim(bank_account_number), '') is not null),
  add constraint employees_iban_egyptian_format check (iban is null or iban ~ '^EG[A-Z0-9]{27}$'),
  add constraint employees_bank_branch_not_blank check (bank_branch is null or nullif(btrim(bank_branch), '') is not null);
