<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\PersonalAccessToken;
use App\Models\RefreshToken;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AuthTest extends TestCase
{
    private function login(string $email, string $password = 'password', ?string $deviceUuid = null)
    {
        return $this->api('POST', '/auth/login', ['email' => $email, 'password' => $password], ['X-Device-Id' => $deviceUuid ?? $this->device->uuid]);
    }

    public function test_login_returns_contract_shape_without_secrets(): void
    {
        $res = $this->login($this->users['CASHIER']->email)->assertOk();

        $res->assertJsonStructure([
            'access_token', 'access_expires_at', 'refresh_token', 'refresh_expires_at',
            'user' => ['uuid', 'name', 'email', 'role', 'permissions', 'store' => ['uuid', 'code', 'name']],
            'device' => ['uuid', 'code', 'status'], 'offline_policy' => ['max_offline_hours', 'max_failed_attempts'], 'server_time',
        ]);
        $res->assertJsonPath('user.role', 'CASHIER')->assertJsonPath('device.code', 'POS-01')->assertJsonPath('user.store.code', 'STORE-001');
        $this->assertContains('sale.create', $res->json('user.permissions'));
        $this->assertNotContains('sale.void', $res->json('user.permissions'));
        $this->assertSame(64, strlen($res->json('refresh_token')));
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $res->json('access_expires_at'));
        $body = $res->getContent();
        foreach (['password', 'pin_hash', 'remember_token', 'token_hash'] as $secret) {
            $this->assertStringNotContainsString($secret, $body);
        }

        // Refresh token stored only as SHA-256, access token bound to the device.
        $this->assertDatabaseHas('refresh_tokens', ['token_hash' => hash('sha256', $res->json('refresh_token'))]);
        $this->assertDatabaseMissing('refresh_tokens', ['token_hash' => $res->json('refresh_token')]);
        $this->assertSame($this->device->uuid, PersonalAccessToken::query()->latest('id')->value('device_uuid'));
        $this->assertTrue(AuditLog::query()->where('action', 'LOGIN')->exists());
    }

    public function test_failed_login_is_uniform_and_audited(): void
    {
        $wrongPass = $this->login($this->users['CASHIER']->email, 'nope')->assertStatus(401);
        $unknown = $this->login('nobody@pos.test', 'nope')->assertStatus(401);

        $wrongPass->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $this->assertSame($wrongPass->json(), $unknown->json());
        $this->assertSame(2, AuditLog::query()->where('action', 'LOGIN_FAILED')->where('level', 'SECURITY')->count());
    }

    public function test_inactive_user_cannot_login(): void
    {
        $this->users['CASHIER']->update(['is_active' => false]);
        $this->login($this->users['CASHIER']->email)->assertStatus(401)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
    }

    public function test_unregistered_device_rules(): void
    {
        $unknown = (string) Str::uuid();
        $this->login($this->users['CASHIER']->email, deviceUuid: $unknown)->assertStatus(403)->assertJsonPath('error.code', 'DEVICE_NOT_REGISTERED');
        $this->login($this->users['ADMIN']->email, deviceUuid: $unknown)->assertOk()->assertJsonPath('device', null);
    }

    public function test_disabled_and_foreign_devices_are_refused_at_login(): void
    {
        $this->device->update(['status' => 'DISABLED']);
        $this->login($this->users['CASHIER']->email)->assertStatus(403)->assertJsonPath('error.code', 'DEVICE_DISABLED');

        $other = $this->makeStore('STORE-002');
        $foreign = $this->makeDevice($other, 'POS-01');
        $this->login($this->users['MANAGER']->email, deviceUuid: $foreign->uuid)->assertStatus(403)->assertJsonPath('error.code', 'DEVICE_STORE_MISMATCH');
    }

    public function test_login_requires_device_header(): void
    {
        $this->api('POST', '/auth/login', ['email' => $this->users['CASHIER']->email, 'password' => 'password'])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
    }

    public function test_refresh_rotates_tokens(): void
    {
        $first = $this->login($this->users['CASHIER']->email)->json();
        $second = $this->api('POST', '/auth/refresh', ['refresh_token' => $first['refresh_token']], ['X-Device-Id' => $this->device->uuid])
            ->assertOk()->assertJsonStructure(['access_token', 'refresh_token', 'user', 'device', 'server_time'])->json();

        $this->assertNotSame($first['refresh_token'], $second['refresh_token']);
        $this->assertNotSame($first['access_token'], $second['access_token']);

        $old = RefreshToken::query()->where('token_hash', hash('sha256', $first['refresh_token']))->first();
        $this->assertNotNull($old->revoked_at);
        $this->assertNotNull($old->replaced_by);

        // Old access token is gone, the new one works.
        $this->api('GET', '/auth/me', [], ['Authorization' => 'Bearer '.$first['access_token'], 'X-Device-Id' => $this->device->uuid])->assertStatus(401);
        $this->api('GET', '/auth/me', [], ['Authorization' => 'Bearer '.$second['access_token'], 'X-Device-Id' => $this->device->uuid])->assertOk();
    }

    public function test_reusing_a_rotated_refresh_token_revokes_the_family(): void
    {
        $first = $this->login($this->users['CASHIER']->email)->json();
        $second = $this->api('POST', '/auth/refresh', ['refresh_token' => $first['refresh_token']], ['X-Device-Id' => $this->device->uuid])->json();

        $this->api('POST', '/auth/refresh', ['refresh_token' => $first['refresh_token']], ['X-Device-Id' => $this->device->uuid])
            ->assertStatus(401)->assertJsonPath('error.code', 'UNAUTHENTICATED');

        // Attacker's reuse killed the legitimate (newer) tokens too.
        $this->api('POST', '/auth/refresh', ['refresh_token' => $second['refresh_token']], ['X-Device-Id' => $this->device->uuid])->assertStatus(401);
        $this->api('GET', '/auth/me', [], ['Authorization' => 'Bearer '.$second['access_token'], 'X-Device-Id' => $this->device->uuid])->assertStatus(401);
        $this->assertTrue(AuditLog::query()->where('action', 'REFRESH_TOKEN_REUSE')->where('level', 'SECURITY')->exists());
    }

    public function test_refresh_from_another_device_is_rejected(): void
    {
        $first = $this->login($this->users['CASHIER']->email)->json();
        $other = $this->makeDevice($this->store, 'POS-02');
        $this->api('POST', '/auth/refresh', ['refresh_token' => $first['refresh_token']], ['X-Device-Id' => $other->uuid])->assertStatus(401);
    }

    public function test_logout_revokes_access_and_refresh_tokens(): void
    {
        $session = $this->login($this->users['CASHIER']->email)->json();
        $headers = ['Authorization' => 'Bearer '.$session['access_token'], 'X-Device-Id' => $this->device->uuid];

        $this->api('POST', '/auth/logout', [], $headers)->assertNoContent();
        $this->api('GET', '/auth/me', [], $headers)->assertStatus(401);
        $this->api('POST', '/auth/refresh', ['refresh_token' => $session['refresh_token']], ['X-Device-Id' => $this->device->uuid])->assertStatus(401);
        $this->assertTrue(AuditLog::query()->where('action', 'LOGOUT')->exists());
    }

    public function test_expired_access_token_reports_token_expired(): void
    {
        $session = $this->login($this->users['CASHIER']->email)->json();
        $this->travel(13)->hours();

        $this->api('GET', '/auth/me', [], ['Authorization' => 'Bearer '.$session['access_token'], 'X-Device-Id' => $this->device->uuid])
            ->assertStatus(401)->assertJsonPath('error.code', 'TOKEN_EXPIRED');

        // Refresh still works (30 days).
        $this->api('POST', '/auth/refresh', ['refresh_token' => $session['refresh_token']], ['X-Device-Id' => $this->device->uuid])->assertOk();
    }

    public function test_me_returns_user_without_secrets(): void
    {
        $res = $this->api('GET', '/auth/me', [], $this->authHeaders($this->users['MANAGER']))->assertOk();
        $res->assertJsonPath('user.role', 'MANAGER')->assertJsonPath('user.uuid', $this->users['MANAGER']->uuid);
        $this->assertArrayNotHasKey('password', $res->json('user'));
        $this->assertArrayNotHasKey('pin_hash', $res->json('user'));
        $this->assertStringNotContainsString('$2y$', $res->getContent());
    }

    public function test_login_is_rate_limited_per_email_and_ip(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->login($this->users['CASHIER']->email, 'wrong')->assertStatus(401);
        }
        $this->login($this->users['CASHIER']->email, 'wrong')->assertStatus(429)->assertJsonPath('error.code', 'RATE_LIMITED')->assertHeader('Retry-After');
        // A different email from the same IP is a different bucket.
        $this->login($this->users['MANAGER']->email)->assertOk();
    }
}
