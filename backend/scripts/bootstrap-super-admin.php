<?php

declare(strict_types=1);

/**
 * One-time bootstrap utility for the initial HMS Super Admin.
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from the terminal.\n");
    exit(1);
}

function fail(string $message, int $exitCode = 1): never
{
    fwrite(STDERR, "Failed: {$message}\n");
    exit($exitCode);
}

function prompt(string $message): string
{
    fwrite(STDOUT, $message);
    $value = fgets(STDIN);

    if ($value === false) {
        fail('Unable to read terminal input.');
    }

    return trim($value);
}

function promptHidden(string $message): string
{
    if (function_exists('stream_isatty') && !stream_isatty(STDIN)) {
        fail('A terminal is required to securely enter the password.');
    }

    $state = trim((string) shell_exec('stty -g 2>/dev/null'));

    if ($state === '') {
        fail('Unable to configure secure password input.');
    }

    fwrite(STDOUT, $message);
    shell_exec('stty -echo');

    try {
        $value = fgets(STDIN);
    } finally {
        shell_exec('stty ' . escapeshellarg($state));
        fwrite(STDOUT, "\n");
    }

    if ($value === false) {
        fail('Unable to read password.');
    }

    return rtrim($value, "\r\n");
}

/**
 * @return array<string, mixed>
 */
function request(string $method, string $url, string $secretKey, ?array $payload = null): array
{
    $handle = curl_init($url);

    if ($handle === false) {
        throw new RuntimeException('Unable to initialize the HTTP client.');
    }

    $headers = [
        'apikey: ' . $secretKey,
        'Authorization: Bearer ' . $secretKey,
        'Accept: application/json',
    ];

    $options = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
    ];

    if ($payload !== null) {
        $json = json_encode($payload, JSON_THROW_ON_ERROR);
        $headers[] = 'Content-Type: application/json';
        $options[CURLOPT_HTTPHEADER] = $headers;
        $options[CURLOPT_POSTFIELDS] = $json;
    }

    curl_setopt_array($handle, $options);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($handle);

    if ($body === false) {
        throw new RuntimeException(
            'Supabase request failed: ' . ($curlError !== '' ? $curlError : 'unknown transport error')
        );
    }

    $decoded = $body === '' ? [] : json_decode($body, true);

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("Supabase request returned HTTP {$status}.");
    }

    return is_array($decoded) ? $decoded : [];
}

function isUuid(string $value): bool
{
    return preg_match(
        '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
        $value
    ) === 1;
}

$options = getopt('', ['email:', 'full-name:', 'help']);

if (isset($options['help'])) {
    fwrite(STDOUT, "Usage: php backend/scripts/bootstrap-super-admin.php --email EMAIL --full-name \"FULL NAME\"\n");
    exit(0);
}

$email = isset($options['email']) ? strtolower(trim((string) $options['email'])) : '';
$fullName = isset($options['full-name']) ? trim((string) $options['full-name']) : '';
$supabaseUrl = rtrim((string) getenv('SUPABASE_URL'), '/');
$secretKey = (string) getenv('SUPABASE_SECRET_KEY');

if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    fail('Provide a valid email with --email.');
}

if ($fullName === '') {
    fail('Provide a full name with --full-name.');
}

if (filter_var($supabaseUrl, FILTER_VALIDATE_URL) === false) {
    fail('SUPABASE_URL must be a valid URL.');
}

if ($secretKey === '') {
    fail('SUPABASE_SECRET_KEY is required.');
}

if (!function_exists('curl_init')) {
    fail('The PHP cURL extension is required.');
}

$password = promptHidden('Initial Super Admin password: ');
$passwordConfirmation = promptHidden('Confirm password: ');

if (strlen($password) < 12) {
    fail('Password must contain at least 12 characters.');
}

if (!hash_equals($password, $passwordConfirmation)) {
    fail('Passwords do not match.');
}

$confirmation = prompt('Type CREATE FIRST SUPER ADMIN to continue: ');

if ($confirmation !== 'CREATE FIRST SUPER ADMIN') {
    fwrite(STDOUT, "Cancelled. No remote changes were made.\n");
    exit(0);
}

try {
    $existing = request(
        'GET',
        $supabaseUrl . '/rest/v1/users?select=id&is_super_admin=eq.true&limit=1',
        $secretKey
    );
} catch (Throwable) {
    fail('Unable to check whether a Super Admin already exists.');
}

if ($existing !== []) {
    fail('A Super Admin already exists. No Auth user was created.');
}

try {
    $authResponse = request(
        'POST',
        $supabaseUrl . '/auth/v1/admin/users',
        $secretKey,
        [
            'email' => $email,
            'password' => $password,
            'email_confirm' => true,
            'user_metadata' => ['full_name' => $fullName],
        ]
    );
} catch (Throwable) {
    fail('Unable to create the Supabase Auth user.');
}

$authUser = isset($authResponse['user']) && is_array($authResponse['user'])
    ? $authResponse['user']
    : $authResponse;
$authUserId = isset($authUser['id']) && is_string($authUser['id']) ? $authUser['id'] : '';

if (!isUuid($authUserId)) {
    fail('Supabase Auth did not return a valid user ID.');
}

try {
    request(
        'POST',
        $supabaseUrl . '/rest/v1/rpc/bootstrap_first_super_admin',
        $secretKey,
        [
            'p_auth_user_id' => $authUserId,
            'p_full_name' => $fullName,
            'p_email' => $email,
        ]
    );
} catch (Throwable $exception) {
    $cleanupSucceeded = false;

    try {
        request(
            'DELETE',
            $supabaseUrl . '/auth/v1/admin/users/' . rawurlencode($authUserId) . '?should_soft_delete=false',
            $secretKey
        );
        $cleanupSucceeded = true;
    } catch (Throwable) {
        // The original bootstrap error is more useful; do not expose HTTP details.
    }

    $cleanupMessage = $cleanupSucceeded
        ? 'The newly created Auth user was deleted.'
        : 'The newly created Auth user could not be deleted; remove it manually using its Auth UUID.';

    fail('Database bootstrap failed. ' . $cleanupMessage);
}

fwrite(STDOUT, "Success: the initial Super Admin was created.\n");
