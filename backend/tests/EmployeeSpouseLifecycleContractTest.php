<?php

declare(strict_types=1);

$root = dirname(__DIR__, 2);
$migration = (string) file_get_contents($root . '/supabase/migrations/20261118180000_add_employee_spouse_lifecycle.sql');
$employeeApi = (string) file_get_contents($root . '/backend/src/EmployeeApi.php');
$createFamily = (string) file_get_contents($root . '/supabase/migrations/20261104100000_add_atomic_employee_family_create.sql');
$importRpc = (string) file_get_contents($root . '/supabase/migrations/20261118150000_add_import_export_center.sql');
$schema = (string) file_get_contents($root . '/backend/src/ImportExportSchema.php');
$importApi = (string) file_get_contents($root . '/backend/src/ImportExportApi.php');
$profile = (string) file_get_contents($root . '/frontend/src/Employees.jsx');
$styles = (string) file_get_contents($root . '/frontend/src/styles.css');
$foundation = (string) file_get_contents($root . '/supabase/migrations/20260828090000_add_employees_backend_foundation.sql');

function spouseLifecycleAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$normalized = strtolower(preg_replace('/\s+/', ' ', $migration));
$endStart = strpos($normalized, 'create or replace function public.end_employee_wife_marriage(');
$correctStart = strpos($normalized, 'create or replace function public.correct_employee_wife_record(');
$endFunction = substr($normalized, $endStart, $correctStart - $endStart);
$correctFunction = substr($normalized, $correctStart);
$divorceBranchStart = strpos($endFunction, "if p_end_reason = 'divorce' then");
$deathBranchStart = strpos($endFunction, 'else select count(*)');
$markerValidationStart = strpos($endFunction, 'end if; if v_marker_count = 0');
$divorceBranch = substr($endFunction, $divorceBranchStart, $deathBranchStart - $divorceBranchStart);
$deathBranch = substr($endFunction, $deathBranchStart, $markerValidationStart - $deathBranchStart);
spouseLifecycleAssert(str_contains($normalized, "relationship_status text not null default 'current'"), 'Existing and newly created spouse records default to Current.');
spouseLifecycleAssert(str_contains($normalized, "where lower(btrim(name)) = 'divorced'"), 'Divorced lookup resolution uses exact normalized names.');
spouseLifecycleAssert(str_contains($normalized, "where lower(btrim(name)) = 'widowed'"), 'Widowed lookup resolution uses exact normalized names.');
spouseLifecycleAssert(str_contains($normalized, 'hms_divorced_status_ambiguous') && str_contains($normalized, 'hms_widowed_status_ambiguous'), 'Ambiguous canonical marital statuses fail clearly.');
spouseLifecycleAssert(str_contains($normalized, 'relationship_status = \'current\'') && str_contains($normalized, 'is_married_status = true'), 'Only current spouses set the employee to the marked Married status.');
spouseLifecycleAssert(str_contains($normalized, 'employees_current_spouse_married_guard'), 'Employee updates cannot move an employee with a current spouse away from Married.');
spouseLifecycleAssert(str_contains($normalized, 'for update') && str_contains($normalized, 'hms_spouse_stale_version'), 'Lifecycle RPCs lock rows and reject stale spouse versions.');
spouseLifecycleAssert(str_contains($normalized, 'hms_resulting_status_required') && str_contains($normalized, 'p_resulting_marital_status_id'), 'Ending/correcting the last current spouse requires an explicit resulting status.');
spouseLifecycleAssert(str_contains($normalized, 'if v_current_count > 0 then') && str_contains($normalized, "'current_spouse_count', v_current_count"), 'Ending one of multiple current spouses preserves Married and reports remaining current spouses.');
spouseLifecycleAssert(str_contains($divorceBranch, 'where is_divorced_status = true') && !str_contains($divorceBranch, 'is_widowed_status'), 'Divorce accepts only the canonical Divorced marker.');
spouseLifecycleAssert(str_contains($deathBranch, 'where is_widowed_status = true') && !str_contains($deathBranch, 'is_divorced_status'), 'Death accepts only the canonical Widowed marker.');
spouseLifecycleAssert(str_contains($endFunction, 'hms_resulting_status_marker_missing') && str_contains($endFunction, 'hms_resulting_status_marker_ambiguous') && str_contains($endFunction, 'hms_resulting_status_marker_inactive'), 'Missing, ambiguous, and inactive reason-specific markers are rejected.');
spouseLifecycleAssert(str_contains($endFunction, 'p_resulting_marital_status_id is distinct from v_expected_status_id') && str_contains($endFunction, 'hms_resulting_status_reason_mismatch'), 'Divorce + Widowed, death + Divorced, and Single or any unrelated status are rejected.');
spouseLifecycleAssert(str_contains($endFunction, 'if p_resulting_marital_status_id is not null then raise exception \'hms_resulting_status_not_applicable\''), 'Ending one of multiple current spouses accepts no resulting status.');
spouseLifecycleAssert(!str_contains($correctFunction, 'is_divorced_status') && !str_contains($correctFunction, 'is_widowed_status') && str_contains($correctFunction, 'not is_married_status'), 'Correction keeps its explicit non-Married status selection independent of end reason.');
spouseLifecycleAssert(str_contains($normalized, "new_state = 'void'") && str_contains($normalized, 'employee_wife_lifecycle_events'), 'Corrections are retained and written to append-only lifecycle history.');
spouseLifecycleAssert(str_contains($normalized, 'hms_spouse_corrected_record_immutable') && str_contains($normalized, 'old.relationship_status = \'void\''), 'Corrected spouse rows cannot be silently edited after correction.');
spouseLifecycleAssert(str_contains($normalized, 'hms_spouse_lifecycle_fields_require_transition') && str_contains($normalized, 'hms_spouse_employee_link_immutable'), 'Lifecycle details and employee linkage cannot be edited outside a state transition.');
spouseLifecycleAssert(str_contains($normalized, 'not is_married_status') && str_contains($normalized, 'is_active'), 'Selected resulting status must be active and non-Married.');
spouseLifecycleAssert(str_contains($normalized, 'on delete restrict') && str_contains($normalized, 'employee_wife_lifecycle_events_spouse_idx'), 'Spouse history is retained and indexed for review.');
spouseLifecycleAssert(str_contains($foundation, 'wife_id bigint references public.employee_wives(id) on delete restrict'), 'Children retain their existing spouse link and cannot cascade-delete it.');
spouseLifecycleAssert(!preg_match('/delete\s+from\s+public\.employee_wives/i', $migration), 'Lifecycle migration never deletes spouse rows.');
spouseLifecycleAssert(!preg_match('/delete\s+from\s+employee_wives/i', $employeeApi), 'Employee API has no permanent spouse deletion path.');
spouseLifecycleAssert(str_contains($employeeApi, "'employees.personal.edit'") && str_contains($employeeApi, 'end_employee_wife_marriage') && str_contains($employeeApi, 'correct_employee_wife_record'), 'PHP lifecycle API enforces personal-edit permission and invokes transactional RPCs.');
spouseLifecycleAssert(str_contains($employeeApi, 'employee_spouse_conflict') && str_contains($employeeApi, 'expected_updated_at'), 'Stale lifecycle actions return a conflict contract.');
spouseLifecycleAssert(str_contains($employeeApi, 'employee_spouse_status_reason_mismatch') && str_contains($employeeApi, 'employee_spouse_status_setup_inactive'), 'Backend maps reason/status and setup failures to clear client errors.');
spouseLifecycleAssert(str_contains($createFamily, 'insert into public.employee_wives') && str_contains($importRpc, 'insert into public.employee_wives'), 'Normal employee creation and importer both write through the spouse invariant trigger.');
spouseLifecycleAssert(str_contains($importRpc, 'on conflict(employee_id,identity_card_number) do update'), 'Spouse import upserts remain idempotent and lifecycle-neutral.');
spouseLifecycleAssert(str_contains($schema, "'relationship_status'") && str_contains($schema, "'relationship_end_date'") && str_contains($schema, "'correction_reason'"), 'Spouse exports include lifecycle fields.');
spouseLifecycleAssert(str_contains($schema, "'export_only'=>true") && str_contains($importApi, "\$direction === 'import' && (\$field['export_only'] ?? false) === true"), 'Lifecycle fields are filtered out of import/template fields.');
spouseLifecycleAssert(str_contains($profile, 'End marriage') && str_contains($profile, 'Correct erroneous record') && str_contains($profile, 'resulting_marital_status_id'), 'Profile presents audited end/correction actions and explicit resulting status.');
spouseLifecycleAssert(str_contains($profile, 'is_divorced_status') && str_contains($profile, 'is_widowed_status') && str_contains($profile, 'disabled={busy || (needsStatus && (isEnd ? !reasonStatus : !resultingStatusId))}'), 'Profile confirms only the reason-specific canonical status and disables confirmation when unavailable.');
spouseLifecycleAssert(str_contains($profile, 'View history') && str_contains($profile, 'spouse-${state}') && str_contains($styles, 'spouse-void'), 'Profile presents lifecycle history and corrected-state styling.');

echo "Employee spouse lifecycle contracts passed.\n";
