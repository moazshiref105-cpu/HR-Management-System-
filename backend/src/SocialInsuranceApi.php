<?php
declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;

/** Permission-checked API for the normalized Form 1 / Form 6 record. */
final class SocialInsuranceApi
{
    private const FORM_1_FIELDS = [
        'form_1_installation_date', 'form_1_social_insurance_number',
        'form_1_incoming_number', 'form_1_incoming_date',
        'form_1_insurance_status_text', 'form_1_notes',
    ];
    private const FORM_6_FIELDS = [
        'form_6_termination_date', 'form_6_termination_reason',
        'form_6_social_insurance_number', 'form_6_incoming_number',
        'form_6_incoming_date', 'form_6_insurance_status_text', 'form_6_notes',
    ];

    private function __construct(private readonly SupabaseClient $db, private readonly AuthenticatedActorResolver $auth) {}

    public static function fromEnvironment(): self
    {
        $url = rtrim((string) getenv('SUPABASE_URL'), '/');
        $key = (string) getenv('SUPABASE_SECRET_KEY');
        if (!filter_var($url, FILTER_VALIDATE_URL) || $key === '' || !function_exists('curl_init')) {
            throw new RuntimeException('Server configuration is incomplete.');
        }
        $db = new SupabaseClient($url, $key);
        return new self($db, AuthenticatedActorResolver::fromEnvironment($db, $url));
    }

