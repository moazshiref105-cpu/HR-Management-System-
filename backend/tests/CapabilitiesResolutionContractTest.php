<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\SetupApi;

/** @param list<string> $permissions @param array{active:bool,super:bool,roles:list<array{active:bool,permissions:list<string>}>,allow:list<string>,deny:list<string>} $user @return list<string> */
function effectiveCapabilities(array $permissions, array $user): array
{
    if (!$user['active']) return [];
    if ($user['super']) return array_values(array_unique($permissions));
    $result = [];
    foreach ($permissions as $permission) {
        if (in_array($permission, $user['deny'], true)) continue;
        $granted = in_array($permission, $user['allow'], true);
        foreach ($user['roles'] as $role) if ($role['active'] && in_array($permission, $role['permissions'], true)) $granted = true;
        if ($granted) $result[] = $permission;
    }
    return array_values(array_unique($result));
}

function assertSameValue(mixed $expected, mixed $actual, string $label): void
{
    if ($expected !== $actual) throw new RuntimeException("{$label}: expected " . json_encode($expected) . ', got ' . json_encode($actual));
}

$permissions = ['dashboard.view', 'employees.view', 'roles.edit'];
$base = ['active' => true, 'super' => false, 'roles' => [], 'allow' => [], 'deny' => []];
assertSameValue([], effectiveCapabilities($permissions, $base), 'active zero-role user');
assertSameValue($permissions, effectiveCapabilities($permissions, [...$base, 'super' => true]), 'Super Admin');
assertSameValue(['employees.view'], effectiveCapabilities($permissions, [...$base, 'roles' => [['active' => true, 'permissions' => ['employees.view']]]]), 'active role grant');
assertSameValue([], effectiveCapabilities($permissions, [...$base, 'roles' => [['active' => false, 'permissions' => ['employees.view']]]]), 'inactive role ignored');
assertSameValue(['roles.edit'], effectiveCapabilities($permissions, [...$base, 'allow' => ['roles.edit']]), 'direct allow');
assertSameValue([], effectiveCapabilities($permissions, [...$base, 'deny' => ['roles.edit'], 'roles' => [['active' => true, 'permissions' => ['roles.edit']]]]), 'deny over role');
assertSameValue([], effectiveCapabilities($permissions, [...$base, 'deny' => ['roles.edit'], 'allow' => ['roles.edit']]), 'deny over allow');
assertSameValue(['employees.view'], effectiveCapabilities($permissions, [...$base, 'roles' => [['active' => true, 'permissions' => ['employees.view']], ['active' => true, 'permissions' => ['employees.view']]]]), 'duplicate active roles');
assertSameValue(['employees.view'], effectiveCapabilities($permissions, [...$base, 'allow' => ['employees.view'], 'roles' => [['active' => true, 'permissions' => ['employees.view']]]]), 'allow plus role');
assertSameValue([], effectiveCapabilities($permissions, [...$base, 'active' => false, 'super' => true, 'allow' => ['roles.edit']]), 'inactive user');

$migration = file_get_contents(__DIR__ . '/../../supabase/migrations/20260910103000_phase5a_set_based_capabilities.sql');
if (!is_string($migration)) throw new RuntimeException('Set-based capabilities migration is unavailable.');
foreach ([
    'create function public.get_user_capabilities(p_user_id uuid)', 'returns table(permission_key text)', 'stable', 'security definer',
    'set search_path = pg_catalog, public, pg_temp', 'u.is_active = true', 'u.is_super_admin = true', "up.effect = 'deny'", "up.effect = 'allow'", 'r.is_active = true', 'select distinct p.permission_key',
    'revoke all on function public.get_user_capabilities(uuid) from public;', 'revoke all on function public.get_user_capabilities(uuid) from anon;',
    'revoke all on function public.get_user_capabilities(uuid) from authenticated;', 'grant execute on function public.get_user_capabilities(uuid) to service_role;',
] as $required) if (!str_contains(strtolower($migration), strtolower($required))) throw new RuntimeException("Missing capabilities semantic contract: {$required}");

$setup = file_get_contents(__DIR__ . '/../src/SetupApi.php');
if (!is_string($setup)) throw new RuntimeException('Setup API source is unavailable.');
$start = strpos($setup, 'private function capabilities');
$end = strpos($setup, 'private function isUuid', $start ?: 0);
$method = $start === false || $end === false ? '' : substr($setup, $start, $end - $start);
if (substr_count($method, "'/rest/v1/rpc/get_user_capabilities'") !== 1) throw new RuntimeException('Capabilities endpoint must make exactly one resolution RPC.');
if (str_contains($method, 'user_has_permission') || str_contains($method, 'permissions?select=permission_key')) throw new RuntimeException('Capabilities endpoint retains the per-permission RPC pattern.');

$api = (new ReflectionClass(SetupApi::class))->newInstanceWithoutConstructor();
$normalizer = new ReflectionMethod(SetupApi::class, 'capabilityKeys');
assertSameValue(['employees.view'], $normalizer->invoke($api, [['permission_key' => 'employees.view'], ['permission_key' => 'employees.view']]), 'duplicate RPC keys');
foreach ([null, [['permission_key' => 'employees.view'], []], [['permission_key' => '']], [['permission_key' => 3]]] as $malformed) {
    try { $normalizer->invoke($api, $malformed); } catch (Throwable) { continue; }
    throw new RuntimeException('Malformed successful RPC response was not rejected.');
}

echo "Capabilities resolution contract tests passed\n";
