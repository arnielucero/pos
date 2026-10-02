<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\TestCase;

final class ErrorEnvelopeAndPermissionsTest extends TestCase
{
    private function assertEnvelope($response, int $status, string $code): void
    {
        $response->assertStatus($status)->assertJsonStructure(['error' => ['code', 'message']])->assertJsonPath('error.code', $code);
        $this->assertStringNotContainsString('vendor/', $response->getContent());
        $this->assertStringNotContainsString('trace', $response->getContent());
    }

    public function test_health_is_public(): void
    {
        $this->api('GET', '/health')->assertOk()->assertJsonPath('status', 'ok')->assertJsonStructure(['server_time']);
    }

    public function test_unknown_route_and_resource_are_404_envelopes(): void
    {
        $this->assertEnvelope($this->api('GET', '/does-not-exist'), 404, 'NOT_FOUND');
        $this->assertEnvelope($this->api('GET', '/sales/'.Str::uuid(), [], $this->authHeaders($this->users['CASHIER'])), 404, 'NOT_FOUND');
    }

    public function test_method_not_allowed_is_enveloped(): void
    {
        $this->assertEnvelope($this->api('DELETE', '/health'), 405, 'METHOD_NOT_ALLOWED');
    }

    public function test_validation_error_envelope_has_details(): void
    {
        $res = $this->api('POST', '/auth/login', ['email' => ''], ['X-Device-Id' => $this->device->uuid]);
        $this->assertEnvelope($res, 422, 'VALIDATION_FAILED');
        $this->assertArrayHasKey('email', $res->json('error.details'));
        $this->assertArrayHasKey('password', $res->json('error.details'));
    }

    public function test_unauthenticated_envelope(): void
    {
        $this->assertEnvelope($this->api('GET', '/sync/pull'), 401, 'UNAUTHENTICATED');
        $this->assertEnvelope($this->api('GET', '/sync/pull', [], ['Authorization' => 'Bearer 999|garbage', 'X-Device-Id' => $this->device->uuid]), 401, 'UNAUTHENTICATED');
    }

    public function test_rate_limit_envelope_on_sync(): void
    {
        config(['pos.rate_limits.sync_per_minute' => 2]);
        $headers = $this->authHeaders($this->users['CASHIER']);
        $this->sync([], $headers)->assertOk();
        $this->sync([], $headers)->assertOk();
        $this->assertEnvelope($this->sync([], $headers), 429, 'RATE_LIMITED');
    }

    public function test_unexpected_errors_never_leak_internals(): void
    {
        Route::get('/api/v1/_boom', fn () => throw new \RuntimeException('SQLSTATE secret internals'));
        $res = $this->api('GET', '/_boom');
        $this->assertEnvelope($res, 500, 'SERVER_ERROR');
        $this->assertStringNotContainsString('SQLSTATE', $res->getContent());
    }

    public function test_report_permissions(): void
    {
        $this->assertEnvelope($this->api('GET', '/audit-logs', [], $this->authHeaders($this->users['CASHIER'])), 403, 'FORBIDDEN');
        $this->assertEnvelope($this->api('GET', '/sales', [], $this->authHeaders($this->users['CASHIER'])), 403, 'FORBIDDEN');
        $this->api('GET', '/audit-logs', [], $this->authHeaders($this->users['MANAGER']))->assertOk()->assertJsonStructure(['data', 'meta']);
        $this->api('GET', '/sales?status=FLAGGED', [], $this->authHeaders($this->users['SUPERVISOR']))->assertOk();
        $this->assertEnvelope($this->api('GET', '/devices', [], $this->authHeaders($this->users['SUPERVISOR'])), 403, 'FORBIDDEN');
    }

    public function test_cors_allows_configured_origins_only(): void
    {
        $ok = $this->call('OPTIONS', '/api/v1/health', [], [], [], [
            'HTTP_ORIGIN' => 'capacitor://localhost', 'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'x-device-id,idempotency-key,authorization',
        ]);
        $ok->assertHeader('Access-Control-Allow-Origin', 'capacitor://localhost');

        $evil = $this->call('OPTIONS', '/api/v1/health', [], [], [], [
            'HTTP_ORIGIN' => 'https://evil.example', 'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        ]);
        $this->assertNotSame('https://evil.example', $evil->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_security_headers_present(): void
    {
        $this->api('GET', '/health')->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('Cache-Control');
    }
}
