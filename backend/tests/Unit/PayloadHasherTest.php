<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Domain\Sync\OperationType;
use App\Domain\Sync\PayloadHasher;
use PHPUnit\Framework\TestCase;

final class PayloadHasherTest extends TestCase
{
    public function test_hash_ignores_object_key_order_but_not_list_order(): void
    {
        $h = new PayloadHasher;
        $a = ['b' => 1, 'a' => ['y' => 2, 'x' => [1, 2]]];
        $b = ['a' => ['x' => [1, 2], 'y' => 2], 'b' => 1];
        $c = ['a' => ['x' => [2, 1], 'y' => 2], 'b' => 1];

        $this->assertSame($h->hash(OperationType::CREATE_SALE, $a), $h->hash(OperationType::CREATE_SALE, $b));
        $this->assertNotSame($h->hash(OperationType::CREATE_SALE, $a), $h->hash(OperationType::CREATE_SALE, $c));
        $this->assertNotSame($h->hash(OperationType::CREATE_SALE, $a), $h->hash(OperationType::VOID_SALE, $a));
        $this->assertSame('{"a":{"x":[1,2],"y":2},"b":1}', $h->canonicalJson($a));
    }
}
