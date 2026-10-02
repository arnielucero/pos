<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Application\Auth\LoginAction;
use App\Application\Auth\LogoutAction;
use App\Application\Auth\RefreshAccessTokenAction;
use App\Http\Controllers\Controller;
use App\Http\RequestContext;
use App\Http\Requests\LoginRequest;
use App\Http\Requests\RefreshRequest;
use App\Http\Resources\AuthSessionResource;
use App\Http\Resources\UserResource;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class AuthController extends Controller
{
    public function login(LoginRequest $request, LoginAction $action): JsonResponse
    {
        $session = $action->execute($request->string('email')->toString(), $request->string('password')->toString(),
            $request->string('device_uuid')->toString(), $request->ip());

        return (new AuthSessionResource($session))->response()->setStatusCode(200);
    }

    public function refresh(RefreshRequest $request, RefreshAccessTokenAction $action): JsonResponse
    {
        $session = $action->execute($request->string('refresh_token')->toString(), $request->string('device_uuid')->toString(), $request->ip());

        return (new AuthSessionResource($session))->response()->setStatusCode(200);
    }

    public function logout(Request $request, LogoutAction $action): Response
    {
        /** @var PersonalAccessToken $token */
        $token = RequestContext::user($request)->currentAccessToken();
        $deviceId = Device::query()->where('uuid', $token->device_uuid)->value('id');
        $action->execute(RequestContext::user($request), $token, $deviceId, $request->ip());

        return response()->noContent();
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => (new UserResource(RequestContext::user($request)))->toArray($request)]);
    }
}
