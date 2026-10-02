<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Application\Auth\TokenIssuer;
use App\Models\Device;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeviceTest extends TestCase
{
    public function test_token_is_bound_to_its_device(): void
    {
        $headers = $this->authHeaders($this->users['CASHIER']);
        $other = $this->makeDevice($this->store, 'POS-02');

        $this->api('GET', '/sync/pull', [], ['X-Device-Id' => $other->uuid] + $headers)->assertStatus(401)->assertJsonPath('error.code', 'UNAUTHENTICATED');
        $this->api('GET', '/sync/pull', [], ['X-Device-Id' => ''] + $headers)->assertStatus(401);
        $this->api('GET', '/sync/pull', [], $headers)->assertOk();
    }

    public function test_device_middleware_codes(): void
    {
        $headers = $this->authHeaders($this->users['CASHIER']);

        $this->device->update(['status' => 'DISABLED']);
        $this->api('GET', '/sync/pull', [], $headers)->assertStatus(403)->assertJsonPath('error.code', 'DEVICE_DISABLED');

        // Admin bootstrap token for an unregistered device: only register/me/logout work.
        $unregistered = (string) Str::uuid();
        $admin = $this->users['ADMIN'];
        $tokens = app(TokenIssuer::class)->issue($admin, $unregistered, null);
        $adminHeaders = ['Authorization' => 'Bearer '.$tokens->accessToken, 'X-Device-Id' => $unregistered];
        $this->api('GET', '/sync/pull', [], $adminHeaders)->assertStatus(403)->assertJsonPath('error.code', 'DEVICE_NOT_REGISTERED');
        $this->api('GET', '/auth/me', [], $adminHeaders)->assertOk();

        // Device of another store.
        $other = $this->makeStore('STORE-002');
        $foreign = $this->makeDevice($other, 'POS-09');
        $tokens = app(TokenIssuer::class)->issue($this->users['CASHIER'], $foreign->uuid, null);
        $this->api('GET', '/sync/pull', [], ['Authorization' => 'Bearer '.$tokens->accessToken, 'X-Device-Id' => $foreign->uuid])
            ->assertStatus(403)->assertJsonPath('error.code', 'DEVICE_STORE_MISMATCH');
    }

    public function test_device_registration_is_idempotent_and_assigns_codes(): void
    {
        $uuid = (string) Str::uuid();
        $tokens = app(TokenIssuer::class)->issue($this->users['ADMIN'], $uuid, null);
        $headers = ['Authorization' => 'Bearer '.$tokens->accessToken, 'X-Device-Id' => $uuid];
        $body = ['device_uuid' => $uuid, 'device_name' => 'Front counter tablet', 'device_type' => 'ANDROID_TABLET'];

        $first = $this->api('POST', '/devices/register', $body, $headers)->assertCreated();
        $first->assertJsonPath('data.code', 'POS-02')->assertJsonPath('data.status', 'ACTIVE')->assertJsonPath('data.store_uuid', $this->store->uuid);

        $this->api('POST', '/devices/register', $body, $headers)->assertOk()->assertJsonPath('data.code', 'POS-02')->assertJsonPath('data.uuid', $uuid);
        $this->assertSame(1, Device::query()->where('uuid', $uuid)->count());

        // Now registered: the same token can use device-scoped endpoints.
        $this->api('GET', '/sync/pull', [], $headers)->assertOk();

        $this->api('POST', '/devices/register', ['device_uuid' => (string) Str::uuid()] + $body, $headers)->assertCreated()->assertJsonPath('data.code', 'POS-03');
    }

    public function test_registration_permissions_and_cross_store(): void
    {
        $body = ['device_uuid' => (string) Str::uuid(), 'device_name' => 'x', 'device_type' => 'ANDROID_TABLET'];
        $this->api('POST', '/devices/register', $body, $this->authHeaders($this->users['CASHIER']))->assertStatus(403)->assertJsonPath('error.code', 'FORBIDDEN');
        $this->api('POST', '/devices/register', $body, $this->authHeaders($this->users['SUPERVISOR']))->assertStatus(403);

        $other = $this->makeStore('STORE-002');
        $foreign = $this->makeDevice($other, 'POS-01');
        $this->api('POST', '/devices/register', ['device_uuid' => $foreign->uuid] + $body, $this->authHeaders($this->users['MANAGER']))
            ->assertStatus(403)->assertJsonPath('error.code', 'DEVICE_STORE_MISMATCH');
    }

    public function test_list_and_disable_device_revokes_its_tokens(): void
    {
        $manager = $this->authHeaders($this->users['MANAGER']);
        $tablet = $this->makeDevice($this->store, 'POS-02');
        $cashierOnTablet = $this->authHeaders($this->users['CASHIER'], $tablet);

        $this->api('GET', '/devices', [], $manager)->assertOk()->assertJsonCount(2, 'data');
        $this->api('PATCH', '/devices/'.$tablet->uuid, ['status' => 'DISABLED'], $manager)->assertOk()->assertJsonPath('data.status', 'DISABLED');
        $this->api('GET', '/sync/pull', [], $cashierOnTablet)->assertStatus(401);
        $this->api('PATCH', '/devices/'.Str::uuid(), ['status' => 'DISABLED'], $manager)->assertStatus(404)->assertJsonPath('error.code', 'NOT_FOUND');
        $this->api('PATCH', '/devices/'.$tablet->uuid, ['status' => 'BROKEN'], $manager)->assertStatus(422);
    }
}
