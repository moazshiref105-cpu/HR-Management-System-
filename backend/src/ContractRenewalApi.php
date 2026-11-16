<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;
use Throwable;

/** Operational contract-renewal tracker. Completed renewals remain owned by renew_employee_contract. */
final class ContractRenewalApi
{
    private function __construct(private readonly SupabaseClient $supabase, private readonly AuthenticatedActorResolver $auth) {}

    public static function fromEnvironment(): self
    {
        $url = rtrim((string) getenv('SUPABASE_URL'), '/');
        $key = (string) getenv('SUPABASE_SECRET_KEY');
        if (filter_var($url, FILTER_VALIDATE_URL) === false || $key === '' || !function_exists('curl_init')) throw new RuntimeException('Server configuration is incomplete.');
        $supabase = new SupabaseClient($url, $key);
        return new self($supabase, AuthenticatedActorResolver::fromEnvironment($supabase, $url));
    }

    public function dispatch(string $method, string $requestUri): never
    {
        $path = trim((string) parse_url($requestUri, PHP_URL_PATH), '/');
        $parts = $path === '' ? [] : explode('/', $path);
        if (array_slice($parts, 0, 3) !== ['api', 'contracts', 'renewals']) throw new HttpException('Route not found.', 404);
        parse_str((string) parse_url($requestUri, PHP_URL_QUERY), $query);
        $body = $this->body();
        $actor = $this->auth->resolve();
        $route = array_slice($parts, 3);
        if ($route === [] && $method === 'GET') $result = $this->lists($actor);
        elseif ($route === [] && $method === 'POST') $result = $this->create($body, $actor);
        elseif (count($route) === 1 && $method === 'GET') $result = $this->items((string) $route[0], $query, $actor);
        elseif (($route[1] ?? '') === 'receipts' && $method === 'POST') $result = $this->receipts((string) ($route[0] ?? ''), $body, $actor);
        else throw new HttpException('Route not found.', 404);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['data' => $result], JSON_THROW_ON_ERROR);
        exit;
    }

    private function body(): array { $raw = file_get_contents('php://input'); if ($raw === false || $raw === '') return []; $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR); if (!is_array($body)) throw new RuntimeException('JSON object expected.'); return $body; }
    private function allow(array $actor, string $permission): void { if (($actor['is_super_admin'] ?? false) === true) return; if ($this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', ['p_user_id' => $actor['id'], 'p_permission_key' => $permission]) !== true) throw new HttpException('You are not authorized for this action.', 403); }
    private function uuid(string $id): bool { return (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id); }
    private function pageSize(mixed $value): int { $number = (int) $value; if (!in_array($number, [25, 50, 100], true)) throw new HttpException('page_size must be 25, 50, or 100.', 422); return $number; }

    private function lists(array $actor): array
    {
        $this->allow($actor, 'employees.view');
        $rows = $this->supabase->service('GET', '/rest/v1/contract_renewal_lists?select=id,due_period,name,created_at&order=due_period.desc');
        return is_array($rows) ? $rows : [];
    }

    private function create(array $body, array $actor): array
    {
        $this->allow($actor, 'employees.work.edit');
        $period = (string) ($body['due_period'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $period)) throw new HttpException('A valid renewal due month is required.', 422);
        $id = $this->supabase->service('POST', '/rest/v1/rpc/create_contract_renewal_list', ['p_due_period' => $period, 'p_name' => (string) ($body['name'] ?? ''), 'p_actor_id' => $actor['id']]);
        return ['id' => $id];
    }

    private function items(string $listId, array $query, array $actor): array
    {
        $this->allow($actor, 'employees.view');
        if (!$this->uuid($listId)) throw new HttpException('Renewal list not found.', 404);
        $status = (string) ($query['status'] ?? 'all');
        if (!in_array($status, ['all', 'waiting_documents', 'waiting_contract', 'waiting_application', 'needs_review', 'overdue', 'complete'], true)) throw new HttpException('Unsupported renewal status.', 422);
        $list = $this->supabase->service('GET', '/rest/v1/contract_renewal_lists?select=id,name,due_period&id=eq.' . rawurlencode($listId) . '&limit=1');
        if (!isset($list[0])) throw new HttpException('Renewal list not found.', 404);
        // Read directly from the persisted tracker table. This intentionally
        // avoids a PostgREST RPC schema-cache dependency for a non-mutating
        // list read; receipt/finalization remains server-side RPC-only.
        $rows = $this->supabase->service('GET', '/rest/v1/contract_renewal_list_items?select=id,employee_id,employee_number,employee_name_ar,employee_name_en,department_name,position_name,original_due_date,original_contract_signing_date,signed_contract_received_at,renewal_application_received_at,finalized_at,finalization_error&list_id=eq.' . rawurlencode($listId) . '&order=original_due_date.asc,employee_number.asc');
        $search = strtolower(trim((string) ($query['search'] ?? '')));
        $today = date('Y-m-d');
        $mapped = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $complete = $row['finalized_at'] !== null;
            $hasSignedContract = $row['signed_contract_received_at'] !== null;
            $hasApplication = $row['renewal_application_received_at'] !== null;
            $hasFinalizationError = trim((string) ($row['finalization_error'] ?? '')) !== '';
            // Completion, receipt progress, and urgency are independent. A
            // fully received pair must never appear as a missing document.
            $documentState = match (true) {
                $complete => 'complete',
                $hasSignedContract && $hasApplication && $hasFinalizationError => 'needs_review',
                $hasSignedContract && $hasApplication => 'ready_to_finalize',
                !$hasSignedContract && !$hasApplication => 'waiting_documents',
                !$hasSignedContract => 'waiting_contract',
                default => 'waiting_application',
            };
            $overdue = !$complete && (string) $row['original_due_date'] < $today;
            $haystack = strtolower(implode(' ', [(string) $row['employee_number'], (string) $row['employee_name_ar'], (string) $row['employee_name_en']]));
            $matchesStatus = match ($status) {
                'all' => true,
                'waiting_documents' => $row['signed_contract_received_at'] === null && $row['renewal_application_received_at'] === null,
                'waiting_contract' => !$complete && $row['signed_contract_received_at'] === null,
                'waiting_application' => !$complete && $row['renewal_application_received_at'] === null,
                'needs_review' => $documentState === 'needs_review',
                'overdue' => $overdue,
                'complete' => $complete,
            };
            if (!$matchesStatus) continue;
            if ($search !== '' && !str_contains($haystack, $search)) continue;
            $row['status'] = $documentState;
            $row['is_overdue'] = $overdue;
            $row['finalization_error_message'] = $documentState === 'needs_review'
                ? $this->finalizationErrorMessage((string) $row['finalization_error'])
                : null;
            unset($row['finalization_error']);
            $mapped[] = $row;
        }
        $page = max(1, (int) ($query['page'] ?? 1));
        $pageSize = $this->pageSize($query['page_size'] ?? 25);
        $total = count($mapped);
        return ['list' => $list[0], 'rows' => array_slice($mapped, ($page - 1) * $pageSize, $pageSize), 'total' => $total, 'page' => $page, 'page_size' => $pageSize, 'total_pages' => $total === 0 ? 0 : (int) ceil($total / $pageSize)];
    }

    /** Converts known finalization conflicts into safe, actionable HR copy. */
    private function finalizationErrorMessage(string $error): string
    {
        $normalized = strtolower($error);
        if (str_contains($normalized, 'renewal signing date must be after the current contract signing date')) {
            return 'The employee already has a newer contract signing date. Review contract history before retrying.';
        }
        if (str_contains($normalized, 'contract renewal already exists for this date')) {
            return 'A renewal for this contract cycle already exists. Review contract history before retrying.';
        }
        if (str_contains($normalized, 'only active employees can renew a contract')) {
            return 'Only active employees can have a contract renewal finalized.';
        }
        return 'The renewal could not be finalized. Review the employee contract record and retry.';
    }

    private function receipts(string $listId, array $body, array $actor): array
    {
        $this->allow($actor, 'employees.work.edit');
        if (!$this->uuid($listId)) throw new HttpException('Renewal list not found.', 404);
        $ids = $body['item_ids'] ?? [];
        if (!is_array($ids) || $ids === [] || array_filter($ids, fn ($id) => !is_string($id) || !$this->uuid($id))) throw new HttpException('Select valid renewal items.', 422);
        $receipt = (string) ($body['receipt'] ?? '');
        if (!in_array($receipt, ['signed_contract', 'renewal_application', 'retry_finalization'], true)) throw new HttpException('Unsupported receipt type.', 422);
        $encoded = implode(',', array_map('rawurlencode', $ids));
        $items = $this->supabase->service('GET', '/rest/v1/contract_renewal_list_items?select=employee_id&id=in.(' . $encoded . ')&list_id=eq.' . rawurlencode($listId));
        $result = $this->supabase->service('POST', '/rest/v1/rpc/record_contract_renewal_receipts', ['p_item_ids' => array_values($ids), 'p_receipt' => $receipt, 'p_actor_id' => $actor['id']]);
        foreach ($items as $item) {
            if (!isset($item['employee_id'])) continue;
            try {
                $this->supabase->service('POST', '/rest/v1/rpc/refresh_employee_notifications', ['p_employee_id' => $item['employee_id'], 'p_as_of' => date('Y-m-d')]);
                $this->supabase->publishEmployeeInvalidation((string) $item['employee_id']);
            } catch (Throwable) { /* An invalidation failure must not undo recorded receipts. */ }
        }
        return ['items' => $result];
    }
}
