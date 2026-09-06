<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\HttpException;
use Hms\Backend\SupabaseRequestException;

$migration = file_get_contents(__DIR__ . '/../../supabase/migrations/20260905130000_phase3c_user_provisioning.sql');
if (!is_string($migration)) throw new RuntimeException('Phase 3C provisioning migration is unavailable.');

foreach ([
    'create function public.provision_setup_user(',
    'p_auth_user_id uuid',
    'p_role_ids bigint[]',
    'returns table',
    'security definer',
    'set search_path = pg_catalog, public, pg_temp',
    'from auth.users au',
    'HMS_APPLICATION_EMAIL_CONFLICT',
    'HMS_PROVISIONING_INVALID_ROLES',
    'insert into public.users',
    'insert into public.user_roles',
    'revoke all on function public.provision_setup_user(uuid, text, text, text, bigint[], uuid) from public, anon, authenticated;',
    'grant execute on function public.provision_setup_user(uuid, text, text, text, bigint[], uuid) to service_role;',
] as $required) {
    if (!str_contains(strtolower($migration), strtolower($required))) throw new RuntimeException("Missing Phase 3C migration contract: {$required}");
}

$setup = file_get_contents(__DIR__ . '/../src/SetupApi.php');
if (!is_string($setup)) throw new RuntimeException('SetupApi source is unavailable.');

foreach ([
    '$this->validatedCreateRoleIds($body[\'role_ids\'] ?? [])',
    '$this->assertApplicationEmailAvailable($email)',
    "'/auth/v1/admin/users'",
    "'/rest/v1/rpc/provision_setup_user'",
    "'p_auth_user_id' => \$authId",
    "'p_role_ids' => \$roleIds",
    'user_provisioning_reconciliation_required',
    "error_log('HMS user provisioning reconciliation required auth_user_id=' . \$authId . ' operation=create_user')",
    "error_log('HMS user provisioning reconciliation required operation=create_user_missing_auth_user_id')",
    'AUTH_EMAIL_EXISTS',
    'user_email_conflict',
] as $required) {
    if (!str_contains($setup, $required)) throw new RuntimeException("Missing Phase 3C backend contract: {$required}");
}

$authPosition = strpos($setup, "'/auth/v1/admin/users'");
foreach ([
    '$this->validatedCreateRoleIds($body[\'role_ids\'] ?? [])',
    '$this->assertApplicationEmailAvailable($email)',
] as $precondition) {
    $position = strpos($setup, $precondition);
    if ($position === false || $authPosition === false || $position > $authPosition) throw new RuntimeException('Deterministic user-provisioning validation does not precede Auth creation.');
}

if (str_contains($setup, "'/rest/v1/users', [[\n                'id' => \$authId")) {
    throw new RuntimeException('The legacy public.users then role-RPC create sequence remains present.');
}

$authConflict = new SupabaseRequestException(422, 'AUTH_EMAIL_EXISTS');
if ($authConflict->getMessage() !== 'Supabase request failed with HTTP 422.' || $authConflict->identifier !== 'AUTH_EMAIL_EXISTS') {
    throw new RuntimeException('Auth conflict identity is not separated from a client-facing raw message.');
}

$reconciliation = new HttpException('User creation could not be completed safely. Administrator review is required.', 500, 'user_provisioning_reconciliation_required');
if ($reconciliation->status !== 500 || $reconciliation->errorCode !== 'user_provisioning_reconciliation_required') {
    throw new RuntimeException('Reconciliation-required error contract is not preserved.');
}

$frontend = file_get_contents(__DIR__ . '/../../frontend/src/App.jsx');
if (!is_string($frontend)) throw new RuntimeException('Frontend source is unavailable.');
foreach (['disabled={busy}', 'user_email_conflict', 'user_provisioning_failed', 'user_provisioning_reconciliation_required', 'if (!isNew) onCapabilitiesChanged();', 'done();'] as $required) {
    if (!str_contains($frontend, $required)) throw new RuntimeException("Missing user-provisioning frontend contract: {$required}");
}

echo "User provisioning contract tests passed\n";
