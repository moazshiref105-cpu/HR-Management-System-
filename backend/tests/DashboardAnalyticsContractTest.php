<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\DashboardApi;

$apiSource = file_get_contents(__DIR__ . '/../src/DashboardApi.php');
$frontController = file_get_contents(__DIR__ . '/../public/index.php');
$grantMigration = file_get_contents(__DIR__ . '/../../supabase/migrations/20261118123000_lock_down_dashboard_rpc_execution.sql');
if (!is_string($apiSource) || !is_string($frontController) || !is_string($grantMigration)) throw new RuntimeException('Dashboard contract sources are unavailable.');

$cacheGuard = "if (\$path === 'api/dashboard' || str_starts_with(\$path, 'api/dashboard/')) {\n        header('Cache-Control: no-store');\n    }";
$cacheGuardPosition = strpos($frontController, $cacheGuard);
$dashboardDispatchPosition = strpos($frontController, "DashboardApi::fromEnvironment()");
if ($cacheGuardPosition === false || $dashboardDispatchPosition === false || $cacheGuardPosition > $dashboardDispatchPosition) {
    throw new RuntimeException('Dashboard responses must set Cache-Control: no-store before dispatch, including error responses.');
}

$reflection = new ReflectionClass(DashboardApi::class);
$instance = $reflection->newInstanceWithoutConstructor();
$filter = $reflection->getMethod('permittedAttention');
$items = [
    ['metric' => 'medical_eligible', 'count' => 8],
    ['metric' => 'medical_not_yet_eligible', 'count' => 7],
    ['metric' => 'life_eligible', 'count' => 6],
    ['metric' => 'comprehensive_health_participating', 'count' => 5],
    ['metric' => 'overdue', 'count' => 4],
];
$withoutInsurance = $filter->invoke($instance, $items, false);
if (array_column($withoutInsurance, 'metric') !== ['overdue']) throw new RuntimeException('Insurance attention items leaked to a user without employees.insurance.view.');
if (count($filter->invoke($instance, $items, true)) !== count($items)) throw new RuntimeException('Insurance permission should preserve insurance attention items.');

foreach ([
    <<<'TEXT'
'items'=>$this->permittedAttention(is_array($raw)?$raw:[],$this->can($a,'employees.insurance.view'))
TEXT,
    <<<'TEXT'
$raw['attention']=$this->permittedAttention(is_array($raw['attention']??null)?$raw['attention']:[],$this->can($a,'employees.insurance.view'))
TEXT,
    <<<'TEXT'
$this->permittedAttention($attention,$this->can($a,'employees.insurance.view'))
TEXT,
] as $routeContract) {
    if (!str_contains($apiSource, $routeContract)) throw new RuntimeException('A Dashboard attention response does not apply the insurance permission filter.');
}

$functions = [
    'dashboard_metric_where(text, date, date)',
    'dashboard_filter_where(jsonb)',
    'dashboard_analysis(text, text, jsonb)',
    'dashboard_employees(text, jsonb, integer, integer)',
    'dashboard_trend(text, date, date, text, jsonb)',
    'dashboard_attention(jsonb)',
    'dashboard_executive(jsonb)',
    'dashboard_overview(text, text, jsonb, integer, integer)',
];
$normalizedMigration = strtolower($grantMigration);
foreach ($functions as $function) {
    $normalizedSignature = strtolower(preg_replace('/\s+/', ' ', $function));
    $revoke = 'revoke execute on function public.' . $normalizedSignature . ' from public, anon, authenticated';
    $grant = 'grant execute on function public.' . $normalizedSignature . ' to service_role';
    if (!str_contains($normalizedMigration, $revoke)) throw new RuntimeException("Dashboard RPC is not revoked from browser roles: {$function}");
    if (!str_contains($normalizedMigration, $grant)) throw new RuntimeException("Dashboard RPC is not granted to service_role: {$function}");
}

echo "Dashboard analytics contracts passed\n";
