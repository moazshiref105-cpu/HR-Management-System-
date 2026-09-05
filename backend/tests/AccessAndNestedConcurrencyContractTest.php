<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\EmployeeApi;
use Hms\Backend\SupabaseRequestException;

$migration = file_get_contents(__DIR__ . '/../../supabase/migrations/20260905120000_phase3b_access_concurrency.sql');
if (!is_string($migration)) throw new RuntimeException('Phase 3B migration is unavailable.');

foreach ([
    'drop function if exists public.replace_setup_role_permissions(bigint, bigint[]);',
    'drop function if exists public.replace_setup_user_roles(uuid, bigint[], uuid);',
    'p_expected_updated_at timestamptz',
    'for update;',
    'HMS_ROLE_CONFLICT',
    'HMS_USER_ACCESS_CONFLICT',
    'security definer',
    'set search_path = pg_catalog, public, pg_temp',
    'grant execute on function public.replace_setup_role_permissions(bigint, bigint[], timestamptz) to service_role;',
    'grant execute on function public.replace_setup_user_roles(uuid, bigint[], uuid, timestamptz) to service_role;',
] as $required) {
    if (!str_contains(strtolower($migration), strtolower($required))) throw new RuntimeException("Missing Phase 3B migration contract: {$required}");
}

$reflection = new ReflectionClass(EmployeeApi::class);
$api = $reflection->newInstanceWithoutConstructor();
$expected = new ReflectionMethod(EmployeeApi::class, 'expectedUpdatedAt');
$marker = '2026-09-05T10:48:15.614389+00:00';
if ($expected->invoke($api, $marker) !== $marker) throw new RuntimeException('Nested concurrency marker is not preserved exactly.');
foreach ([null, '', '2026-09-05', 'not-a-timestamp'] as $invalid) {
    try { $expected->invoke($api, $invalid); } catch (Throwable) { continue; }
    throw new RuntimeException('Invalid nested concurrency marker was accepted.');
}

$source = file_get_contents(__DIR__ . '/../src/EmployeeApi.php');
if (!is_string($source) || !str_contains($source, '&updated_at=eq.') || !str_contains($source, 'throwNestedUpdateFailure')) {
    throw new RuntimeException('Nested conditional-update contract is missing.');
}

$setup = file_get_contents(__DIR__ . '/../src/SetupApi.php');
$frontendApi = file_get_contents(__DIR__ . '/../../frontend/src/api.js');
foreach (['p_expected_updated_at', 'role_conflict', 'user_access_conflict', 'throwUserUpdateFailure', 'userVersionPath', 'throwRoleUpdateFailure'] as $required) {
    if (!is_string($setup) || !str_contains($setup, $required)) throw new RuntimeException("Missing SetupApi concurrency contract: {$required}");
}
foreach (['expected_updated_at', 'patchUser: (id, body, expected_updated_at, t)', 'rolePermissions: (id, permission_ids, expected_updated_at, t)', 'userRoles: (id, role_ids, expected_updated_at, t)', 'roleStatus: (id, is_active, expected_updated_at, t)'] as $required) {
    if (!is_string($frontendApi) || !str_contains($frontendApi, $required)) throw new RuntimeException("Missing frontend access-version contract: {$required}");
}

$transport = new SupabaseRequestException(400, 'HMS_ROLE_CONFLICT');
if ($transport->getMessage() !== 'Supabase request failed with HTTP 400.' || $transport->identifier !== 'HMS_ROLE_CONFLICT') {
    throw new RuntimeException('Supabase concurrency identifiers are not safely separated from client-facing messages.');
}

$app = file_get_contents(__DIR__ . '/../../frontend/src/App.jsx');
foreach (['let currentVersion = version;', 'patchUser(user.id, { full_name: form.full_name, phone: form.phone }, currentVersion, token)', 'currentVersion = updated.updated_at;', 'userRoles(user.id, form.role_ids, currentVersion, token)', 'e.status === 409 && e.code === "user_access_conflict"'] as $required) {
    if (!is_string($app) || !str_contains($app, $required)) throw new RuntimeException("Missing user profile/version chaining contract: {$required}");
}

echo "Access and nested concurrency contract tests passed\n";
