<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Firebase\JWT\JWT;
use Hms\Backend\AuthenticatedActorResolver;
use Hms\Backend\SupabaseClient;

if (($argv[1] ?? null) === '--cache-child') {
    $fixture = json_decode((string) file_get_contents((string) ($argv[2] ?? '')), true, 32, JSON_THROW_ON_ERROR);
    $resolver = new AuthenticatedActorResolver(
        new SupabaseClient('https://example.test', 'test'),
        'https://project.supabase.co/auth/v1',
        $fixture['url'],
        'authenticated',
        300,
        static function () use ($fixture): array {
            file_put_contents($fixture['counter'], "1\n", FILE_APPEND | LOCK_EX);
            return $fixture['jwks'];
        },
    );
    $method = new ReflectionMethod($resolver, 'jwksKeys');
    $method->invoke($resolver, false);
    exit(0);
}

function base64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function expectFailure(ReflectionMethod $verify, AuthenticatedActorResolver $resolver, string $token, string $name): void
{
    try {
        $verify->invoke($resolver, $token);
    } catch (Throwable) {
        return;
    }
    throw new RuntimeException("Expected {$name} to fail.");
}

$key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
if ($key === false || !openssl_pkey_export($key, $privateKey)) {
    throw new RuntimeException('Unable to create test signing key.');
}
$details = openssl_pkey_get_details($key);
if (!is_array($details) || !isset($details['ec']['x'], $details['ec']['y'])) {
    throw new RuntimeException('Unable to read test signing key.');
}
$kid = 'test-key';
$jwks = ['keys' => [[
    'kid' => $kid, 'kty' => 'EC', 'crv' => 'P-256', 'alg' => 'ES256', 'use' => 'sig',
    'x' => base64url($details['ec']['x']), 'y' => base64url($details['ec']['y']),
]]];
$fetches = 0;
$resolver = new AuthenticatedActorResolver(
    new SupabaseClient('https://example.test', 'test'),
    'https://project.supabase.co/auth/v1',
    'https://jwks-test.invalid/' . bin2hex(random_bytes(8)),
    'authenticated',
    300,
    static function () use (&$fetches, $jwks): array { ++$fetches; return $jwks; },
);
$verify = new ReflectionMethod($resolver, 'verifiedSubject');
$now = time();
$claims = ['iss' => 'https://project.supabase.co/auth/v1', 'aud' => 'authenticated', 'sub' => '11111111-1111-4111-8111-111111111111', 'iat' => $now - 1, 'nbf' => $now - 1, 'exp' => $now + 60];
$valid = JWT::encode($claims, $privateKey, 'ES256', $kid);
if ($verify->invoke($resolver, $valid) !== $claims['sub']) {
    throw new RuntimeException('Valid JWT was not accepted.');
}

expectFailure($verify, $resolver, 'not-a-jwt', 'malformed token');
$segments = explode('.', $valid);
$payload = json_decode(base64_decode(strtr($segments[1], '-_', '+/')), true, 16, JSON_THROW_ON_ERROR);
$payload['sub'] = '22222222-2222-4222-8222-222222222222';
$segments[1] = base64url(json_encode($payload, JSON_THROW_ON_ERROR));
expectFailure($verify, $resolver, implode('.', $segments), 'modified payload');
$signatureSegments = explode('.', $valid);
$signatureSegments[2][0] = $signatureSegments[2][0] === 'A' ? 'B' : 'A';
expectFailure($verify, $resolver, implode('.', $signatureSegments), 'modified signature');
$noneHeader = base64url(json_encode(['typ' => 'JWT', 'alg' => 'none', 'kid' => $kid], JSON_THROW_ON_ERROR));
expectFailure($verify, $resolver, $noneHeader . '.' . explode('.', $valid)[1] . '.', 'alg none');

$expired = JWT::encode([...$claims, 'exp' => $now - 31], $privateKey, 'ES256', $kid);
expectFailure($verify, $resolver, $expired, 'expired token');
expectFailure($verify, $resolver, JWT::encode([...$claims, 'nbf' => $now + 31], $privateKey, 'ES256', $kid), 'not-before token');
expectFailure($verify, $resolver, JWT::encode([...$claims, 'iss' => 'https://wrong.example/auth/v1'], $privateKey, 'ES256', $kid), 'wrong issuer');
expectFailure($verify, $resolver, JWT::encode([...$claims, 'aud' => 'wrong'], $privateKey, 'ES256', $kid), 'wrong audience');
expectFailure($verify, $resolver, JWT::encode($claims, $privateKey, 'ES256', 'unknown-kid'), 'unknown kid');
if ($fetches !== 2) {
    throw new RuntimeException('Unknown kid did not refresh JWKS exactly once.');
}

$cacheId = bin2hex(random_bytes(8));
$fixturePath = sys_get_temp_dir() . '/hms-jwks-cache-fixture-' . $cacheId . '.json';
$counterPath = sys_get_temp_dir() . '/hms-jwks-cache-counter-' . $cacheId;
$cacheUrl = 'https://jwks-cache-test.invalid/' . $cacheId;
file_put_contents($fixturePath, json_encode(['url' => $cacheUrl, 'counter' => $counterPath, 'jwks' => $jwks], JSON_THROW_ON_ERROR));
try {
    foreach ([1, 2] as $_) {
        $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --cache-child ' . escapeshellarg($fixturePath);
        exec($command, $output, $status);
        if ($status !== 0) {
            throw new RuntimeException('Cross-process JWKS cache child failed.');
        }
    }
    $crossProcessFetches = is_file($counterPath) ? count(file($counterPath, FILE_IGNORE_NEW_LINES)) : 0;
    if ($crossProcessFetches !== 1) {
        throw new RuntimeException('JWKS cache did not persist across separate PHP processes.');
    }
} finally {
    @unlink($fixturePath);
    @unlink($counterPath);
    @unlink(sys_get_temp_dir() . '/hms-jwks/' . hash('sha256', $cacheUrl) . '.json');
}

echo "JWT verifier tests passed\n";
