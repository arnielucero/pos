<?php

declare(strict_types=1);

namespace App\Application\Shared;

use App\Domain\Shared\Exceptions\ValidationFailedException;
use Illuminate\Support\Facades\Validator;

/** Runs Laravel validation on an operation payload and maps failure to the domain exception. */
final class PayloadValidator
{
    /**
     * @param  array<mixed>  $data
     * @param  array<string, mixed>  $rules
     * @return array<mixed>
     */
    public function validate(array $data, array $rules): array
    {
        $validator = Validator::make($data, $rules);
        if ($validator->fails()) {
            throw new ValidationFailedException('The given data was invalid.', $validator->errors()->toArray());
        }

        return $data;
    }

    /** @param array<string, list<string>> $errors */
    public function fail(array $errors): never
    {
        throw new ValidationFailedException('The given data was invalid.', $errors);
    }
}
