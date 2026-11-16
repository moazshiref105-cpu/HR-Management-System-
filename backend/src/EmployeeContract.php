<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;

/** Shared employee status/classification contract loaded from the repository JSON. */
final class EmployeeContract
{
    private static ?array $contract = null;

    private static function values(): array
    {
        if (self::$contract !== null) return self::$contract;
        $path = dirname(__DIR__, 2) . '/shared/employee-contract.json';
        $json = is_file($path) ? file_get_contents($path) : false;
        $contract = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($contract) || !is_array($contract['employee_statuses'] ?? null) || !is_array($contract['employee_classifications'] ?? null)) {
            throw new RuntimeException('Employee status configuration is unavailable.');
        }
        return self::$contract = $contract;
    }

    public static function statuses(): array { return self::values()['employee_statuses']; }
    public static function classifications(): array { return array_column(self::values()['employee_classifications'], 'value'); }

    public static function normalizeClassification(mixed $value): mixed
    {
        if ($value === '5%' || $value === 'five_percent') return '5_percent';
        return $value;
    }

    public static function classificationLabel(string $value): string
    {
        foreach (self::values()['employee_classifications'] as $classification) {
            if (($classification['value'] ?? null) === $value) return (string) ($classification['label'] ?? $value);
        }
        return $value;
    }
}
