<?php

declare(strict_types=1);

$source = file_get_contents(__DIR__ . '/../src/AuthenticatedActorResolver.php');
if (!is_string($source)) throw new RuntimeException('Authenticated actor resolver source is unavailable.');
if (str_contains($source, 'curl_close(')) throw new RuntimeException('JWKS cleanup still calls deprecated curl_close().');

$warnings = [];
set_error_handler(static function (int $severity, string $message) use (&$warnings): bool {
    $warnings[] = [$severity, $message];
    return true;
});
$handle = curl_init('https://example.invalid');
unset($handle);
restore_error_handler();
if ($warnings !== []) throw new RuntimeException('Automatic CurlHandle cleanup emitted output.');

echo "Curl cleanup contract tests passed\n";
