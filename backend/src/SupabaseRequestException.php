<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;

/** Internal transport metadata only; database messages are never client-facing. */
final class SupabaseRequestException extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly ?string $identifier = null)
    {
        parent::__construct("Supabase request failed with HTTP {$status}.");
    }
}
