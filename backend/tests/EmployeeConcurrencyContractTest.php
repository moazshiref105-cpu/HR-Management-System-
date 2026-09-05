<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\EmployeeApi;
use Hms\Backend\HttpException;

$reflection = new ReflectionClass(EmployeeApi::class);
$api = $reflection->newInstanceWithoutConstructor();
$expectedUpdatedAt = new ReflectionMethod(EmployeeApi::class, 'expectedUpdatedAt');
$versionPath = new ReflectionMethod(EmployeeApi::class, 'employeeVersionPath');

$marker = '2026-09-05T10:48:15.614389+00:00';
if ($expectedUpdatedAt->invoke($api, $marker) !== $marker) {
    throw new RuntimeException('A valid concurrency marker was not preserved exactly.');
}

foreach ([null, '', '2026-09-05', 'not-a-timestamp', '2026-09-05T10:48:15Z '] as $invalid) {
    try {
        $expectedUpdatedAt->invoke($api, $invalid);
    } catch (Throwable) {
        continue;
    }
    throw new RuntimeException('An invalid concurrency marker was accepted.');
}

$path = $versionPath->invoke($api, '11111111-1111-4111-8111-111111111111', $marker);
if (!str_contains($path, 'updated_at=eq.' . rawurlencode($marker))) {
    throw new RuntimeException('Concurrency marker is not safely encoded in the database predicate.');
}

$conflict = new HttpException('Employee data has changed since you opened it.', 409, 'employee_conflict');
if ($conflict->status !== 409 || $conflict->errorCode !== 'employee_conflict') {
    throw new RuntimeException('Conflict error contract is not preserved.');
}

echo "Employee concurrency contract tests passed\n";
