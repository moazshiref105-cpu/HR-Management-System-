<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\HiringPlanApi;
use Hms\Backend\HttpException;

function hiringPlanAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$migration = file_get_contents(__DIR__ . '/../../supabase/migrations/20261117120000_add_project_hiring_plan.sql');
$apiSource = file_get_contents(__DIR__ . '/../src/HiringPlanApi.php');
$frontend = file_get_contents(__DIR__ . '/../../frontend/src/ProjectHiringPlan.jsx');
$frontendApi = file_get_contents(__DIR__ . '/../../frontend/src/api.js');
foreach ([$migration, $apiSource, $frontend, $frontendApi] as $source) {
    if (!is_string($source)) throw new RuntimeException('Hiring plan contract source is unavailable.');
}

$sql = strtolower($migration);
foreach ([
    'references public.projects(id) on delete restrict',
    'references public.departments(id) on delete restrict',
    'references public.positions(id) on delete restrict',
    'check (planned_count >= 0)',
    'unique (project_id, department_id, position_id)',
    "e.employee_status='active'",
    'count(e.id)::integer - hp.planned_count difference',
    "then 'complete'",
    "then 'under_plan'",
    "else 'over_plan'",
    "'vacant',coalesce((select sum(greatest(planned_count-actual_count,0)) from filtered),0)",
    "'excess',coalesce((select sum(greatest(actual_count-planned_count,0)) from filtered),0)",
    "'rows',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb)",
    'project_hiring_plan_assignment_review',
    'project_hiring_plan_audit',
    'delete_project_hiring_plan',
] as $contract) hiringPlanAssert(str_contains($sql, $contract), "Missing hiring plan SQL contract: {$contract}");

$start = strpos($migration, 'create or replace function public.project_hiring_plan_staffing(');
$end = strpos($migration, 'create or replace function public.project_hiring_plan_employees(', $start ?: 0);
$staffingSql = $start === false || $end === false ? '' : strtolower(substr($migration, $start, $end - $start));
hiringPlanAssert(str_contains($staffingSql, 'left join public.employees e'), 'Zero-employee plans must remain in staffing results.');
hiringPlanAssert(str_contains($staffingSql, "e.employee_status='active'"), 'Only active employee records count toward staffing.');
hiringPlanAssert(!str_contains($staffingSql, 'employee_classification'), 'Active standard and 5% employees must both count.');
hiringPlanAssert(str_contains($staffingSql, 'p_status is null') && str_contains($staffingSql, 'p_search'), 'Staffing filtering must run in the database query.');

foreach ([
    "'hiring_plans.view'",
    "'hiring_plans.edit'",
    "'hiring_staffing.view'",
    "'/rest/v1/rpc/user_has_permission'",
    'is_active=eq.true',
    "'/rest/v1/project_hiring_plans'",
    "'project_hiring_plan_staffing'",
] as $contract) hiringPlanAssert(str_contains($apiSource, $contract), "Missing permission/API contract: {$contract}");
foreach (['hiringPlansApi', 'staffingOptions', 'employees:', 'review:'] as $contract) hiringPlanAssert(str_contains($frontendApi, $contract), "Missing frontend API contract: {$contract}");
foreach (['All projects', 'All departments', 'All positions', 'All statuses', 'Employees counted for this plan', 'Employee assignment review', 'hiringPlansApi.create', 'hiringPlansApi.update', 'hiringPlansApi.remove'] as $contract) {
    hiringPlanAssert(str_contains($frontend, $contract), "Missing staffing UI behavior: {$contract}");
}

$api = (new ReflectionClass(HiringPlanApi::class))->newInstanceWithoutConstructor();
$countMethod = new ReflectionMethod(HiringPlanApi::class, 'plannedCount');
$idMethod = new ReflectionMethod(HiringPlanApi::class, 'positiveInteger');
foreach ([0 => 0, 12 => 12, '4' => 4] as $input => $expected) {
    hiringPlanAssert($countMethod->invoke($api, $input) === $expected, 'Non-negative whole headcount validation failed.');
}
foreach ([-1, '-1', 1.5, '1.5', 'not-a-number', null, false] as $input) {
    try { $countMethod->invoke($api, $input); } catch (ReflectionException|HttpException|TypeError) { continue; }
    throw new RuntimeException('Invalid planned headcount was accepted.');
}
foreach ([1, '26'] as $input) hiringPlanAssert($idMethod->invoke($api, $input, 'Project') === (int) $input, 'Positive reference ID validation failed.');
foreach ([0, '0', -1, '-1', 1.1, 'abc', null, false] as $input) {
    try { $idMethod->invoke($api, $input, 'Project'); } catch (ReflectionException|HttpException|TypeError) { continue; }
    throw new RuntimeException('Invalid reference ID was accepted.');
}

echo "Hiring plan contract tests passed\n";
