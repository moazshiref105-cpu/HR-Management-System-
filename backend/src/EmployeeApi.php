<?php

declare(strict_types=1);

namespace Hms\Backend;

use DateTimeImmutable;
use RuntimeException;
use Throwable;

/** Domain API for Employees. It deliberately owns validation and calculated HR rules. */
final class EmployeeApi
{
    private const REFERENCES = [
        'religion_id' => 'religions', 'marital_status_id' => 'marital_statuses', 'diploma_id' => 'diplomas',
        'governorate_id' => 'governorates', 'department_id' => 'departments', 'shift_type_id' => 'shift_types',
        'team_id' => 'teams', 'position_id' => 'positions', 'project_id' => 'projects', 'bank_id' => 'banks',
        'leaving_reason_id' => 'leaving_reasons', 'license_type_id' => 'license_types',
    ];
    private const PERSONAL = ['gender', 'arabic_full_name', 'english_full_name', 'identity_card_number', 'identity_card_expiration_date', 'date_of_birth', 'religion_id', 'marital_status_id', 'diploma_id', 'major', 'graduated_from', 'phone', 'governorate_id', 'address', 'employee_classification'];
    private const WORK = ['department_id', 'shift_type_id', 'team_id', 'position_id', 'project_id', 'joining_date', 'contract_signing_date'];
    private const INSURANCE = ['social_insurance_active', 'social_insurance_comment', 'form_1_incoming_number', 'form_1_incoming_date'];
    private const FINANCIAL = ['bank_id'];
    private const LEAVING = ['employee_status', 'leaving_date', 'leaving_reason_id', 'leaving_comment', 'annual_days_settled', 'form_6_incoming_number', 'form_6_incoming_date', 'form_6_reason'];

    private function __construct(private readonly SupabaseClient $supabase) {}

    public static function fromEnvironment(): self
    {
        $url = rtrim((string) getenv('SUPABASE_URL'), '/');
        $key = (string) getenv('SUPABASE_SECRET_KEY');
        if (filter_var($url, FILTER_VALIDATE_URL) === false || $key === '' || !function_exists('curl_init')) throw new RuntimeException('Server configuration is incomplete.');
        return new self(new SupabaseClient($url, $key));
    }

