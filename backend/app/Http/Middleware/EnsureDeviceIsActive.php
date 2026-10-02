<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Application\Auth\DeviceGate;
use App\Http\RequestContext;
use App\Models\Device;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** X-Device-Id must be a registered, ACTIVE device of the user's store (403 DEVICE_* otherwise). */
final class EnsureDeviceIsActive
{
    public function __construct(private readonly DeviceGate $gate) {}

    public function handle(Request $request, Closure $next): Response
    {
        $uuid = strtolower((string) $request->header('X-Device-Id', ''));
        $device = $uuid === '' ? null : Device::query()->where('uuid', $uuid)->first();

        $request->attributes->set(RequestContext::DEVICE, $this->gate->requireUsable($device, RequestContext::user($request)));

        return $next($request);
    }
}
