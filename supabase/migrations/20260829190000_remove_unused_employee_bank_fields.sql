-- Employee banking is intentionally limited to the bank and account number.
-- The prior migration is already applied, so remove only its unused nullable fields.
alter table public.employees
  drop column if exists bank_account_holder_name,
  drop column if exists iban,
  drop column if exists bank_branch;
