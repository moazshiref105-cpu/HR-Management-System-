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

    /**
     * Runs controlled service-role requests concurrently. Callers provide only
     * internally constructed method/path/payload tuples; this is not exposed to
     * client input.
     *
     * @param list<array{method:string,path:string,payload?:array|null,headers?:array}> $requests
     * @return list<mixed>
     */
    public function serviceBatch(array $requests): array
    {
        if ($requests === []) {
            return [];
        }

        $multi = curl_multi_init();
        if ($multi === false) {
            throw new RuntimeException('Unable to initialize HTTP client.');
        }

        $handles = [];
        try {
            foreach ($requests as $index => $request) {
                $handle = $this->createHandle(
                    $request['method'],
                    $request['path'],
                    $this->secretKey,
                    $request['payload'] ?? null,
                    $request['headers'] ?? [],
                );
                $handles[$index] = $handle;
                curl_multi_add_handle($multi, $handle);
            }

            do {
                $status = curl_multi_exec($multi, $running);
                if ($status !== CURLM_OK) {
                    throw new RuntimeException('Supabase request failed.');
                }
                if ($running > 0) {
                    curl_multi_select($multi, 1.0);
                }
            } while ($running > 0);

            $results = [];
            foreach ($handles as $index => $handle) {
                $body = curl_multi_getcontent($handle);
                $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
                if ($body === false || $status < 200 || $status >= 300) {
                    throw new RuntimeException("Supabase request failed with HTTP {$status}.");
                }
                $results[$index] = $body === '' ? [] : json_decode($body, true, 512, JSON_THROW_ON_ERROR);
            }
            ksort($results);
            return array_values($results);
        } finally {
            foreach ($handles as $handle) {
                curl_multi_remove_handle($multi, $handle);
            }
            curl_multi_close($multi);
        }
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
        $curl = $this->createHandle($method, $path, $authorization, $payload, $headers);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        if ($body === false) {
            throw new RuntimeException('Supabase request failed.');
        }
        if ($status < 200 || $status >= 300) {
            throw new RuntimeException("Supabase request failed with HTTP {$status}.");
        }
        return $body === '' ? [] : json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    }

    private function createHandle(string $method, string $path, string $authorization, ?array $payload, array $headers): \CurlHandle
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
        return $curl;
    }
}
