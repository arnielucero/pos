<?php

declare(strict_types=1);

namespace App\Http\Requests;

final class LoginRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['device_uuid' => $this->header('X-Device-Id')]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'max:191'],
            'password' => ['required', 'string', 'max:255'],
            'device_uuid' => ['required', 'uuid'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['device_uuid.required' => 'The X-Device-Id header is required.', 'device_uuid.uuid' => 'The X-Device-Id header must be a UUID.'];
    }
}
