<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;
use Throwable;

/** Permission-checked API for configured hiring plans and live staffing totals. */
final class HiringPlanApi
{
    private function __construct(
        private readonly SupabaseClient $supabase,
        private readonly AuthenticatedActorResolver $auth,
    ) {}

    public static function fromEnvironment(): self
    {
        $url = rtrim((string) getenv('SUPABASE_URL'), '/');
        $key = (string) getenv('SUPABASE_SECRET_KEY');
        if (filter_var($url, FILTER_VALIDATE_URL) === false || $key === '' || !function_exists('curl_init')) {
            throw new RuntimeException('Server configuration is incomplete.');
        }
        $supabase = new SupabaseClient($url, $key);
        return new self($supabase, AuthenticatedActorResolver::fromEnvironment($supabase, $url));
    }

    public function dispatch(string $method, string $requestUri): never
    {
        $path = trim((string) parse_url($requestUri, PHP_URL_PATH), '/');
        $parts = explode('/', $path);
        if (array_slice($parts, 0, 2) !== ['api', 'hiring-plans'] && array_slice($parts, 0, 2) !== ['api', 'project-staffing']) {
            throw new HttpException('Route not found.', 404);
        }
        parse_str((string) parse_url($requestUri, PHP_URL_QUERY), $query);
        $body = $this->body();
        $actor = $this->auth->resolve();
        $route = array_slice($parts, 2);
        if ($parts[1] === 'hiring-plans') $result = $this->plans($method, $route, $body, $actor);
        else $result = $this->staffing($method, $route, $query, $actor);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['data' => $result], JSON_THROW_ON_ERROR);
        exit;
    }

    private function body(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') return [];
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($decoded)) throw new RuntimeException('JSON object expected.');
        return $decoded;
    }

    private function allow(array $actor, string $permission): void
    {
        if (($actor['is_super_admin'] ?? false) === true) return;
        $allowed = $this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', [
            'p_user_id' => $actor['id'], 'p_permission_key' => $permission,
        ]);
        if ($allowed !== true) throw new HttpException('You are not authorized for this action.', 403);
    }

    private function allowPlanRead(array $actor): void
    {
        if (($actor['is_super_admin'] ?? false) === true) return;
        foreach (['hiring_plans.view', 'hiring_plans.edit'] as $permission) {
            if ($this->supabase->service('POST', '/rest/v1/rpc/user_has_permission', [
                'p_user_id' => $actor['id'], 'p_permission_key' => $permission,
            ]) === true) return;
        }
        throw new HttpException('You are not authorized for this action.', 403);
    }

    private function plans(string $method, array $route, array $body, array $actor): array
    {
        if ($method === 'GET' && $route === ['options']) {
            $this->allowPlanRead($actor);
            $rows = $this->supabase->serviceBatch([
                ['method' => 'GET', 'path' => '/rest/v1/projects?select=id,name&is_active=eq.true&order=name'],
                ['method' => 'GET', 'path' => '/rest/v1/departments?select=id,name&is_active=eq.true&order=name'],
                ['method' => 'GET', 'path' => '/rest/v1/positions?select=id,name,position_code&is_active=eq.true&order=name'],
            ]);
            return $this->optionsResult($rows);
        }
        if ($method === 'GET' && $route === []) {
            $this->allowPlanRead($actor);
            return $this->supabase->service('GET', '/rest/v1/project_hiring_plans?select=*,project:projects(id,name),department:departments(id,name),position:positions(id,name,position_code)&order=project_id,department_id,position_id');
        }
        if ($method === 'POST' && $route === []) {
            $this->allow($actor, 'hiring_plans.edit');
            $record = $this->validatedPlan($body);
            $record['created_by'] = $actor['id'];
            $record['updated_by'] = $actor['id'];
            try {
                $created = $this->supabase->service('POST', '/rest/v1/project_hiring_plans', [$record], ['Prefer: return=representation']);
            } catch (Throwable $error) {
                $this->throwPlanConflict($error);
            }
            return $created[0] ?? [];
        }
        $id = $this->positiveInteger($route[0] ?? null, 'Plan ID');
        if ($method === 'GET' && ($route[1] ?? '') === 'history' && count($route) === 2) {
            $this->allowPlanRead($actor);
            return $this->supabase->service('GET', '/rest/v1/project_hiring_plan_audit?select=id,plan_id,actor_id,action,changed_at,before_state,after_state,actor:users!project_hiring_plan_audit_actor_id_fkey(full_name)&plan_id=eq.' . $id . '&order=changed_at.desc,id.desc');
        }
        if ($method === 'PATCH' && count($route) === 1) {
            $this->allow($actor, 'hiring_plans.edit');
            $record = $this->validatedPlan($body);
            $record['updated_by'] = $actor['id'];
            try {
                $updated = $this->supabase->service('PATCH', '/rest/v1/project_hiring_plans?id=eq.' . $id, $record, ['Prefer: return=representation']);
            } catch (Throwable $error) {
                $this->throwPlanConflict($error);
            }
            if (!isset($updated[0])) throw new HttpException('Hiring plan was not found.', 404);
            return $updated[0];
        }
        if ($method === 'DELETE' && count($route) === 1) {
            $this->allow($actor, 'hiring_plans.edit');
            $deleted = $this->supabase->service('POST', '/rest/v1/rpc/delete_project_hiring_plan', ['p_plan_id' => $id, 'p_actor_id' => $actor['id']]);
            if ($deleted !== true) throw new HttpException('Hiring plan was not found.', 404);
            return ['deleted' => true];
        }
        throw new HttpException('Route not found.', 404);
    }

    private function optionsResult(array $rows): array
    {
        return ['projects' => $rows[0] ?? [], 'departments' => $rows[1] ?? [], 'positions' => $rows[2] ?? []];
    }

    private function validatedPlan(array $body): array
    {
        $projectId = $this->positiveInteger($body['project_id'] ?? null, 'Project');
        $departmentId = $this->positiveInteger($body['department_id'] ?? null, 'Department');
        $positionId = $this->positiveInteger($body['position_id'] ?? null, 'Position');
        $planned = $this->plannedCount($body['planned_count'] ?? null);
        foreach ([['projects', $projectId, 'Project'], ['departments', $departmentId, 'Department'], ['positions', $positionId, 'Position']] as [$table, $id, $label]) {
            $rows = $this->supabase->service('GET', '/rest/v1/' . $table . '?select=id&id=eq.' . $id . '&is_active=eq.true&limit=1');
            if (!isset($rows[0])) throw new HttpException($label . ' does not exist or is inactive.', 422, 'inactive_plan_reference');
        }
        return ['project_id' => $projectId, 'department_id' => $departmentId, 'position_id' => $positionId, 'planned_count' => $planned];
    }

    private function plannedCount(mixed $value): int
    {
        if ((!is_int($value) && !(is_string($value) && ctype_digit($value))) || (int) $value < 0 || (int) $value > 2147483647) {
            throw new HttpException('Planned headcount must be a non-negative whole number.', 422);
        }
        return (int) $value;
    }

    private function staffing(string $method, array $route, array $query, array $actor): array
    {
        if ($method !== 'GET') throw new HttpException('Route not found.', 404);
        if ($route === ['options']) {
            $this->allow($actor, 'hiring_staffing.view');
            return $this->optionsResult($this->supabase->serviceBatch([
                ['method' => 'GET', 'path' => '/rest/v1/projects?select=id,name&is_active=eq.true&order=name'],
                ['method' => 'GET', 'path' => '/rest/v1/departments?select=id,name&is_active=eq.true&order=name'],
                ['method' => 'GET', 'path' => '/rest/v1/positions?select=id,name,position_code&is_active=eq.true&order=name'],
            ]));
        }
        $page = $this->positiveInteger($query['page'] ?? '1', 'Page');
        $pageSize = $this->positiveInteger($query['page_size'] ?? '25', 'Page size');
        if (!in_array($pageSize, [25, 50, 100], true)) throw new HttpException('Page size must be 25, 50, or 100.', 422);
        if (($route[0] ?? '') === 'review' && count($route) === 1) {
            $this->allow($actor, 'hiring_staffing.view');
            return $this->rpc('project_hiring_plan_assignment_review', [
                'p_page' => $page, 'p_page_size' => $pageSize, 'p_search' => trim((string) ($query['search'] ?? '')),
            ]);
        }
        if (($route[1] ?? '') === 'employees' && count($route) === 2) {
            $this->allow($actor, 'hiring_staffing.view');
            $id = $this->positiveInteger($route[0], 'Plan ID');
            return $this->rpc('project_hiring_plan_employees', ['p_plan_id' => $id, 'p_page' => $page, 'p_page_size' => $pageSize]);
        }
        if ($route !== []) throw new HttpException('Route not found.', 404);
        $this->allow($actor, 'hiring_staffing.view');
        $projectId = $this->optionalInteger($query['project'] ?? null, 'Project');
        $departmentId = $this->optionalInteger($query['department'] ?? null, 'Department');
        $positionId = $this->optionalInteger($query['position'] ?? null, 'Position');
        $status = (string) ($query['status'] ?? '');
        if ($status !== '' && !in_array($status, ['complete', 'under_plan', 'over_plan'], true)) throw new HttpException('Unsupported staffing status.', 422);
        return $this->rpc('project_hiring_plan_staffing', [
            'p_project_id' => $projectId, 'p_department_id' => $departmentId,
            'p_position_id' => $positionId, 'p_status' => $status,
            'p_search' => trim((string) ($query['search'] ?? '')),
            'p_page' => $page, 'p_page_size' => $pageSize,
        ]);
    }

    private function rpc(string $name, array $body): array
    {
        $result = $this->supabase->service('POST', '/rest/v1/rpc/' . $name, $body);
        if (!is_array($result)) throw new RuntimeException('Staffing response is invalid.');
        return $result;
    }

    private function positiveInteger(mixed $value, string $label): int
    {
        if ((!is_int($value) && !(is_string($value) && ctype_digit($value))) || (int) $value < 1) {
            throw new HttpException($label . ' must be a positive integer.', 422);
        }
        return (int) $value;
    }

    private function optionalInteger(mixed $value, string $label): ?int
    {
        return $value === null || $value === '' ? null : $this->positiveInteger($value, $label);
    }

    private function throwPlanConflict(Throwable $error): never
    {
        if ($error instanceof SupabaseRequestException && $error->status === 409) {
            throw new HttpException('A hiring plan already exists for this project, department, and position.', 409, 'hiring_plan_conflict');
        }
        throw $error;
    }
}
