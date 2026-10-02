<?php

declare(strict_types=1);

use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DeviceController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SaleController;
use App\Http\Controllers\Api\SyncController;
use Illuminate\Support\Facades\Route;

/*
| API v1 — see docs/API.md. Middleware aliases:
|   pos.bound  = access token must belong to the X-Device-Id it was issued for (401)
|   pos.device = X-Device-Id must be a registered ACTIVE device of the user's store (403 DEVICE_*)
*/
Route::prefix('v1')->group(function (): void {
    Route::get('health', HealthController::class);

    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
    Route::post('auth/refresh', [AuthController::class, 'refresh'])->middleware('throttle:refresh');

    Route::middleware(['auth:sanctum', 'pos.bound', 'throttle:api'])->group(function (): void {
        // Usable before the device is registered (admin bootstrap flow).
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('devices/register', [DeviceController::class, 'register'])->middleware('can:device.register');

        Route::middleware('pos.device')->group(function (): void {
            Route::get('devices', [DeviceController::class, 'index'])->middleware('can:device.register');
            Route::patch('devices/{uuid}', [DeviceController::class, 'update'])->middleware('can:device.register');

            Route::get('sync/pull', [SyncController::class, 'pull']);
            Route::post('sync', [SyncController::class, 'push'])->middleware('throttle:sync');

            Route::post('sales', [SaleController::class, 'store'])->middleware('throttle:sync');
            Route::get('sales', [SaleController::class, 'index'])->middleware('can:report.view');
            Route::get('sales/{uuid}', [SaleController::class, 'show'])->middleware('can:sale.view');

            Route::get('products', [ProductController::class, 'index'])->middleware('can:inventory.view');
            Route::post('products', [ProductController::class, 'store'])->middleware('can:product.edit');
            Route::put('products/{uuid}', [ProductController::class, 'update'])->middleware('can:product.edit');
            Route::delete('products/{uuid}', [ProductController::class, 'destroy'])->middleware('can:product.edit');

            Route::get('audit-logs', [AuditLogController::class, 'index'])->middleware('can:report.view');
        });
    });
});
