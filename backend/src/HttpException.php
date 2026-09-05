<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;

final class HttpException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status, public readonly ?string $errorCode = null)
    {
        parent::__construct($message);
    }
}
