<?php

declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'Hms\\Backend\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $path = __DIR__ . '/../src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

use Hms\Backend\SetupApi;
use Hms\Backend\EmployeeApi;
use Hms\Backend\DashboardApi;
use Hms\Backend\HttpException;

try {
    $path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
    $api = str_starts_with($path, 'api/dashboard') ? DashboardApi::fromEnvironment() : (str_starts_with($path, 'api/employees') ? EmployeeApi::fromEnvironment() : SetupApi::fromEnvironment());
    $api->dispatch($_SERVER['REQUEST_METHOD'] ?? 'GET', $_SERVER['REQUEST_URI'] ?? '/');
} catch (Throwable $exception) {
    $status = $exception instanceof HttpException ? $exception->status : ($exception instanceof RuntimeException ? 400 : 500);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $status === 500 ? 'Internal server error' : $exception->getMessage()]);
}
