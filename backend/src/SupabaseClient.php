<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;

final class SupabaseClient
{
    public function __construct(
        private readonly string $url,
        private readonly string $secretKey,
    ) {
    }

    public function service(string $method, string $path, ?array $payload = null, array $headers = []): mixed
    {
        return $this->request($method, $path, $this->secretKey, $payload, $headers);
    }

    public function authUser(string $accessToken): array
    {
        $user = $this->request('GET', '/auth/v1/user', $accessToken, null, ['apikey: ' . $this->secretKey]);
        if (!is_array($user)) {
            throw new RuntimeException('Invalid Auth response.');
        }
        return $user;
    }

    private function request(string $method, string $path, string $authorization, ?array $payload, array $headers): mixed
    {
        $curl = curl_init($this->url . $path);
        if ($curl === false) {
            throw new RuntimeException('Unable to initialize HTTP client.');
        }

        $requestHeaders = array_merge([
            'apikey: ' . $this->secretKey,
            'Authorization: Bearer ' . $authorization,
            'Accept: application/json',
        ], $headers);
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $requestHeaders,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
        ];
        if ($payload !== null) {
            $requestHeaders[] = 'Content-Type: application/json';
            $options[CURLOPT_HTTPHEADER] = $requestHeaders;
            $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_THROW_ON_ERROR);
        }
        curl_setopt_array($curl, $options);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        if ($body === false) {
            throw new RuntimeException('Supabase request failed.');
        }
        if ($status < 200 || $status >= 300) {
            throw new RuntimeException("Supabase request failed with HTTP {$status}.");
        }
        $decoded = $body === '' ? [] : json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        return $decoded;
    }
}
