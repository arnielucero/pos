<?php

declare(strict_types=1);

namespace App\Http\Requests;

final class RefreshRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['device_uuid' => $this->header('X-Device-Id')]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'refresh_token' => ['required', 'string', 'max:255'],
            'device_uuid' => ['required', 'uuid'],
        ];
    }
}
