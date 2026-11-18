<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

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
use Hms\Backend\DocumentApi;
use Hms\Backend\ContractRenewalApi;
use Hms\Backend\SocialInsuranceApi;
use Hms\Backend\HiringPlanApi;
use Hms\Backend\ImportExportApi;
use Hms\Backend\HttpException;

try {
    $path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
    if ($path === 'api/dashboard' || str_starts_with($path, 'api/dashboard/')) {
        header('Cache-Control: no-store');
    }
    if (str_starts_with($path, 'api/dashboard')) $api = DashboardApi::fromEnvironment();
    elseif (str_starts_with($path, 'api/employees')) $api = EmployeeApi::fromEnvironment();
    elseif (str_starts_with($path, 'api/social-insurance')) $api = SocialInsuranceApi::fromEnvironment();
    elseif (str_starts_with($path, 'api/documents')) $api = DocumentApi::fromEnvironment();
    elseif (str_starts_with($path, 'api/contracts/renewals')) $api = ContractRenewalApi::fromEnvironment();
    elseif (str_starts_with($path, 'api/hiring-plans') || str_starts_with($path, 'api/project-staffing')) $api = HiringPlanApi::fromEnvironment();
    elseif (str_starts_with($path, 'api/import-export')) $api = ImportExportApi::fromEnvironment();
    else $api = SetupApi::fromEnvironment();
    $api->dispatch($_SERVER['REQUEST_METHOD'] ?? 'GET', $_SERVER['REQUEST_URI'] ?? '/');
} catch (Throwable $exception) {
    $status = $exception instanceof HttpException ? $exception->status : ($exception instanceof RuntimeException ? 400 : 500);
    if ($status >= 500) {
        error_log(sprintf(
            'HMS API failure: %s at %s:%d on %s %s',
            get_class($exception),
            $exception->getFile(),
            $exception->getLine(),
            $_SERVER['REQUEST_METHOD'] ?? 'UNKNOWN',
            parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/',
        ));
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    $message = $status === 500 ? 'Internal server error' : $exception->getMessage();
    $error = $exception instanceof HttpException && $exception->errorCode !== null
        ? ['code' => $exception->errorCode, 'message' => $message]
        : $message;
    echo json_encode(['error' => $error]);
}
