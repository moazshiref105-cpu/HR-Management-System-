<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\SupabaseClient;

function requireContract(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$migration = file_get_contents(__DIR__ . '/../../supabase/migrations/20260910110000_phase5b_employee_private_realtime.sql');
$phase5a = file_get_contents(__DIR__ . '/../../supabase/migrations/20260906120000_phase5a_private_security_realtime.sql');
$client = file_get_contents(__DIR__ . '/../src/SupabaseClient.php');
$employeeApi = file_get_contents(__DIR__ . '/../src/EmployeeApi.php');
$frontend = file_get_contents(__DIR__ . '/../../frontend/src/Employees.jsx');
foreach ([$migration, $phase5a, $client, $employeeApi, $frontend] as $source) requireContract(is_string($source), 'Phase 5B source is unavailable.');

foreach ([
    'create function public.can_receive_employee_invalidations(p_topic text)',
    'security definer',
    'set search_path = pg_catalog, public, pg_temp',
    "p_topic ~ '^employee:",
    'auth.uid()',
    'u.is_active = true',
    "public.user_has_permission(u.id, 'employees.view')",
    'on realtime.messages for select to authenticated',
    "realtime.messages.extension = 'broadcast'",
    'realtime.topic()',
    'revoke all on function public.can_receive_employee_invalidations(text) from public',
    'revoke all on function public.can_receive_employee_invalidations(text) from anon',
] as $required) requireContract(str_contains(strtolower($migration), strtolower($required)), "Missing employee private-channel security contract: {$required}");

foreach (['for insert', 'grant insert', 'alter publication', 'replica identity', 'postgres_changes', 'grant select on table public.employees'] as $forbidden) {
    requireContract(!str_contains(strtolower($migration), strtolower($forbidden)), "Employee migration must not grant client sending or publish business data: {$forbidden}");
}
requireContract(str_contains($phase5a, 'hms_receive_own_security_invalidations'), 'Phase 5A own-security policy must remain available.');

$valid = '68bb9973-8fa6-47bd-a308-b295b609516a';
$topicPattern = '/^employee:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
requireContract(preg_match($topicPattern, "employee:{$valid}") === 1, 'A valid employee UUID topic must match the policy contract.');
foreach (['employee:', 'employee:not-a-uuid', "employee:{$valid}:extra", "employees:{$valid}", 'random-topic'] as $topic) {
    requireContract(preg_match($topicPattern, $topic) !== 1, "Malformed employee topic was accepted by the contract: {$topic}");
}
// The policy predicate requires all three conditions; this fixture evaluator makes that
// authorization truth table executable without requiring a local PostgreSQL runtime.
$canReceive = static fn (bool $authenticated, bool $active, bool $canView, string $topic): bool => $authenticated && $active && $canView && preg_match($topicPattern, $topic) === 1;
requireContract($canReceive(true, true, true, "employee:{$valid}"), 'Active employees.view user must be allowed.');
requireContract(!$canReceive(true, true, false, "employee:{$valid}"), 'User without employees.view must be denied.');
requireContract(!$canReceive(true, false, true, "employee:{$valid}"), 'Inactive user must be denied.');
requireContract(!$canReceive(false, true, true, "employee:{$valid}"), 'Anonymous user must be denied.');

foreach (['publishEmployeeInvalidation', "'employee_invalidated'", "['type' => 'employee_invalidated']", "'?private=true'"] as $required) {
    requireContract(str_contains($client, $required), "Missing employee publisher contract: {$required}");
}
foreach (['employee_update', 'employee_status', 'employee_contract_renewal', 'employee_notifications_refresh', "employee_' . \$resource . '_create", "employee_' . \$resource . '_update"] as $required) {
    requireContract(str_contains($employeeApi, $required), "Missing post-success employee invalidation hook: {$required}");
}
$createStart = strpos($employeeApi, 'private function create(');
$createEnd = strpos($employeeApi, 'private function update(');
requireContract($createStart !== false && $createEnd !== false && !str_contains(substr($employeeApi, $createStart, $createEnd - $createStart), 'publishEmployeeInvalidation'), 'Employee creation must not publish an unusable invalidation.');
requireContract(strpos($employeeApi, 'publishEmployeeInvalidationSafely($id, \'employee_update\')') > strpos($employeeApi, '$this->refreshNotificationsSafely($id);'), 'Core update must publish only after its durable update succeeds.');
requireContract(str_contains($employeeApi, "catch (\\Throwable) { error_log('HMS employee realtime broadcast failed operation=' . \$operation . ' employee_id=' . \$id); }"), 'Publisher failure must be best-effort and safely logged.');
$safeLogStart = strpos($employeeApi, 'private function publishEmployeeInvalidationSafely');
$safeLogEnd = strpos($employeeApi, 'private function refresh(', $safeLogStart);
requireContract($safeLogStart !== false && $safeLogEnd !== false, 'Best-effort publisher helper boundaries are unavailable.');
$safeLogHelper = substr($employeeApi, $safeLogStart, $safeLogEnd - $safeLogStart);
foreach (['arabic_full_name', 'identity_card_number', 'salary', 'bank_account_number', 'Authorization', 'SUPABASE_SECRET_KEY'] as $sensitive) requireContract(!str_contains($safeLogHelper, $sensitive), "Best-effort logging must not contain {$sensitive}.");

foreach ([
    'channel(`employee:${employeeId}`, { config: { private: true } })',
    '"broadcast", { event: "employee_invalidated" }',
    'supabase.removeChannel(channel)',
    'if (subscribed) invalidate()',
    'useEmployeeInvalidation(',
    'if (dirtyRef.current) {',
    'setStale(true);',
    'setBaseline(next)',
    'setVersion(latest.updated_at)',
    'setStale(false)',
    'expected_updated_at: version',
    'const [occConflict, setOccConflict] = useState(false);',
    '{stale && dirty && (',
    'Employee data changed on the server while you were editing.',
    'Refresh Latest',
    'load(false)',
    'const currentRequest = ++requestId.current;',
    'if (currentRequest === requestId.current) setEmployee(result);',
    'if (clear && currentRequest === requestId.current)',
    'requestId.current += 1;',
    'if (!active || refreshing.current) return;',
    'normalizeFormValue',
] as $required) requireContract(str_contains($frontend, $required), "Missing frontend employee realtime contract: {$required}");
requireContract(substr_count($frontend, 'useEmployeeInvalidation(') >= 3, 'Detail and edit screens must both use the shared employee invalidation hook.');
foreach (['postgres_changes', 'setForm(payload', 'setEmployee(payload', 'setVersion(payload'] as $forbidden) requireContract(!str_contains($frontend, $forbidden), "Realtime payload must not be employee-data authority: {$forbidden}");

// Deterministic mirror of the core-form normalization contract. This is behavioral
// coverage for the equivalence classes and structural coverage that the frontend uses
// the same named normalization helper; it is not a React runtime test.
$numeric = ['religion_id', 'marital_status_id', 'diploma_id', 'governorate_id', 'department_id', 'shift_type_id', 'team_id', 'position_id', 'project_id', 'bank_id'];
$normalize = static function (string $key, mixed $value) use ($numeric): mixed {
    if ($value === null || $value === '') return null;
    return in_array($key, $numeric, true) ? (int) $value : $value;
};
requireContract($normalize('major', null) === $normalize('major', ''), 'Optional null and empty-string values must be equivalent.');
requireContract($normalize('bank_id', '') === $normalize('bank_id', null), 'Optional empty select and null values must be equivalent.');
requireContract($normalize('major', 'meaningful') !== $normalize('major', ''), 'Meaningful text removal must remain dirty.');
requireContract($normalize('department_id', '7') === $normalize('department_id', 7), 'Numeric select string and number representations must be equivalent.');
requireContract($normalize('department_id', '7') !== $normalize('department_id', '8'), 'A real numeric change must remain dirty.');
requireContract($normalize('social_insurance_active', false) !== $normalize('social_insurance_active', ''), 'Boolean false and empty string must not be conflated.');

// Exercise the real publisher against an isolated local HTTP peer. No Supabase call is made.
$capture = tempnam(sys_get_temp_dir(), 'hms-phase5b-capture-');
$server = tempnam(sys_get_temp_dir(), 'hms-phase5b-server-');
requireContract($capture !== false && $server !== false, 'Unable to create Phase 5B test files.');
file_put_contents($server, <<<'PHP'
<?php
$listener = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
if ($listener === false) exit(1);
$address = stream_socket_get_name($listener, false);
fwrite(STDOUT, substr(strrchr($address, ':'), 1) . "\n"); fflush(STDOUT);
$connection = stream_socket_accept($listener, 5); if ($connection === false) exit(2);
$request = ''; while (!str_contains($request, "\r\n\r\n")) $request .= (string) fread($connection, 8192);
[$head, $body] = explode("\r\n\r\n", $request, 2); $lines = explode("\r\n", $head); $headers = [];
foreach (array_slice($lines, 1) as $line) { [$name] = explode(':', $line, 2); $headers[] = strtolower($name); }
$length = 0; foreach ($lines as $line) if (str_starts_with(strtolower($line), 'content-length:')) $length = (int) trim(substr($line, 15));
while (strlen($body) < $length) $body .= (string) fread($connection, 8192);
file_put_contents($argv[1], json_encode(['request_line' => $lines[0], 'headers' => $headers, 'body' => $body], JSON_THROW_ON_ERROR));
fwrite($connection, "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); fclose($connection); fclose($listener);
PHP);
$process = proc_open([PHP_BINARY, $server, $capture], [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes);
try {
    requireContract(is_resource($process), 'Unable to start local Phase 5B HTTP peer.');
    $port = trim((string) fgets($pipes[1])); requireContract(ctype_digit($port), 'Local Phase 5B HTTP peer did not start.');
    (new SupabaseClient("http://127.0.0.1:{$port}", 'test-server-only-secret'))->publishEmployeeInvalidation($valid);
    $recorded = json_decode((string) file_get_contents($capture), true, 512, JSON_THROW_ON_ERROR);
    requireContract(($recorded['request_line'] ?? null) === "POST /realtime/v1/api/broadcast/employee%3A{$valid}/events/employee_invalidated?private=true HTTP/1.1", 'Employee publisher request path, topic, event, private flag, or method is incorrect.');
    requireContract(($recorded['body'] ?? null) === '{"type":"employee_invalidated"}', 'Employee invalidation payload must be exactly opaque metadata.');
    foreach (['apikey', 'authorization', 'content-type'] as $header) requireContract(in_array($header, $recorded['headers'] ?? [], true), "Missing required safe publisher header: {$header}");
    try { (new SupabaseClient('http://127.0.0.1:1', 'test-server-only-secret'))->publishEmployeeInvalidation('not-a-uuid'); throw new RuntimeException('Malformed UUID reached the network path.'); }
    catch (RuntimeException $exception) { requireContract($exception->getMessage() === 'Invalid employee invalidation target.', 'Malformed UUID must fail before the HTTP request.'); }
} finally {
    if (isset($pipes) && is_array($pipes)) foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
    if (isset($process) && is_resource($process)) proc_terminate($process);
    if ($capture !== false && file_exists($capture)) unlink($capture);
    if ($server !== false && file_exists($server)) unlink($server);
}

echo "Employee Realtime security contract tests passed\n";
