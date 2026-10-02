<?php

declare(strict_types=1);

use App\Domain\Shared\Exceptions\DomainException;
use App\Http\ApiExceptionRenderer;
use App\Http\Middleware\ApiSecurityHeaders;
use App\Http\Middleware\EnsureDeviceIsActive;
use App\Http\Middleware\EnsureTokenBoundToDevice;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'pos.bound' => EnsureTokenBoundToDevice::class,
            'pos.device' => EnsureDeviceIsActive::class,
        ]);
        $middleware->api(append: [ApiSecurityHeaders::class]);
        // Pure token API: never redirect guests to a login page.
        $middleware->redirectGuestsTo(fn (Request $request) => $request->is('api/*') ? null : '/');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontReport([DomainException::class]);
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());
        // Single mapping point: every API error -> { "error": { code, message, details } }.
        $exceptions->render(fn (Throwable $e, Request $request) => app(ApiExceptionRenderer::class)->render($e, $request));
    })->create();
