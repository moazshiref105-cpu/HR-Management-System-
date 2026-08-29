<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;
use Throwable;

final class SetupApi
{
    /** @var array<string, string> */
    private const MASTER_TABLES = [
        'religions' => 'religions', 'marital-statuses' => 'marital_statuses', 'diplomas' => 'diplomas',
        'governorates' => 'governorates', 'departments' => 'departments', 'shift-types' => 'shift_types',
        'teams' => 'teams', 'positions' => 'positions', 'projects' => 'projects', 'banks' => 'banks',
        'leaving-reasons' => 'leaving_reasons', 'license-types' => 'license_types',
    ];

    private function __construct(private readonly SupabaseClient $supabase)
    {
    }

    public static function fromEnvironment(): self
    {
        $url = rtrim((string) getenv('SUPABASE_URL'), '/');
        $key = (string) getenv('SUPABASE_SECRET_KEY');
        if (filter_var($url, FILTER_VALIDATE_URL) === false || $key === '' || !function_exists('curl_init')) {
            throw new RuntimeException('Server configuration is incomplete.');
        }
        return new self(new SupabaseClient($url, $key));
    }

    public function dispatch(string $method, string $requestUri): never
    {
        $path = trim((string) parse_url($requestUri, PHP_URL_PATH), '/');
        $segments = $path === '' ? [] : explode('/', $path);
        if (array_slice($segments, 0, 2) !== ['api', 'setup']) {
            throw new HttpException('Route not found.', 404);
        }
        $actor = $this->actor();
        $body = $this->body();
        $route = array_slice($segments, 2);
        $result = match ($route[0] ?? '') {
            'users' => $this->users($method, array_slice($route, 1), $body, $actor),
            'roles' => $this->roles($method, array_slice($route, 1), $body, $actor),
            'master-data' => $this->masterData($method, array_slice($route, 1), $body, $actor),
            'insurance-settings' => $this->insuranceSettings($method, array_slice($route, 1), $body, $actor),
            'permissions' => $this->permissions($method, $route, $actor),
            'capabilities' => $this->capabilities($method, $route, $actor),
            'employee-form-options' => $this->employeeFormOptions($method, $route, $actor),
            default => throw new HttpException('Route not found.', 404),
        };
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['data' => $result], JSON_THROW_ON_ERROR);
        exit;
    }

    /** @return array<string, mixed> */
    private function actor(): array
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
            throw new HttpException('Authentication is required.', 401);
        }
        try {
            $auth = $this->supabase->authUser($matches[1]);
        } catch (Throwable) {
            throw new HttpException('Authentication token is invalid.', 401);
        }
        $authId = (string) ($auth['id'] ?? '');
        $users = $this->supabase->service('GET', '/rest/v1/users?select=id,is_active,is_super_admin&auth_user_id=eq.' . rawurlencode($authId));
        $user = $users[0] ?? null;
        if (!is_array($user) || ($user['is_active'] ?? false) !== true) {
            throw new HttpException('User account is inactive or not provisioned.', 403);
        }
        return $user;
    }

    /** @return array<string, mixed> */
    private function body(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') return [];
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($decoded)) throw new RuntimeException('JSON object expected.');
        return $decoded;
    }

    /** @param array<string, mixed> $actor */
    private function allow(array $actor, string $permission): void
    {
        if (($actor['is_super_admin'] ?? false) === true) return;
        $result = $this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', [
            'p_user_id' => $actor['id'], 'p_permission_key' => $permission,
        ]);
        if ($result !== true) throw new HttpException('You are not authorized for this action.', 403);
    }

    /** @param array<string, mixed> $body @param array<string, mixed> $actor */
    private function users(string $method, array $route, array $body, array $actor): array
    {
        if ($method === 'GET' && $route === []) {
            $this->allow($actor, 'users.view');
            return $this->supabase->service('GET', '/rest/v1/users?select=id,auth_user_id,full_name,email,phone,is_active,is_super_admin,created_at,updated_at,user_roles!user_roles_user_id_fkey(role_id,roles(id,name,is_active))&order=full_name');
        }
        if ($method === 'POST' && $route === []) return $this->createUser($body, $actor);
        $id = $route[0] ?? '';
        if (!$this->isUuid($id)) throw new RuntimeException('User ID is required.');
        if ($method === 'PATCH' && count($route) === 1) {
            $this->allow($actor, 'users.edit');
            if (array_key_exists('email', $body)) throw new RuntimeException('Email changes require a dedicated verified-email workflow.');
            unset($body['id'], $body['auth_user_id'], $body['is_super_admin'], $body['created_by']);
            $body = array_intersect_key($body, array_flip(['full_name', 'phone']));
            if ($body === []) throw new RuntimeException('At least one editable field is required.');
            if (array_key_exists('full_name', $body) && trim((string) $body['full_name']) === '') throw new RuntimeException('full_name cannot be blank.');
            $body['updated_at'] = gmdate('c');
            return $this->supabase->service('PATCH', '/rest/v1/users?id=eq.' . rawurlencode($id), $body, ['Prefer: return=representation']);
        }
        if ($method === 'PATCH' && ($route[1] ?? '') === 'status') {
            $active = $body['is_active'] ?? null;
            if (!is_bool($active)) throw new RuntimeException('is_active must be boolean.');
            $this->allow($actor, $active ? 'users.edit' : 'users.deactivate');
            if (!$active) $this->assertNotSuperAdmin($id);
            return $this->supabase->service('PATCH', '/rest/v1/users?id=eq.' . rawurlencode($id), ['is_active' => $active], ['Prefer: return=representation']);
        }
        if (in_array($method, ['PUT', 'DELETE'], true) && ($route[1] ?? '') === 'roles') {
            $this->allow($actor, 'users.edit');
            if ($method === 'PUT') return $this->replaceRelations('user_roles', 'user_id', $id, 'role_id', $body['role_ids'] ?? [], $actor['id']);
            $roleId = (int) ($route[2] ?? 0);
            return $this->supabase->service('DELETE', '/rest/v1/user_roles?user_id=eq.' . rawurlencode($id) . '&role_id=eq.' . $roleId);
        }
        throw new HttpException('Route not found.', 404);
    }

    /** @param array<string, mixed> $body @param array<string, mixed> $actor */
    private function createUser(array $body, array $actor): array
    {
        $this->allow($actor, 'users.create');
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $name = trim((string) ($body['full_name'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || $name === '' || strlen($password) < 12) throw new RuntimeException('Valid email, full_name, and a 12-character password are required.');
        $auth = $this->supabase->service('POST', '/auth/v1/admin/users', ['email' => $email, 'password' => $password, 'email_confirm' => true]);
        $authId = (string) (($auth['user']['id'] ?? null) ?: ($auth['id'] ?? ''));
        if (!$this->isUuid($authId)) throw new RuntimeException('Supabase Auth did not return a valid user ID.');
        try {
            $user = $this->supabase->service('POST', '/rest/v1/users', [[
                'id' => $authId, 'auth_user_id' => $authId, 'full_name' => $name, 'email' => $email,
                'phone' => $body['phone'] ?? null, 'is_active' => true, 'is_super_admin' => false, 'created_by' => $actor['id'],
            ]], ['Prefer: return=representation']);
            $this->replaceRelations('user_roles', 'user_id', $authId, 'role_id', $body['role_ids'] ?? [], $actor['id']);
            return $user;
        } catch (Throwable $exception) {
            try { $this->supabase->service('DELETE', '/auth/v1/admin/users/' . rawurlencode($authId) . '?should_soft_delete=false'); } catch (Throwable) {}
            throw $exception;
        }
    }

    /** @param array<string, mixed> $body @param array<string, mixed> $actor */
    private function roles(string $method, array $route, array $body, array $actor): array
    {
        if ($method === 'GET' && $route === []) { $this->allow($actor, 'roles.view'); return $this->supabase->service('GET', '/rest/v1/roles?select=*,role_permissions(permission_id,permissions(id,permission_key,module,action)),user_roles(count)&order=name'); }
        if ($method === 'POST' && $route === []) { $this->allow($actor, 'roles.create'); return $this->supabase->service('POST', '/rest/v1/roles', [[ 'name' => $this->required($body, 'name'), 'description' => $body['description'] ?? null, 'created_by' => $actor['id'] ]], ['Prefer: return=representation']); }
        $id = (int) ($route[0] ?? 0); if ($id < 1) throw new RuntimeException('Role ID is required.');
        if ($method === 'PATCH' && count($route) === 1) { $this->allow($actor, 'roles.edit'); $body = array_intersect_key($body, array_flip(['name', 'description'])); if ($body === []) throw new RuntimeException('At least one editable field is required.'); if (array_key_exists('name', $body) && trim((string) $body['name']) === '') throw new RuntimeException('name cannot be blank.'); return $this->supabase->service('PATCH', '/rest/v1/roles?id=eq.' . $id, $body, ['Prefer: return=representation']); }
        if ($method === 'PATCH' && ($route[1] ?? '') === 'status') { $this->allow($actor, 'roles.edit'); if (!is_bool($body['is_active'] ?? null)) throw new RuntimeException('is_active must be boolean.'); return $this->supabase->service('PATCH', '/rest/v1/roles?id=eq.' . $id, ['is_active' => $body['is_active']], ['Prefer: return=representation']); }
        if (in_array($method, ['PUT', 'DELETE'], true) && ($route[1] ?? '') === 'permissions') { $this->allow($actor, 'roles.edit'); if ($method === 'PUT') return $this->replaceRelations('role_permissions', 'role_id', (string) $id, 'permission_id', $body['permission_ids'] ?? [], $actor['id']); $permissionId = (int) ($route[2] ?? 0); return $this->supabase->service('DELETE', '/rest/v1/role_permissions?role_id=eq.' . $id . '&permission_id=eq.' . $permissionId); }
        throw new HttpException('Route not found.', 404);
    }

    /** @param array<string, mixed> $body @param array<string, mixed> $actor */
    private function masterData(string $method, array $route, array $body, array $actor): array
    {
        $resource = $route[0] ?? ''; $table = self::MASTER_TABLES[$resource] ?? null;
        if ($table === null) throw new HttpException('Unknown master-data resource.', 404);
        if ($method === 'GET' && count($route) === 1) { $this->allow($actor, 'setup.view'); return $this->supabase->service('GET', '/rest/v1/' . $table . '?select=*&order=name'); }
        $this->allow($actor, 'setup.edit');
        if ($method === 'POST' && count($route) === 1) { $record = ['name' => $this->required($body, 'name'), 'description' => $body['description'] ?? null, 'created_by' => $actor['id']]; if ($table === 'positions') $record['position_code'] = $this->required($body, 'position_code'); if ($table === 'governorates') { $flag = $body['participates_in_comprehensive_health_insurance'] ?? false; if (!is_bool($flag)) throw new RuntimeException('participates_in_comprehensive_health_insurance must be boolean.'); $record['participates_in_comprehensive_health_insurance'] = $flag; } return $this->supabase->service('POST', '/rest/v1/' . $table, [$record], ['Prefer: return=representation']); }
        $id = (int) ($route[1] ?? 0); if ($id < 1) throw new RuntimeException('Record ID is required.');
        if ($method === 'PATCH' && count($route) === 2) { $allowed = ['name', 'description']; if ($table === 'positions') $allowed[] = 'position_code'; if ($table === 'governorates') $allowed[] = 'participates_in_comprehensive_health_insurance'; $record = array_intersect_key($body, array_flip($allowed)); if ($record === []) throw new RuntimeException('At least one editable field is required.'); if (array_key_exists('name', $record) && trim((string) $record['name']) === '') throw new RuntimeException('name cannot be blank.'); if ($table === 'positions' && array_key_exists('position_code', $record) && trim((string) $record['position_code']) === '') throw new RuntimeException('position_code cannot be blank.'); if ($table === 'governorates' && array_key_exists('participates_in_comprehensive_health_insurance', $record) && !is_bool($record['participates_in_comprehensive_health_insurance'])) throw new RuntimeException('participates_in_comprehensive_health_insurance must be boolean.'); $record['updated_by'] = $actor['id']; return $this->supabase->service('PATCH', '/rest/v1/' . $table . '?id=eq.' . $id, $record, ['Prefer: return=representation']); }
        if ($method === 'PATCH' && ($route[2] ?? '') === 'status' && is_bool($body['is_active'] ?? null)) return $this->supabase->service('PATCH', '/rest/v1/' . $table . '?id=eq.' . $id, ['is_active' => $body['is_active'], 'updated_by' => $actor['id']], ['Prefer: return=representation']);
        throw new HttpException('Route not found.', 404);
    }

    private function employeeFormOptions(string $method, array $route, array $actor): array
    {
        if ($method !== 'GET' || $route !== ['employee-form-options']) throw new HttpException('Route not found.', 404);
        $this->allow($actor, 'employees.view');
        $resources = ['religions','marital-statuses','diplomas','governorates','departments','shift-types','teams','positions','projects','banks','leaving-reasons','license-types'];
        $requests = [];
        foreach ($resources as $resource) $requests[] = ['method' => 'GET', 'path' => '/rest/v1/' . self::MASTER_TABLES[$resource] . '?select=*&is_active=eq.true&order=name'];
        $rows = $this->supabase->serviceBatch($requests);
        return array_combine($resources, $rows) ?: [];
    }

    /** @param array<string, mixed> $body @param array<string, mixed> $actor */
    private function insuranceSettings(string $method, array $route, array $body, array $actor): array
    {
        if ($method === 'GET' && $route === []) { $this->allow($actor, 'setup.view'); return $this->supabase->service('GET', '/rest/v1/insurance_settings?select=*&order=setting_key'); }
        if ($method === 'PATCH' && count($route) === 1) { $this->allow($actor, 'setup.edit'); if (!is_numeric($body['value'] ?? null)) throw new RuntimeException('value must be numeric.'); if (array_key_exists('is_active', $body) && !is_bool($body['is_active'])) throw new RuntimeException('is_active must be boolean.'); return $this->supabase->service('PATCH', '/rest/v1/insurance_settings?setting_key=eq.' . rawurlencode($route[0]), ['value' => $body['value'], 'is_active' => $body['is_active'] ?? true, 'updated_by' => $actor['id']], ['Prefer: return=representation']); }
        throw new HttpException('Route not found.', 404);
    }

    private function assertNotSuperAdmin(string $id): void { $user = $this->supabase->service('GET', '/rest/v1/users?select=is_super_admin&id=eq.' . rawurlencode($id)); if (($user[0]['is_super_admin'] ?? false) === true) throw new RuntimeException('The Super Admin cannot be deactivated.'); }
    /** @param array<string, mixed> $actor */
    private function permissions(string $method, array $route, array $actor): array { if ($method !== 'GET' || $route !== ['permissions']) throw new HttpException('Route not found.', 404); $this->allow($actor, 'roles.view'); $result = $this->supabase->service('GET', '/rest/v1/permissions?select=id,permission_key,module,action,description&order=module,action'); return is_array($result) ? $result : []; }

    /** @return list<string> */
    private function capabilities(string $method, array $route, array $actor): array
    {
        if ($method !== 'GET' || $route !== ['capabilities']) throw new HttpException('Route not found.', 404);
        $permissions = $this->supabase->service('GET', '/rest/v1/permissions?select=permission_key&order=permission_key');
        if (!is_array($permissions)) return [];
        $keys = array_values(array_filter(array_column($permissions, 'permission_key'), 'is_string'));
        if (($actor['is_super_admin'] ?? false) === true) return $keys;
        return array_values(array_filter($keys, fn (string $key): bool => $this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', ['p_user_id' => $actor['id'], 'p_permission_key' => $key]) === true));
    }
    private function isUuid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1; }
    /** @param array<mixed> $ids @return array<mixed> */
    private function replaceRelations(string $table, string $ownerColumn, string $ownerId, string $itemColumn, array $ids, string $actorId): array
    {
        foreach ($ids as $id) {
            if (!is_int($id) && !ctype_digit((string) $id)) throw new RuntimeException('Relation IDs must be integers.');
        }
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if ($table === 'user_roles') {
            $this->supabase->service('POST', '/rest/v1/rpc/replace_setup_user_roles', [
                'p_user_id' => $ownerId, 'p_role_ids' => $ids, 'p_created_by' => $actorId,
            ]);
            return [];
        }
        if ($table === 'role_permissions') {
            $this->supabase->service('POST', '/rest/v1/rpc/replace_setup_role_permissions', [
                'p_role_id' => (int) $ownerId, 'p_permission_ids' => $ids,
            ]);
            return [];
        }
        throw new RuntimeException('Unsupported relation table.');
    }
    /** @param array<string, mixed> $body */
    private function required(array $body, string $key): string { $value = trim((string) ($body[$key] ?? '')); if ($value === '') throw new RuntimeException("{$key} is required."); return $value; }
}
