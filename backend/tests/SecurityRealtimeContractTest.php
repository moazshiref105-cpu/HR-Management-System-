<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\SupabaseClient;

$migration = file_get_contents(__DIR__ . '/../../supabase/migrations/20260906120000_phase5a_private_security_realtime.sql');
if (!is_string($migration)) throw new RuntimeException('Phase 5A migration is unavailable.');

foreach ([
    'on realtime.messages',
    'for select',
    'to authenticated',
    "realtime.messages.extension = 'broadcast'",
    'realtime.topic()',
    "'user-security:'",
    'auth.uid()',
] as $required) {
    if (!str_contains(strtolower($migration), strtolower($required))) throw new RuntimeException("Missing private-channel authorization contract: {$required}");
}
foreach (['alter publication', 'replica identity', 'public.users', 'public.roles', 'public.permissions', 'public.user_roles'] as $forbidden) {
    if (str_contains(strtolower($migration), strtolower($forbidden))) throw new RuntimeException("Phase 5A migration must not alter business-table Realtime: {$forbidden}");
}

$client = file_get_contents(__DIR__ . '/../src/SupabaseClient.php');
$setup = file_get_contents(__DIR__ . '/../src/SetupApi.php');
$app = file_get_contents(__DIR__ . '/../../frontend/src/App.jsx');
$auth = file_get_contents(__DIR__ . '/../../frontend/src/auth.js');
foreach ([$client, $setup, $app, $auth] as $source) if (!is_string($source)) throw new RuntimeException('Phase 5A source is unavailable.');

foreach ([
    'publishPrivateBroadcast',
    "'/realtime/v1/api/broadcast/'",
    "'?private=true'",
    "'security_invalidated'",
] as $required) {
    if (!str_contains($client, $required)) throw new RuntimeException("Missing secure Broadcast transport contract: {$required}");
}
foreach ([
    'publishRoleSecurityInvalidations',
    'publishSecurityInvalidation($authUserId, \'user_roles\')',
    'publishSecurityInvalidation($authUserId, \'user_status\')',
    "['type' => 'security_invalidated']",
    'HMS security realtime broadcast failed operation=',
] as $required) {
    if (!str_contains($setup, $required)) throw new RuntimeException("Missing backend security invalidation contract: {$required}");
}
if (strpos($setup, '$result = $this->replaceRelations') === false || strpos($setup, 'publishRoleSecurityInvalidations') < strpos($setup, '$result = $this->replaceRelations')) {
    throw new RuntimeException('Role permission invalidation must publish only after the replacement succeeds.');
}
if (str_contains($setup, 'publishSecurityInvalidation($authUserId, \'user_profile\')')) {
    throw new RuntimeException('Profile-only user updates must not publish security invalidations.');
}
$createStart = strpos($setup, 'private function createUser');
$createEnd = strpos($setup, 'private function validatedCreateRoleIds');
if ($createStart === false || $createEnd === false || str_contains(substr($setup, $createStart, $createEnd - $createStart), 'publishSecurityInvalidation')) {
    throw new RuntimeException('User creation must not publish a security invalidation.');
}

foreach ([
    'channel(`user-security:${session.user.id}`, { config: { private: true } })',
    '"broadcast", { event: "security_invalidated" }',
    'invalidateCapabilitiesCache()',
    'capabilitiesApi.get(session.access_token)',
    'error?.status === 403',
    'onLogout()',
    'supabase.removeChannel(channel)',
] as $required) {
    if (!str_contains($app, $required)) throw new RuntimeException("Missing frontend security channel contract: {$required}");
}
foreach (['postgres_changes', '.channel(`users', '.channel(`roles', '.channel(`permissions', 'SUPABASE_SECRET_KEY'] as $forbidden) {
    if (str_contains($app, $forbidden) || str_contains($auth, $forbidden)) throw new RuntimeException("Frontend must not expose direct business-table Realtime: {$forbidden}");
}

// Exercise the real private-publisher path against an isolated local HTTP peer.
// This detects argument-count regressions without making a Supabase network call.
$capture = tempnam(sys_get_temp_dir(), 'hms-phase5a-capture-');
$server = tempnam(sys_get_temp_dir(), 'hms-phase5a-server-');
if ($capture === false || $server === false) throw new RuntimeException('Unable to create Phase 5A test files.');
file_put_contents($server, <<<'PHP'
<?php
$listener = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
if ($listener === false) exit(1);
$address = stream_socket_get_name($listener, false);
fwrite(STDOUT, substr(strrchr($address, ':'), 1) . "\n");
fflush(STDOUT);
$connection = stream_socket_accept($listener, 5);
if ($connection === false) exit(2);
$request = '';
while (!str_contains($request, "\r\n\r\n")) $request .= (string) fread($connection, 8192);
[$head, $body] = explode("\r\n\r\n", $request, 2);
$lines = explode("\r\n", $head);
$headers = [];
foreach (array_slice($lines, 1) as $line) {
    [$name] = explode(':', $line, 2);
    $headers[] = strtolower($name);
}
$contentLength = 0;
foreach (explode("\r\n", $head) as $line) if (str_starts_with(strtolower($line), 'content-length:')) $contentLength = (int) trim(substr($line, 15));
while (strlen($body) < $contentLength) $body .= (string) fread($connection, 8192);
file_put_contents($argv[1], json_encode(['request_line' => $lines[0], 'headers' => $headers, 'body' => $body], JSON_THROW_ON_ERROR));
fwrite($connection, "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
fclose($connection);
fclose($listener);
PHP);
$process = proc_open([PHP_BINARY, $server, $capture], [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes);
try {
    if (!is_resource($process)) throw new RuntimeException('Unable to start local Phase 5A HTTP peer.');
    $port = trim((string) fgets($pipes[1]));
    if (!ctype_digit($port)) throw new RuntimeException('Local Phase 5A HTTP peer did not start.');
    (new SupabaseClient('http://127.0.0.1:' . $port, 'test-server-only-secret'))->publishPrivateBroadcast(
        'user-security:68bb9973-8fa6-47bd-a308-b295b609516a',
        'security_invalidated',
        ['type' => 'security_invalidated'],
    );
    $recorded = json_decode((string) file_get_contents($capture), true, 512, JSON_THROW_ON_ERROR);
    if (($recorded['request_line'] ?? null) !== 'POST /realtime/v1/api/broadcast/user-security%3A68bb9973-8fa6-47bd-a308-b295b609516a/events/security_invalidated?private=true HTTP/1.1') throw new RuntimeException('Private Broadcast request path or method is incorrect.');
    if (($recorded['body'] ?? null) !== '{"type":"security_invalidated"}') throw new RuntimeException('Private Broadcast payload is incorrect.');
    if (!in_array('apikey', $recorded['headers'] ?? [], true) || !in_array('authorization', $recorded['headers'] ?? [], true) || !in_array('content-type', $recorded['headers'] ?? [], true)) throw new RuntimeException('Private Broadcast headers are incomplete.');
} finally {
    if (isset($pipes) && is_array($pipes)) foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
    if (isset($process) && is_resource($process)) proc_terminate($process);
    if ($capture !== false && file_exists($capture)) unlink($capture);
    if ($server !== false && file_exists($server)) unlink($server);
}

echo "Security Realtime contract tests passed\n";
