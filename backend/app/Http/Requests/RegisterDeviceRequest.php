<?php

declare(strict_types=1);

namespace App\Http\Requests;

final class RegisterDeviceRequest extends ApiRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'device_uuid' => ['required', 'uuid'],
            'device_name' => ['required', 'string', 'max:100'],
            'device_type' => ['required', 'string', 'max:32', 'regex:/^[A-Z0-9_]+$/'],
        ];
    }
}
