<?php

declare(strict_types=1);

namespace Hms\Backend;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use RuntimeException;
use Throwable;

/** Resolves a verified Supabase JWT to the active HMS user record. */
final class AuthenticatedActorResolver
{
    public function __construct(
        private readonly SupabaseClient $supabase,
        private readonly string $issuer,
        private readonly string $jwksUrl,
        private readonly string $audience,
        private readonly int $jwksTtlSeconds,
        private readonly ?\Closure $jwksFetcher = null,
    ) {
    }

    public static function fromEnvironment(SupabaseClient $supabase, string $supabaseUrl): self
    {
        $url = rtrim($supabaseUrl, '/');
        $parts = parse_url($url);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || !isset($parts['host'])) {
            throw new RuntimeException('SUPABASE_URL must use HTTPS for JWT verification.');
        }

        $ttl = (int) (getenv('SUPABASE_JWKS_CACHE_TTL_SECONDS') ?: 300);
        $ttl = min(3600, max(60, $ttl));
        return new self(
            $supabase,
            $url . '/auth/v1',
            $url . '/auth/v1/.well-known/jwks.json',
            (string) (getenv('SUPABASE_JWT_AUDIENCE') ?: 'authenticated'),
            $ttl,
        );
    }

    /** @return array<string,mixed> */
    public function resolve(): array
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+([^\s]+)$/i', $header, $match)) {
            throw new HttpException('Authentication is required.', 401);
        }

        try {
            $subject = $this->verifiedSubject($match[1]);
        } catch (Throwable) {
            // Never disclose token parsing, key, or cryptographic failure details.
            throw new HttpException('Authentication token is invalid.', 401);
        }

        $users = $this->supabase->service(
            'GET',
            '/rest/v1/users?select=id,is_active,is_super_admin&auth_user_id=eq.' . rawurlencode($subject),
        );
        $user = $users[0] ?? null;
        if (!is_array($user) || ($user['is_active'] ?? false) !== true) {
            // Preserve the existing inactive/not-provisioned external behavior.
            throw new HttpException('User account is inactive or not provisioned.', 403);
        }
        return $user;
    }

    private function verifiedSubject(string $token): string
    {
        $header = $this->jwtHeader($token);
        if (($header['alg'] ?? null) !== 'ES256' || !is_string($header['kid'] ?? null) || $header['kid'] === '') {
            throw new RuntimeException('Unsupported JWT header.');
        }

        $keys = $this->jwksKeys(false);
        if (!isset($keys[$header['kid']])) {
            $keys = $this->jwksKeys(true);
        }
        if (!isset($keys[$header['kid']])) {
            throw new RuntimeException('JWT signing key is unknown.');
        }

        JWT::$leeway = 30;
        $claims = JWT::decode($token, $keys);
        if (($claims->iss ?? null) !== $this->issuer) {
            throw new RuntimeException('JWT issuer is invalid.');
        }
        if (!$this->hasAudience($claims->aud ?? null) || !isset($claims->exp) || !is_numeric($claims->exp)) {
            throw new RuntimeException('JWT claims are invalid.');
        }
        $subject = $claims->sub ?? null;
        if (!is_string($subject) || !$this->uuid($subject)) {
            throw new RuntimeException('JWT subject is invalid.');
        }
        return $subject;
    }

    /** @return array<string,mixed> */
    private function jwtHeader(string $token): array
    {
        $segments = explode('.', $token);
        if (count($segments) !== 3) {
            throw new RuntimeException('Malformed JWT.');
        }
        $encoded = strtr($segments[0], '-_', '+/');
        $encoded .= str_repeat('=', (4 - strlen($encoded) % 4) % 4);
        $json = base64_decode($encoded, true);
        $header = is_string($json) ? json_decode($json, true, 16, JSON_THROW_ON_ERROR) : null;
        if (!is_array($header)) {
            throw new RuntimeException('Malformed JWT header.');
        }
        return $header;
    }

    private function hasAudience(mixed $audience): bool
    {
        return is_string($audience)
            ? hash_equals($this->audience, $audience)
            : (is_array($audience) && in_array($this->audience, $audience, true));
    }

    /** @return array<string,\Firebase\JWT\Key> */
    private function jwksKeys(bool $refresh): array
    {
        $now = time();
        if (!$refresh && ($cached = $this->readCachedJwks($now)) !== null) {
            return $this->parseTrustedKeys($cached);
        }

        $lock = $this->jwksLock();
        if (!flock($lock, LOCK_EX)) {
            fclose($lock);
            throw new RuntimeException('Unable to lock JWKS cache.');
        }
        try {
            // Another PHP worker may have populated the cache while this one waited.
            if (!$refresh && ($cached = $this->readCachedJwks($now)) !== null) {
                return $this->parseTrustedKeys($cached);
            }
            $jwks = $this->jwksFetcher !== null
                ? ($this->jwksFetcher)($this->jwksUrl)
                : $this->fetchJwks();
            $keys = $this->parseTrustedKeys($jwks);
            $this->writeCachedJwks($jwks, $now + $this->jwksTtlSeconds);
            return $keys;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** @return array<string,\Firebase\JWT\Key> */
    private function parseTrustedKeys(mixed $jwks): array
    {
        if (!is_array($jwks) || !is_array($jwks['keys'] ?? null)) {
            throw new RuntimeException('JWKS response is invalid.');
        }
        $trusted = array_values(array_filter($jwks['keys'], static fn (mixed $key): bool => is_array($key)
            && ($key['kty'] ?? null) === 'EC'
            && ($key['crv'] ?? null) === 'P-256'
            && ($key['alg'] ?? null) === 'ES256'
            && (($key['use'] ?? 'sig') === 'sig')
            && is_string($key['kid'] ?? null)
            && $key['kid'] !== ''));
        return JWK::parseKeySet(['keys' => $trusted]);
    }

    /** @return array<string,mixed>|null */
    private function readCachedJwks(int $now): ?array
    {
        $contents = @file_get_contents($this->jwksCachePath());
        if (!is_string($contents)) {
            return null;
        }
        try {
            $cache = json_decode($contents, true, 32, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return null;
        }
        if (!is_array($cache) || !is_int($cache['expires_at'] ?? null) || $cache['expires_at'] <= $now || !is_array($cache['jwks'] ?? null)) {
            return null;
        }
        return $cache['jwks'];
    }

    private function writeCachedJwks(array $jwks, int $expiresAt): void
    {
        $directory = $this->jwksCacheDirectory();
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create JWKS cache directory.');
        }
        @chmod($directory, 0700);
        $temporary = tempnam($directory, 'jwks-');
        if ($temporary === false) {
            throw new RuntimeException('Unable to create JWKS cache file.');
        }
        try {
            $payload = json_encode(['expires_at' => $expiresAt, 'jwks' => $jwks], JSON_THROW_ON_ERROR);
            if (file_put_contents($temporary, $payload, LOCK_EX) === false) {
                throw new RuntimeException('Unable to write JWKS cache file.');
            }
            @chmod($temporary, 0600);
            if (!rename($temporary, $this->jwksCachePath())) {
                throw new RuntimeException('Unable to replace JWKS cache file.');
            }
        } finally {
            if (is_file($temporary)) {
                @unlink($temporary);
            }
        }
    }

    /** @return resource */
    private function jwksLock()
    {
        $directory = $this->jwksCacheDirectory();
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create JWKS cache directory.');
        }
        $lock = fopen($directory . DIRECTORY_SEPARATOR . 'jwks.lock', 'c+');
        if ($lock === false) {
            throw new RuntimeException('Unable to open JWKS cache lock.');
        }
        @chmod($directory . DIRECTORY_SEPARATOR . 'jwks.lock', 0600);
        return $lock;
    }

    private function jwksCacheDirectory(): string
    {
        return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'hms-jwks';
    }

    private function jwksCachePath(): string
    {
        return $this->jwksCacheDirectory() . DIRECTORY_SEPARATOR . hash('sha256', $this->jwksUrl) . '.json';
    }

    /** @return array<string,mixed> */
    private function fetchJwks(): array
    {
        $curl = curl_init($this->jwksUrl);
        if ($curl === false) {
            throw new RuntimeException('Unable to initialize JWKS client.');
        }
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        if (!is_string($body) || $status < 200 || $status >= 300) {
            throw new RuntimeException('JWKS request failed.');
        }
        $jwks = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($jwks)) {
            throw new RuntimeException('JWKS response is invalid.');
        }
        return $jwks;
    }

    private function uuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