    public function dispatch(string $method, string $requestUri): never
    {
        $path = trim((string) parse_url($requestUri, PHP_URL_PATH), '/');
        $parts = $path === '' ? [] : explode('/', $path);
        if (array_slice($parts, 0, 2) !== ['api', 'employees']) throw new HttpException('Route not found.', 404);
        parse_str((string) parse_url($requestUri, PHP_URL_QUERY), $query);
        $actor = $this->actor();
        $body = $this->body();
        $route = array_slice($parts, 2);
        $result = $this->route($method, $route, $query, $body, $actor);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['data' => $result], JSON_THROW_ON_ERROR);
        exit;
    }

    /** @param array<string,mixed> $query @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function route(string $method, array $route, array $query, array $body, array $actor): array
    {
        if ($route === []) {
            if ($method === 'GET') return $this->list($query, $actor);
            if ($method === 'POST') return $this->create($body, $actor);
        }
        $id = $route[0] ?? '';
        if (!$this->uuid($id)) throw new RuntimeException('Employee ID is required.');
        if (count($route) === 1) {
            if ($method === 'GET') return $this->detail($id, $actor);
            if ($method === 'PATCH') return $this->update($id, $body, $actor);
        }
        if (($route[1] ?? '') === 'status' && $method === 'PATCH') return $this->status($id, $body, $actor);
        if (($route[1] ?? '') === 'notifications' && $method === 'POST') return $this->refresh($id, $actor);
        if (($route[1] ?? '') === 'contract-renewals' && $method === 'POST') return $this->renew($id, $body, $actor);
        if (in_array($route[1] ?? '', ['wives', 'children', 'licenses'], true)) return $this->nested($id, (string) $route[1], $method, array_slice($route, 2), $body, $actor);
        throw new HttpException('Route not found.', 404);
    }

    /** @param array<string,mixed> $actor */
    private function actor(): array
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $match)) throw new HttpException('Authentication is required.', 401);
        try { $auth = $this->supabase->authUser($match[1]); } catch (Throwable) { throw new HttpException('Authentication token is invalid.', 401); }
        $id = (string) ($auth['id'] ?? '');
        $users = $this->supabase->service('GET', '/rest/v1/users?select=id,is_active,is_super_admin&auth_user_id=eq.' . rawurlencode($id));
        $user = $users[0] ?? null;
        if (!is_array($user) || ($user['is_active'] ?? false) !== true) throw new HttpException('User account is inactive or not provisioned.', 403);
        return $user;
    }
    /** @return array<string,mixed> */
    private function body(): array { $raw = file_get_contents('php://input'); if ($raw === false || $raw === '') return []; $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR); if (!is_array($body)) throw new RuntimeException('JSON object expected.'); return $body; }
    /** @param array<string,mixed> $actor */
    private function allow(array $actor, string $permission): void { if (($actor['is_super_admin'] ?? false) === true) return; $ok = $this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', ['p_user_id' => $actor['id'], 'p_permission_key' => $permission]); if ($ok !== true) throw new HttpException('You are not authorized for this action.', 403); }
    /** @param array<string,mixed> $actor */
    private function can(array $actor, string $permission): bool { if (($actor['is_super_admin'] ?? false) === true) return true; return $this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', ['p_user_id' => $actor['id'], 'p_permission_key' => $permission]) === true; }

    /** @param array<string,mixed> $query @param array<string,mixed> $actor */
    private function list(array $query, array $actor): array
    {
        $this->allow($actor, 'employees.view');
        $filters = [];
        foreach (['employee_status' => 'employee_status', 'department' => 'department_id', 'team' => 'team_id', 'position' => 'position_id', 'project' => 'project_id', 'governorate' => 'governorate_id'] as $input => $column) {
            if (isset($query[$input]) && $query[$input] !== '') $filters[] = $column . '=eq.' . rawurlencode((string) $query[$input]);
        }
        if (isset($query['search']) && trim((string) $query['search']) !== '') {
            $search = trim((string) $query['search']);
            $term = rawurlencode('*' . $search . '*');
            $numeric = ctype_digit($search) ? 'employee_number.eq.' . rawurlencode($search) . ',' : '';
            $filters[] = 'or=(' . $numeric . 'arabic_full_name.ilike.' . $term . ',english_full_name.ilike.' . $term . ')';
        }
        $select = 'id,employee_number,employee_status,employee_classification,arabic_full_name,english_full_name,identity_card_expiration_date,department:departments(id,name),team:teams(id,name),position:positions(id,name,position_code),project:projects(id,name),governorate:governorates(id,name,participates_in_comprehensive_health_insurance)';
        $url = '/rest/v1/employees?select=' . $select . '&order=employee_number';
        if ($filters) $url .= '&' . implode('&', $filters);
        return $this->supabase->service('GET', $url);
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function create(array $body, array $actor): array
    {
        $this->allow($actor, 'employees.create');
        if (array_key_exists('employee_number', $body)) throw new RuntimeException('Employee ID is generated by the system.');
        $this->guardSections($body, $actor);
        $record = $this->employeeRecord($body, true, $actor);
        $created = $this->supabase->service('POST', '/rest/v1/employees', [$record], ['Prefer: return=representation']);
        $id = (string) ($created[0]['id'] ?? '');
        if ($id !== '') $this->refresh($id, $actor);
        return $this->detail($id, $actor);
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function update(string $id, array $body, array $actor): array
    {
        $this->allow($actor, 'employees.edit');
        if (array_key_exists('employee_number', $body) || array_key_exists('position_code', $body)) throw new RuntimeException('Employee ID and position code cannot be changed directly.');
        $this->guardSections($body, $actor);
        $record = $this->employeeRecord($body, false, $actor);
        if ($record === []) throw new RuntimeException('At least one editable field is required.');
        $this->supabase->service('PATCH', '/rest/v1/employees?id=eq.' . rawurlencode($id), $record, ['Prefer: return=representation']);
        $this->refresh($id, $actor);
        return $this->detail($id, $actor);
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function status(string $id, array $body, array $actor): array
    {
        $this->allow($actor, 'employees.edit');
        $status = (string) ($body['employee_status'] ?? '');
        if (!in_array($status, ['active', 'resigned', 'inactive'], true)) throw new RuntimeException('employee_status must be active, resigned, or inactive.');
        if ($status !== 'active') {
            $this->allow($actor, 'employees.delete');
            if (!$this->date($body['leaving_date'] ?? null) || !$this->positiveId($body['leaving_reason_id'] ?? null)) throw new RuntimeException('Leaving date and leaving reason are required for resigned or inactive employees.');
            $this->assertActiveReference('leaving_reasons', (int) $body['leaving_reason_id']);
        }
        $record = array_intersect_key($body, array_flip(self::LEAVING));
        $record['employee_status'] = $status; $record['updated_by'] = $actor['id'];
        $this->supabase->service('PATCH', '/rest/v1/employees?id=eq.' . rawurlencode($id), $record, ['Prefer: return=representation']);
        return $this->detail($id, $actor);
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function nested(string $employeeId, string $resource, string $method, array $route, array $body, array $actor): array
    {
        $permission = $resource === 'licenses' ? 'employees.insurance.edit' : 'employees.personal.edit';
        $this->allow($actor, $permission);
        $table = 'employee_' . $resource;
        $id = (int) ($route[0] ?? 0);
        if ($method === 'POST' && $route === []) { $record = $this->nestedRecord($resource, $body, $actor, true); $record['employee_id'] = $employeeId; $result = $this->supabase->service('POST', '/rest/v1/' . $table, [$record], ['Prefer: return=representation']); $this->refresh($employeeId, $actor); return $result; }
        if ($method === 'PATCH' && $id > 0) { $record = $this->nestedRecord($resource, $body, $actor, false); if ($record === []) throw new RuntimeException('At least one editable field is required.'); $result = $this->supabase->service('PATCH', '/rest/v1/' . $table . '?id=eq.' . $id . '&employee_id=eq.' . rawurlencode($employeeId), $record, ['Prefer: return=representation']); $this->refresh($employeeId, $actor); return $result; }
        throw new HttpException('Route not found.', 404);
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function renew(string $id, array $body, array $actor): array
    {
        $this->allow($actor, 'employees.work.edit');
        if (!$this->date($body['renewal_signing_date'] ?? null)) throw new RuntimeException('A valid renewal_signing_date is required.');
        if ($this->renewalExists($id, (string) $body['renewal_signing_date'])) throw new RuntimeException('Contract renewal already exists for this date.');
        try {
            $result = $this->supabase->service('POST', '/rest/v1/rpc/renew_employee_contract', ['p_employee_id' => $id, 'p_renewal_signing_date' => $body['renewal_signing_date'], 'p_actor_id' => $actor['id']]);
        } catch (Throwable $exception) {
            // The database constraint remains the concurrency-safe backstop.
            if ($this->renewalExists($id, (string) $body['renewal_signing_date'])) throw new RuntimeException('Contract renewal already exists for this date.');
            throw $exception;
        }
        $this->refresh($id, $actor);
        return ['renewal' => $result, 'employee' => $this->detail($id, $actor)];
    }

    private function renewalExists(string $employeeId, string $signingDate): bool
    {
        $rows = $this->supabase->service('GET', '/rest/v1/employee_contract_renewals?select=id&employee_id=eq.' . rawurlencode($employeeId) . '&renewal_signing_date=eq.' . rawurlencode($signingDate) . '&limit=1');
        return isset($rows[0]);
    }

    /** @param array<string,mixed> $actor */
    private function refresh(string $id, array $actor): array
    {
        $this->allow($actor, 'employees.view');
        $this->supabase->service('POST', '/rest/v1/rpc/refresh_employee_notifications', ['p_employee_id' => $id]);
        return $this->supabase->service('GET', '/rest/v1/employee_notifications?employee_id=eq.' . rawurlencode($id) . '&select=*&order=due_date,reminder_threshold_days');
    }

    /** @param array<string,mixed> $actor */
    private function detail(string $id, array $actor): array
    {
        $this->allow($actor, 'employees.view');
        $row = $this->employee($id);
        $personal = $this->can($actor, 'employees.personal.view');
        $work = $this->can($actor, 'employees.work.view');
        $insurance = $this->can($actor, 'employees.insurance.view');
        $financial = $this->can($actor, 'employees.financial.view');
        $result = ['id' => $row['id'], 'employee_number' => $row['employee_number'], 'employee_status' => $row['employee_status'], 'employee_classification' => $row['employee_classification']];
        if ($personal) $result['personal'] = $this->pick($row, array_merge(self::PERSONAL, ['identity_card_expiration_date', 'religion', 'marital_status', 'diploma', 'governorate']));
        if ($work) $result['work'] = $this->pick($row, array_merge(self::WORK, ['contract_expiration_date', 'probation_due_date', 'department', 'shift_type', 'team', 'position', 'project']));
        if ($personal) $result['family'] = ['wives' => $this->supabase->service('GET', '/rest/v1/employee_wives?employee_id=eq.' . rawurlencode($id) . '&select=*&order=id'), 'children' => $this->supabase->service('GET', '/rest/v1/employee_children?employee_id=eq.' . rawurlencode($id) . '&select=*&order=id')];
        if ($insurance) { $result['insurance'] = $this->insurance($row, $id); $result['licenses'] = $this->supabase->service('GET', '/rest/v1/employee_licenses?employee_id=eq.' . rawurlencode($id) . '&select=*,license_type:license_types(id,name)&order=id'); $result['notifications'] = $this->refresh($id, $actor); }
        if ($financial) $result['financial'] = ['bank' => $row['bank'] ?? null];
        if ($this->can($actor, 'employees.edit')) $result['leaving'] = $this->pick($row, self::LEAVING);
        if ($work) $result['contract_history'] = $this->supabase->service('GET', '/rest/v1/employee_contract_renewals?employee_id=eq.' . rawurlencode($id) . '&select=*&order=renewal_signing_date.desc');
        if ($personal || $work || $insurance) $result['calculated'] = $this->calculated($row, $id);
        return $result;
    }

    /** @return array<string,mixed> */
    private function employee(string $id): array
    {
        $select = '*,religion:religions(id,name),marital_status:marital_statuses(id,name),diploma:diplomas(id,name),governorate:governorates(id,name,participates_in_comprehensive_health_insurance),department:departments(id,name),shift_type:shift_types(id,name),team:teams(id,name),position:positions(id,name,position_code),project:projects(id,name),bank:banks(id,name),leaving_reason:leaving_reasons(id,name)';
        $rows = $this->supabase->service('GET', '/rest/v1/employees?id=eq.' . rawurlencode($id) . '&select=' . $select);
        if (!isset($rows[0]) || !is_array($rows[0])) throw new HttpException('Employee not found.', 404);
        return $rows[0];
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor @return array<string,mixed> */
    private function employeeRecord(array $body, bool $creating, array $actor): array
    {
        $allowed = array_merge(self::PERSONAL, self::WORK, self::INSURANCE, self::FINANCIAL, self::LEAVING);
        $record = array_intersect_key($body, array_flip($allowed));
        if ($creating) foreach (['gender','arabic_full_name','english_full_name','identity_card_number','identity_card_expiration_date','date_of_birth','religion_id','marital_status_id','governorate_id','phone','department_id','shift_type_id','position_id','joining_date','contract_signing_date'] as $key) if (!array_key_exists($key, $record) || $record[$key] === '') throw new RuntimeException("{$key} is required.");
        if (isset($record['identity_card_number']) && !preg_match('/^[0-9]{14}$/', (string) $record['identity_card_number'])) throw new RuntimeException('Identity card number must be exactly 14 digits.');
        if (isset($record['phone']) && !preg_match('/^[0-9]{11}$/', (string) $record['phone'])) throw new RuntimeException('Phone must be exactly 11 digits.');
        foreach (['identity_card_expiration_date','date_of_birth','joining_date','contract_signing_date','form_1_incoming_date','leaving_date','form_6_incoming_date'] as $key) if (array_key_exists($key, $record) && $record[$key] !== null && !$this->date($record[$key])) throw new RuntimeException("{$key} must be a valid date.");
        if (isset($record['date_of_birth']) && $record['date_of_birth'] > (new DateTimeImmutable('today'))->format('Y-m-d')) throw new RuntimeException('date_of_birth cannot be in the future.');
        foreach (self::REFERENCES as $column => $table) if (array_key_exists($column, $record) && $record[$column] !== null) { if (!$this->positiveId($record[$column])) throw new RuntimeException("{$column} must be a valid ID."); $this->assertActiveReference($table, (int) $record[$column]); }
        if (isset($record['gender']) && !in_array($record['gender'], ['male','female'], true)) throw new RuntimeException('gender must be male or female.');
        if (isset($record['employee_classification']) && !in_array($record['employee_classification'], ['standard','five_percent'], true)) throw new RuntimeException('employee_classification must be standard or five_percent.');
        if (isset($record['contract_signing_date'], $record['joining_date']) && $record['contract_signing_date'] < $record['joining_date']) throw new RuntimeException('Contract signing date cannot be before joining date.');
        if (($record['employee_status'] ?? 'active') !== 'active' && (!$this->date($record['leaving_date'] ?? null) || !$this->positiveId($record['leaving_reason_id'] ?? null))) throw new RuntimeException('Leaving date and leaving reason are required for resigned or inactive employees.');
        if ($creating) $record['created_by'] = $actor['id'];
        $record['updated_by'] = $actor['id'];
        return $record;
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor @return array<string,mixed> */
    private function nestedRecord(string $resource, array $body, array $actor, bool $creating): array
    {
        $fields = match ($resource) { 'wives' => ['wife_name','identity_card_number','is_working'], 'children' => ['wife_id','child_name','identity_card_number'], 'licenses' => ['license_type_id','release_date','expiry_date'] };
        $record = array_intersect_key($body, array_flip($fields));
        if ($creating) foreach (match ($resource) { 'wives' => ['wife_name','identity_card_number'], 'children' => ['child_name','identity_card_number'], 'licenses' => ['license_type_id','release_date','expiry_date'] } as $field) if (!array_key_exists($field, $record) || $record[$field] === '') throw new RuntimeException("{$field} is required.");
        if ($resource === 'wives') { if (isset($record['identity_card_number']) && !preg_match('/^[0-9]{14}$/', (string) $record['identity_card_number'])) throw new RuntimeException('Wife identity card number must be exactly 14 digits.'); }
        if ($resource === 'children') { if (isset($record['identity_card_number']) && !preg_match('/^[0-9]{14}$/', (string) $record['identity_card_number'])) throw new RuntimeException('Child identity card number must be exactly 14 digits.'); if (isset($record['wife_id']) && !$this->positiveId($record['wife_id'])) throw new RuntimeException('wife_id must be a valid ID.'); }
        if ($resource === 'licenses') { if (!$this->positiveId($record['license_type_id'] ?? null)) throw new RuntimeException('license_type_id is required.'); $this->assertActiveReference('license_types', (int) $record['license_type_id']); if (!$this->date($record['release_date'] ?? null) || !$this->date($record['expiry_date'] ?? null) || $record['expiry_date'] < $record['release_date']) throw new RuntimeException('License release and expiry dates must be valid and ordered.'); }
        foreach (['wife_name','child_name'] as $name) if (array_key_exists($name, $record) && trim((string) $record[$name]) === '') throw new RuntimeException("{$name} cannot be blank.");
        $record['updated_by'] = $actor['id']; if ($creating) $record['created_by'] = $actor['id'];
        return $record;
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function guardSections(array $body, array $actor): void
    {
        foreach ([[self::PERSONAL, 'employees.personal.edit'], [self::WORK, 'employees.work.edit'], [self::INSURANCE, 'employees.insurance.edit'], [self::FINANCIAL, 'employees.financial.edit']] as [$fields, $permission]) if (array_intersect_key($body, array_flip($fields))) $this->allow($actor, $permission);
    }
    private function assertActiveReference(string $table, int $id): void { $rows = $this->supabase->service('GET', '/rest/v1/' . $table . '?select=id&id=eq.' . $id . '&is_active=eq.true'); if (!isset($rows[0])) throw new RuntimeException("Selected {$table} record does not exist or is inactive."); }
    /** @return array<string,mixed> */
    private function insurance(array $row, string $id): array { return array_merge($this->pick($row, self::INSURANCE), ['form_1_deadline_date' => $this->addMonths((string) $row['contract_signing_date'], 1), 'comprehensive_health' => $this->comprehensive($row, $id)]); }
    /** @return array<string,mixed> */
    private function calculated(array $row, string $id): array { $settings = $this->settings(); $medical = (int) $settings['medical_insurance_eligibility_months']; $life = (int) $settings['life_insurance_eligibility_months']; $today = (new DateTimeImmutable('today'))->format('Y-m-d'); return ['age' => (new DateTimeImmutable((string)$row['date_of_birth']))->diff(new DateTimeImmutable('today'))->y, 'contract_expiration_date' => $row['contract_expiration_date'], 'probation_due_date' => $row['probation_due_date'], 'position' => $row['position'] ?? null, 'medical_insurance' => ['configured_eligibility_months' => $medical, 'eligibility_date' => $this->addMonths((string)$row['joining_date'], $medical), 'is_eligible' => $this->addMonths((string)$row['joining_date'], $medical) <= $today], 'life_insurance' => ['configured_eligibility_months' => $life, 'eligibility_date' => $this->addMonths((string)$row['joining_date'], $life), 'is_eligible' => $this->addMonths((string)$row['joining_date'], $life) <= $today], 'comprehensive_health_deduction' => $this->comprehensive($row, $id)]; }
    /** @return array<string,mixed> */
    private function comprehensive(array $row, string $id): array { $settings = $this->settings(); $wives = $this->supabase->service('GET', '/rest/v1/employee_wives?employee_id=eq.' . rawurlencode($id) . '&select=is_working'); $children = $this->supabase->service('GET', '/rest/v1/employee_children?employee_id=eq.' . rawurlencode($id) . '&select=id'); $nonWorking = count(array_filter($wives, static fn($wife) => ($wife['is_working'] ?? false) === false)); $childCount = count($children); $participates = (bool) (($row['governorate']['participates_in_comprehensive_health_insurance'] ?? false)); $applicable = $row['gender'] === 'male' && $participates; $base = (float)$settings['comprehensive_health_employee_deduction_percent']; $wife = (float)$settings['comprehensive_health_non_working_wife_deduction_percent']; $child = (float)$settings['comprehensive_health_child_deduction_percent']; $wifeTotal = $applicable ? $nonWorking * $wife : 0.0; $childTotal = $applicable ? $childCount * $child : 0.0; return ['governorate_participates' => $participates, 'base_percent' => $base, 'non_working_wife_count' => $nonWorking, 'wife_percent_each' => $wife, 'wife_total_percent' => $wifeTotal, 'child_count' => $childCount, 'child_percent_each' => $child, 'child_total_percent' => $childTotal, 'total_percent' => $base + $wifeTotal + $childTotal]; }
    /** @return array<string,float> */
    private function settings(): array { $rows = $this->supabase->service('GET', '/rest/v1/insurance_settings?select=setting_key,value&is_active=eq.true'); $settings = []; foreach ($rows as $row) $settings[(string)$row['setting_key']] = (float)$row['value']; foreach (['medical_insurance_eligibility_months','life_insurance_eligibility_months','comprehensive_health_employee_deduction_percent','comprehensive_health_non_working_wife_deduction_percent','comprehensive_health_child_deduction_percent'] as $key) if (!array_key_exists($key, $settings)) throw new RuntimeException("Required insurance setting {$key} is unavailable."); return $settings; }
    /** @param array<string,mixed> $row @param array<int,string> $keys @return array<string,mixed> */
    private function pick(array $row, array $keys): array { $out = []; foreach ($keys as $key) if (array_key_exists($key, $row)) $out[$key] = $row[$key]; return $out; }
    private function addMonths(string $date, int $months): string { return (new DateTimeImmutable($date))->modify('+' . $months . ' months')->format('Y-m-d'); }
    private function date(mixed $value): bool { if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) return false; $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value); return $date !== false && $date->format('Y-m-d') === $value; }
    private function uuid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1; }
    private function positiveId(mixed $value): bool { return (is_int($value) || ctype_digit((string)$value)) && (int)$value > 0; }
}
