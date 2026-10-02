<?php

declare(strict_types=1);

namespace App\Http;

use App\Domain\Auth\Exceptions\TokenExpiredException;
use App\Domain\Auth\Exceptions\UnauthenticatedException;
use App\Domain\Shared\Exceptions\DomainException;
use App\Http\Responses\ErrorEnvelope;
use App\Models\PersonalAccessToken;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;
use Throwable;

/**
 * The ONE place where exceptions become API responses. Every non-2xx API response uses the
 * error envelope; internals (messages of unexpected exceptions, stack traces) never leak.
 */
final class ApiExceptionRenderer
{
    private const STATUS_CODES = [
        400 => 'BAD_REQUEST', 401 => 'UNAUTHENTICATED', 403 => 'FORBIDDEN', 404 => 'NOT_FOUND',
        405 => 'METHOD_NOT_ALLOWED', 408 => 'REQUEST_TIMEOUT', 409 => 'CONFLICT', 413 => 'PAYLOAD_TOO_LARGE',
        415 => 'UNSUPPORTED_MEDIA_TYPE', 422 => 'VALIDATION_FAILED', 429 => 'RATE_LIMITED', 503 => 'SERVICE_UNAVAILABLE',
    ];

    public function render(Throwable $e, Request $request): ?JsonResponse
    {
        if (! $request->is('api/*')) {
            return null;
        }

        return match (true) {
            $e instanceof DomainException => $this->domain($e),
            $e instanceof ValidationException => ErrorEnvelope::response('VALIDATION_FAILED', 'The given data was invalid.', 422, $e->errors()),
            $e instanceof AuthenticationException => $this->unauthenticated($request),
            $e instanceof AuthorizationException, $e instanceof AccessDeniedHttpException => ErrorEnvelope::response('FORBIDDEN', 'You are not allowed to perform this action.', 403),
            $e instanceof ModelNotFoundException, $e instanceof NotFoundHttpException => ErrorEnvelope::response('NOT_FOUND', 'Resource not found.', 404),
            $e instanceof MethodNotAllowedHttpException => ErrorEnvelope::response('METHOD_NOT_ALLOWED', 'Method not allowed.', 405, [], $e->getHeaders()),
            $e instanceof TooManyRequestsHttpException => ErrorEnvelope::response('RATE_LIMITED', 'Too many requests. Retry later.', 429, [], $e->getHeaders()),
            $e instanceof HttpExceptionInterface => ErrorEnvelope::response(
                self::STATUS_CODES[$e->getStatusCode()] ?? ($e->getStatusCode() >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR'),
                $e->getStatusCode() >= 500 ? 'Server error.' : 'Request could not be processed.',
                $e->getStatusCode(), [], $e->getHeaders()),
            default => ErrorEnvelope::response('SERVER_ERROR', 'Unexpected server error.', 500),
        };
    }

    /** Distinguish an expired (but genuine) token so the client knows to refresh. */
    private function unauthenticated(Request $request): JsonResponse
    {
        $bearer = $request->bearerToken();
        if ($bearer !== null && ($token = PersonalAccessToken::findToken($bearer)) !== null) {
            $ttl = (int) config('sanctum.expiration');
            $expired = ($token->expires_at !== null && $token->expires_at->isPast())
                || ($ttl > 0 && $token->created_at->lte(now()->subMinutes($ttl)));
            if ($expired) {
                return $this->domain(new TokenExpiredException);
            }
        }

        return $this->domain(new UnauthenticatedException);
    }

    private function domain(DomainException $e): JsonResponse
    {
        return ErrorEnvelope::response($e->errorCode(), $e->getMessage(), $e->httpStatus(), $e->details());
    }
}
