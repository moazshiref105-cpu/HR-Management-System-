<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;

/** Employee document metadata and compliance review API. File bytes stay in private Storage. */
final class DocumentApi
{
    private function __construct(private readonly SupabaseClient $supabase, private readonly AuthenticatedActorResolver $auth) {}

    public static function fromEnvironment(): self
    {
        $url = rtrim((string) getenv('SUPABASE_URL'), '/');
        $key = (string) getenv('SUPABASE_SECRET_KEY');
        if (filter_var($url, FILTER_VALIDATE_URL) === false || $key === '' || !function_exists('curl_init')) throw new RuntimeException('Server configuration is incomplete.');
        $client = new SupabaseClient($url, $key);
        return new self($client, AuthenticatedActorResolver::fromEnvironment($client, $url));
    }

    public function dispatch(string $method, string $requestUri): never
    {
        $path = trim((string) parse_url($requestUri, PHP_URL_PATH), '/');
        $parts = $path === '' ? [] : explode('/', $path);
        if (array_slice($parts, 0, 2) !== ['api', 'documents']) throw new HttpException('Route not found.', 404);
        parse_str((string) parse_url($requestUri, PHP_URL_QUERY), $query);
        $actor = $this->auth->resolve();
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
        if ($route === ['types'] && $method === 'GET') return $this->types($actor);
        if ($route === [] && $method === 'GET') return $this->list($query, $actor);
        if ($route === [] && $method === 'POST') return $this->create($body, $actor);
        $id = (string) ($route[0] ?? '');
        if (!$this->uuid($id)) throw new HttpException('Document ID is required.', 422);
        if (count($route) === 1 && $method === 'PATCH') return $this->update($id, $body, $actor);
        throw new HttpException('Route not found.', 404);
    }

