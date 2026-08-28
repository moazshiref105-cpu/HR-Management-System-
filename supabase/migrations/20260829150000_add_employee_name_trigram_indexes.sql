-- Supports EmployeeApi partial-name searches: ILIKE '%term%' on large workforces.
create extension if not exists pg_trgm with schema extensions;

create index if not exists employees_english_name_trgm_idx
  on public.employees using gin (english_full_name extensions.gin_trgm_ops);

create index if not exists employees_arabic_name_trgm_idx
  on public.employees using gin (arabic_full_name extensions.gin_trgm_ops);
