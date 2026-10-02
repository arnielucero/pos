<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Application\Devices\RegisterDeviceAction;
use App\Application\Devices\UpdateDeviceStatusAction;
use App\Http\Controllers\Controller;
use App\Http\RequestContext;
use App\Http\Requests\RegisterDeviceRequest;
use App\Http\Requests\UpdateDeviceRequest;
use App\Http\Resources\DeviceResource;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class DeviceController extends Controller
{
    public function register(RegisterDeviceRequest $request, RegisterDeviceAction $action): JsonResponse
    {
        [$device, $created] = $action->execute(RequestContext::user($request), $request->string('device_uuid')->toString(),
            $request->string('device_name')->toString(), $request->string('device_type')->toString(), $request->ip());

        return (new DeviceResource($device))->response()->setStatusCode($created ? 201 : 200);
    }

    public function index(Request $request): AnonymousResourceCollection
    {
        return DeviceResource::collection(
            Device::query()->with('store')->where('store_id', RequestContext::user($request)->store_id)->orderBy('code')->get()
        );
    }

    public function update(UpdateDeviceRequest $request, string $uuid, UpdateDeviceStatusAction $action): DeviceResource
    {
        return new DeviceResource($action->execute(RequestContext::user($request), $uuid, $request->string('status')->toString(), $request->ip()));
    }
}