    /** @return array<string,mixed> */
    private function body(): array { $raw = file_get_contents('php://input'); if ($raw === false || $raw === '') return []; $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR); if (!is_array($body)) throw new HttpException('JSON object expected.', 422); return $body; }
    /** @param array<string,mixed> $actor */
    private function allow(array $actor, string $permission): void { if (($actor['is_super_admin'] ?? false) === true) return; if ($this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', ['p_user_id' => $actor['id'], 'p_permission_key' => $permission]) !== true) throw new HttpException('You are not authorized for this action.', 403); }

    /** @param array<string,mixed> $actor */
    private function types(array $actor): array
    {
        $this->allow($actor, 'employees.documents.view');
        $rows = $this->supabase->service('GET', '/rest/v1/employee_document_types?select=*&is_active=is.true&order=category.asc,name.asc');
        return is_array($rows) ? $rows : [];
    }

    /** @param array<string,mixed> $query @param array<string,mixed> $actor */
    private function list(array $query, array $actor): array
    {
        $this->allow($actor, 'employees.documents.view');
        $page = $this->positive($query['page'] ?? 1, 'page');
        $pageSize = $this->pageSize($query['page_size'] ?? 25);
        $filters = [];
        if (($query['employee_id'] ?? '') !== '') { $employeeId = (string) $query['employee_id']; if (!$this->uuid($employeeId)) throw new HttpException('Employee ID is invalid.', 422); $filters[] = 'employee_id=eq.' . rawurlencode($employeeId); }
        if (($query['status'] ?? '') !== '') { $status = (string) $query['status']; if (!in_array($status, ['missing','received','under_review','verified','rejected','expired','waived'], true)) throw new HttpException('Document status is invalid.', 422); $filters[] = 'status=eq.' . rawurlencode($status); }
        $offset = ($page - 1) * $pageSize;
        $select = 'id,employee_id,status,reference_number,issued_on,expires_on,original_file_name,content_type,file_size_bytes,storage_path,notes,rejection_reason,reviewed_at,created_at,updated_at,document_type:employee_document_types(id,document_key,name,category,requires_expiry),employee:employees(id,employee_number,arabic_full_name,english_full_name)';
        $response = $this->supabase->serviceWithExactCount('GET', '/rest/v1/employee_documents?select=' . $select . '&order=updated_at.desc&offset=' . $offset . '&limit=' . $pageSize . ($filters ? '&' . implode('&', $filters) : ''));
        $total = $response['total'];
        return ['data' => is_array($response['data']) ? $response['data'] : [], 'pagination' => ['page' => $page, 'page_size' => $pageSize, 'total' => $total, 'total_pages' => $total === 0 ? 0 : (int) ceil($total / $pageSize)]];
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function create(array $body, array $actor): array
    {
        $this->allow($actor, 'employees.documents.edit');
        $record = $this->record($body, $actor, true);
        $rows = $this->supabase->service('POST', '/rest/v1/employee_documents', [$record], ['Prefer: return=representation']);
        $row = $rows[0] ?? null;
        if (!is_array($row)) throw new RuntimeException('Document could not be saved.');
        return $row;
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor */
    private function update(string $id, array $body, array $actor): array
    {
        $review = array_key_exists('status', $body) && in_array((string) $body['status'], ['verified', 'rejected', 'waived'], true);
        $this->allow($actor, $review ? 'employees.documents.review' : 'employees.documents.edit');
        $record = $this->record($body, $actor, false);
        if ($record === []) throw new HttpException('At least one editable document field is required.', 422);
        $existing = $this->supabase->service('GET', '/rest/v1/employee_documents?select=id,status&limit=1&id=eq.' . rawurlencode($id));
        if (!is_array($existing) || !isset($existing[0])) throw new HttpException('Document not found.', 404);
        if (isset($record['status']) && in_array($record['status'], ['verified', 'rejected', 'waived'], true)) { $record['reviewed_at'] = gmdate('c'); $record['reviewed_by'] = $actor['id']; }
        $rows = $this->supabase->service('PATCH', '/rest/v1/employee_documents?id=eq.' . rawurlencode($id), $record, ['Prefer: return=representation']);
        $row = $rows[0] ?? null;
        if (!is_array($row)) throw new RuntimeException('Document could not be updated.');
        return $row;
    }

    /** @param array<string,mixed> $body @param array<string,mixed> $actor @return array<string,mixed> */
    private function record(array $body, array $actor, bool $creating): array
    {
        $allowed = ['document_type_id','status','reference_number','issued_on','expires_on','original_file_name','content_type','file_size_bytes','storage_path','notes','rejection_reason'];
        $record = [];
        foreach ($allowed as $key) if (array_key_exists($key, $body)) $record[$key] = $body[$key] === '' ? null : $body[$key];
        if ($creating) {
            $employeeId = (string) ($body['employee_id'] ?? '');
            if (!$this->uuid($employeeId)) throw new HttpException('A valid employee is required.', 422);
            if (!isset($record['document_type_id']) || !ctype_digit((string) $record['document_type_id'])) throw new HttpException('A document type is required.', 422);
            $record['employee_id'] = $employeeId;
            $record['created_by'] = $actor['id'];
        }
        if (isset($record['document_type_id'])) $record['document_type_id'] = (int) $record['document_type_id'];
        if (isset($record['status']) && !in_array((string) $record['status'], ['missing','received','under_review','verified','rejected','expired','waived'], true)) throw new HttpException('Document status is invalid.', 422);
        foreach (['issued_on','expires_on'] as $date) if (isset($record[$date]) && $record[$date] !== null && !$this->date((string) $record[$date])) throw new HttpException(ucfirst(str_replace('_', ' ', $date)) . ' must be a valid date.', 422);
        if (isset($record['file_size_bytes']) && $record['file_size_bytes'] !== null && (!is_int($record['file_size_bytes']) && !ctype_digit((string) $record['file_size_bytes']))) throw new HttpException('File size is invalid.', 422);
        if (isset($record['file_size_bytes'])) $record['file_size_bytes'] = $record['file_size_bytes'] === null ? null : (int) $record['file_size_bytes'];
        if (isset($record['storage_path']) && $record['storage_path'] !== null && !preg_match('/^employees\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i', (string) $record['storage_path'])) throw new HttpException('Document storage path is invalid.', 422);
        if (($record['status'] ?? null) === 'rejected' && trim((string) ($record['rejection_reason'] ?? '')) === '') throw new HttpException('A rejection reason is required.', 422);
        $record['updated_by'] = $actor['id'];
        return $record;
    }

    private function uuid(string $value): bool { return (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value); }
    private function date(string $value): bool { $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value); return $date !== false && $date->format('Y-m-d') === $value; }
    private function positive(mixed $value, string $name): int { if (!is_int($value) && !ctype_digit((string) $value)) throw new HttpException("{$name} must be a positive integer.", 422); $number = (int) $value; if ($number < 1) throw new HttpException("{$name} must be a positive integer.", 422); return $number; }
    private function pageSize(mixed $value): int { $number = $this->positive($value, 'page_size'); if (!in_array($number, [25, 50, 100], true)) throw new HttpException('page_size must be 25, 50, or 100.', 422); return $number; }
}