    public function dispatch(string $method, string $uri): never
    {
        $parts = explode('/', trim((string) parse_url($uri, PHP_URL_PATH), '/'));
        if (array_slice($parts, 0, 2) !== ['api', 'social-insurance']) throw new HttpException('Route not found.', 404);
        parse_str((string) parse_url($uri, PHP_URL_QUERY), $query);
        $raw = file_get_contents('php://input');
        $body = $raw ? json_decode($raw, true, 512, JSON_THROW_ON_ERROR) : [];
        if (!is_array($body)) throw new HttpException('JSON object expected.', 400);
        $actor = $this->auth->resolve();
        $route = array_slice($parts, 2);
        $result = $route === [] && $method === 'GET' ? $this->list($query, $actor)
            : ($route === ['options'] && $method === 'GET' ? $this->options($actor)
            : ($route === ['bulk'] && $method === 'PATCH' ? $this->bulk($body, $actor)
            : (count($route) === 1 ? $this->employee($method, $route[0], $query, $body, $actor)
            : throw new HttpException('Route not found.', 404))));
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['data' => $result], JSON_THROW_ON_ERROR);
        exit;
    }

    private function allow(array $actor, string $permission): void
    {
        if (($actor['is_super_admin'] ?? false) === true) return;
        $allowed = $this->db->service('POST', '/rest/v1/rpc/user_has_permission', [
            'p_user_id' => $actor['id'], 'p_permission_key' => $permission,
        ]);
        if ($allowed !== true) throw new HttpException('You are not authorized for this action.', 403);
    }

    private function list(array $query, array $actor): array
    {
        $this->allow($actor, 'employees.documents.view');
        $page = max(1, (int) ($query['page'] ?? 1));
        $pageSize = (int) ($query['page_size'] ?? 25);
        if (!in_array($pageSize, [25, 50, 100], true)) throw new HttpException('Page size must be 25, 50, or 100.', 422);

        $formType = (string) ($query['form_type'] ?? 'all');
        if (!in_array($formType, ['all', 'form_1', 'form_6'], true)) throw new HttpException('Choose a valid form filter.', 422);
        $view = (string) ($query['view'] ?? 'all');
        if (!in_array($view, ['all', 'needs_attention', 'form_1_needs_attention', 'form_6_needs_attention'], true)) {
            throw new HttpException('Choose a valid Social Insurance view.', 422);
        }
        $case = (string) ($query['case'] ?? 'all');
        if (!in_array($case, ['all', 'needs_attention', 'complete'], true)) throw new HttpException('Choose a valid case filter.', 422);
        $department = isset($query['department']) && $query['department'] !== '' ? (string) $query['department'] : null;
        if ($department !== null && !preg_match('/^[1-9]\d*$/', $department)) throw new HttpException('Choose a valid department.', 422);
        $employeeId = isset($query['employee_id']) && $query['employee_id'] !== '' ? (string) $query['employee_id'] : null;
        if ($employeeId !== null && !$this->uuid($employeeId)) throw new HttpException('Employee ID is invalid.', 422);
        $from = $query['from'] ?? null;
        $to = $query['to'] ?? null;
        $this->validateDate($from);
        $this->validateDate($to);
        if ($from && $to && $from > $to) throw new HttpException('Start date must not be after end date.', 422);

        $result = $this->db->service('POST', '/rest/v1/rpc/employee_social_insurance_records', [
            'p_form_type' => $formType, 'p_view' => $view,
            'p_department_id' => $department, 'p_search' => trim((string) ($query['search'] ?? '')) ?: null,
            'p_from' => $from, 'p_to' => $to, 'p_employee_id' => $employeeId,
            'p_page' => $page, 'p_page_size' => $pageSize, 'p_case' => $case,
        ]);
        return is_array($result) ? $result : ['rows' => [], 'total' => 0, 'page' => $page, 'page_size' => $pageSize];
    }

    private function options(array $actor): array
    {
        $this->allow($actor, 'employees.documents.view');
        $rows = $this->db->service('GET', '/rest/v1/departments?select=id,name,is_active&order=name');
        $reasons = $this->db->service('GET', '/rest/v1/leaving_reasons?select=id,name,is_active&order=name');
        return [
            'departments' => is_array($rows) ? $rows : [],
            'leaving_reasons' => is_array($reasons) ? $reasons : [],
        ];
    }

    private function employee(string $method, string $id, array $query, array $body, array $actor): array
    {
        if (!$this->uuid($id)) throw new HttpException('Employee ID is invalid.', 422);
        if (($query['view'] ?? '') === 'audit') {
            $this->allow($actor, 'employees.documents.view');
            $rows = $this->db->service('GET', '/rest/v1/employee_social_insurance_audit?employee_id=eq.' . rawurlencode($id)
                . '&select=id,actor_id,changed_at,changes,actor:users!employee_social_insurance_audit_actor_id_fkey(id,full_name)'
                . '&order=changed_at.desc&limit=100');
            return ['rows' => is_array($rows) ? array_map(function (array $row): array {
                $row['changes'] = $this->publicAuditChanges($row['changes'] ?? []);
                return $row;
            }, $rows) : []];
        }
        if ($method === 'GET') {
            $this->allow($actor, 'employees.documents.view');
            $result = $this->db->service('POST', '/rest/v1/rpc/employee_social_insurance_records', [
                'p_form_type' => 'all', 'p_view' => 'all', 'p_department_id' => null,
                'p_search' => null, 'p_from' => null, 'p_to' => null,
                'p_employee_id' => $id, 'p_page' => 1, 'p_page_size' => 1, 'p_case' => 'all',
            ]);
            if (isset($result['rows'][0]) && is_array($result['rows'][0])) return $result['rows'][0];
            return [];
        }
        if ($method !== 'PATCH') throw new HttpException('Method not allowed.', 405);

        $this->allow($actor, 'employees.documents.edit');
        if (array_key_exists('leaving_reason_id', $body)) $this->allow($actor, 'employees.edit');
        $employees = $this->db->service('GET', '/rest/v1/employees?id=eq.' . rawurlencode($id) . '&select=id,employee_status&limit=1');
        $employee = is_array($employees) ? ($employees[0] ?? null) : null;
        if (!$employee) throw new HttpException('Employee was not found.', 404);
        $status = $employee['employee_status'] ?? '';
        if (!in_array($status, ['active', 'resigned'], true)) throw new HttpException('Social Insurance can only be managed for active or resigned employees.', 422);
        $allowed = $status === 'active' ? self::FORM_1_FIELDS : array_merge(self::FORM_6_FIELDS, ['leaving_reason_id', 'expected_leaving_reason_id']);
        $unknown = array_diff(array_keys($body), array_merge($allowed, ['version']));
        if ($unknown !== []) throw new HttpException('The request contains an unsupported Social Insurance field.', 422);
        $patch = array_intersect_key($body, array_flip($allowed));
        if (array_key_exists('leaving_reason_id', $patch) && $patch['leaving_reason_id'] !== null
            && (!is_int($patch['leaving_reason_id']) || $patch['leaving_reason_id'] < 1)) {
            throw new HttpException('Choose a valid leaving reason.', 422);
        }
        if (array_key_exists('expected_leaving_reason_id', $patch) && $patch['expected_leaving_reason_id'] !== null
            && (!is_int($patch['expected_leaving_reason_id']) || $patch['expected_leaving_reason_id'] < 1)) {
            throw new HttpException('Reload the employee before changing the leaving reason.', 422);
        }
        if (array_key_exists('expected_leaving_reason_id', $patch) && !array_key_exists('leaving_reason_id', $patch)) {
            throw new HttpException('The leaving reason update is incomplete.', 422);
        }

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $patch) || $patch[$field] === null) continue;
            if (str_ends_with($field, '_date')) {
                $this->validateDate($patch[$field]);
            } elseif ($field === ($status === 'active' ? 'form_1_social_insurance_number' : 'form_6_social_insurance_number')
                || str_ends_with($field, '_incoming_number')) {
                $this->validateText($patch[$field], 80, 'Enter a valid number (up to 80 characters).', true);
            } elseif (str_ends_with($field, '_insurance_status_text')) {
                $this->validateText($patch[$field], 1000, 'Insurance status must be 1,000 characters or fewer.', true);
            } elseif (str_ends_with($field, '_notes')) {
                $this->validateText($patch[$field], 10000, 'Notes must be 10,000 characters or fewer.', true);
            } elseif ($field === 'form_6_termination_reason') {
                $this->validateText($patch[$field], 1000, 'Termination reason must be 1,000 characters or fewer.', true);
            }
        }

        $row = $this->db->service('POST', '/rest/v1/rpc/update_employee_social_insurance', [
            'p_employee_id' => $id, 'p_patch' => $patch,
            'p_expected_version' => isset($body['version']) ? (int) $body['version'] : null,
            'p_actor_id' => $actor['id'],
        ]);
        try { $this->db->publishEmployeeInvalidation($id); } catch (\Throwable) { /* Persisted state remains authoritative during realtime outages. */ }
        return is_array($row) ? $row : [];
    }

    private function bulk(array $body, array $actor): array
    {
        $this->allow($actor, 'employees.documents.edit');
        $ids = $body['employee_ids'] ?? [];
        $allowed = array_merge(self::FORM_1_FIELDS, self::FORM_6_FIELDS);
        if (array_diff(array_keys($body), array_merge($allowed, ['employee_ids'])) !== []) {
            throw new HttpException('The request contains an unsupported Social Insurance field.', 422);
        }
        $patch = array_intersect_key($body, array_flip($allowed));
        if (!is_array($ids) || $ids === [] || count($ids) > 100) throw new HttpException('Choose up to 100 employees.', 422);
        $results = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !$this->uuid($id)) continue;
            try {
                $results[] = ['employee_id' => $id, 'success' => true, 'record' => $this->employee('PATCH', $id, [], $patch + ['version' => null], $actor)];
            } catch (\Throwable) {
                $results[] = ['employee_id' => $id, 'success' => false, 'message' => 'This employee could not be updated.'];
            }
        }
        return ['results' => $results];
    }

    /** Keep historic audit entries stored, while exposing only fields in the current contract. */
    private function publicAuditChanges(mixed $changes): array
    {
        if (!is_array($changes)) return [];
        $allowed = array_flip(array_merge(self::FORM_1_FIELDS, self::FORM_6_FIELDS));
        if (isset($changes['created']) && is_array($changes['created'])) {
            return ['created' => array_intersect_key($changes['created'], $allowed)];
        }
        return array_intersect_key($changes, $allowed);
    }

    private function validateText(mixed $value, int $maximum, string $message, bool $allowEmpty = false): void
    {
        if (!is_string($value) || strlen($value) > $maximum || (!$allowEmpty && trim($value) === '') || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
            throw new HttpException($message, 422);
        }
    }

    private function validateDate(mixed $value): void
    {
        if ($value === null || $value === '') return;
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)
            || !checkdate((int) substr($value, 5, 2), (int) substr($value, 8, 2), (int) substr($value, 0, 4))) {
            throw new HttpException('Enter a valid date.', 422);
        }
    }

    private function uuid(string $value): bool
    {
        return (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value);
    }
}
