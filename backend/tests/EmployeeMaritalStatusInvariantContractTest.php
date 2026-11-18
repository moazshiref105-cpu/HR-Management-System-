<?php

declare(strict_types=1);

function maritalAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__, 2);
$migrationPath = $root . '/supabase/migrations/20261118170000_enforce_married_status_for_spouse.sql';
$migration = (string) file_get_contents($migrationPath);
$normalized = strtolower($migration);
$employeeApi = (string) file_get_contents($root . '/backend/src/EmployeeApi.php');
$familyCreate = (string) file_get_contents($root . '/supabase/migrations/20261104100000_add_atomic_employee_family_create.sql');
$importBatch = (string) file_get_contents($root . '/supabase/migrations/20261118150000_add_import_export_center.sql');
$importSchema = (string) file_get_contents($root . '/backend/src/ImportExportSchema.php');
$audit = (string) file_get_contents($root . '/supabase/audits/employee_spouse_marital_status_review.sql');
$auditSql = preg_replace('/^\s*--.*$/m', '', $audit) ?? $audit;

maritalAssert(str_contains($normalized, "lower(btrim(name)) = 'married'"), 'Canonical status initialization must use an exact normalized name match.');
maritalAssert(str_contains($migration, 'HMS_MARRIED_STATUS_CANONICAL_MISSING') && str_contains($migration, 'HMS_MARRIED_STATUS_CANONICAL_AMBIGUOUS'), 'Migration must fail clearly when the canonical status is missing or ambiguous.');
maritalAssert(str_contains($normalized, 'create unique index if not exists marital_statuses_single_married_marker_idx'), 'Only one status may carry the system Married marker.');
maritalAssert(str_contains($normalized, 'after insert or update on public.employee_wives'), 'The database invariant must run on every spouse insert and update.');
maritalAssert(str_contains($normalized, 'employee.marital_status_id is distinct from v_married_status_id'), 'Spouse upserts must not churn employee audit fields when status is already Married.');
maritalAssert(str_contains($normalized, 'updated_by = coalesce(new.updated_by, employee.updated_by)'), 'Employee updater audit field must follow the spouse actor without erasing an existing value.');
maritalAssert(!preg_match('/(?:after|before)\s+delete\s+on\s+public\.employee_wives/i', $migration), 'No spouse-delete trigger may change marital status.');
maritalAssert(str_contains($normalized, 'update public.employees as employee'), 'Migration must backfill existing spouse-linked employees.');
maritalAssert(str_contains($normalized, 'exists (' . "\n" . '    select 1' . "\n" . '    from public.employee_wives as spouse'), 'Backfill must only touch employees with spouse records.');
maritalAssert(str_contains($normalized, 'employee.marital_status_id is distinct from married_status.id'), 'Backfill must avoid rewriting already-matched employees.');
maritalAssert(str_contains($migration, 'Preserve the') || str_contains($normalized, 'preserve the existing updated_by actor'), 'Backfill must preserve the existing updated_by actor.');

// Normal employee-family creation inserts spouses in one RPC transaction;
// profile edits POST/PATCH employee_wives directly. Both writes encounter the DB trigger.
maritalAssert(str_contains($employeeApi, "['wives', 'children', 'licenses']") && str_contains($employeeApi, "'/rest/v1/' . \$table"), 'Normal employee UI/API spouse writes must target employee_wives.');
maritalAssert(str_contains($familyCreate, 'insert into public.employee_wives'), 'Initial spouse creation must use the atomic family RPC path.');

// Import Center uses an Employee Number-resolved database RPC and an idempotent
// employee + National ID upsert; its insert/update also encounters the trigger.
maritalAssert(str_contains($importBatch, "if v_job.data_type='spouses' then"), 'The staged import RPC must retain its spouse record path.');
maritalAssert(str_contains($importBatch, 'on conflict(employee_id,identity_card_number) do update'), 'Spouse imports must remain idempotent on their employee/National ID key.');
maritalAssert(str_contains($importBatch, 'public.employee_wives(employee_id,wife_name,identity_card_number'), 'The import upsert must write the table guarded by the invariant.');
maritalAssert(!str_contains($importSchema, 'is_married_status'), 'The system marker must not appear in user-controlled workbook fields.');

maritalAssert(str_contains($audit, 'employee.employee_number') && str_contains($audit, 'current_marital_status'), 'Read-only audit must identify affected employees and their current status.');
maritalAssert(preg_match('/^\s*select\b/i', $auditSql) === 1 && !preg_match('/\b(insert|update|delete|merge)\s+into\b/i', $auditSql), 'Audit SQL must remain read-only.');
foreach (['arabic_full_name', 'english_full_name', 'identity_card_number', 'wife_name'] as $privateField) {
    maritalAssert(!str_contains($audit, $privateField), 'Audit query must avoid unnecessary personal or identity fields.');
}

echo "Employee marital status invariant contracts passed\n";
