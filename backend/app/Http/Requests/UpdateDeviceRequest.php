<?php

declare(strict_types=1);

namespace App\Http\Requests;

final class UpdateDeviceRequest extends ApiRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['status' => ['required', 'in:ACTIVE,DISABLED']];
    }
}
