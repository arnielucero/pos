<?php

declare(strict_types=1);

namespace App\Providers;

use App\Domain\Auth\Permission;
use App\Domain\Auth\PermissionResolver;
use App\Domain\Catalog\PriceHistory;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Repositories\EloquentPriceHistory;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(PermissionResolver::class);
        $this->app->bind(PriceHistory::class, EloquentPriceHistory::class);
    }

    public function boot(): void
    {
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());

        if ($this->app->isProduction()) {
            URL::forceScheme('https');
        }

        $this->defineGates();
        $this->defineRateLimits();
    }

    /** One gate per permission, all resolved from App\Domain\Auth\RolePermissions. */
    private function defineGates(): void
    {
        $resolver = $this->app->make(PermissionResolver::class);
        foreach (Permission::all() as $permission) {
            Gate::define($permission, fn (User $user) => $resolver->has($user, $permission));
        }
        Gate::define('sale.view', fn (User $user) => $resolver->has($user, Permission::SALE_REPRINT) || $resolver->has($user, Permission::REPORT_VIEW));
    }

    private function defineRateLimits(): void
    {
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute((int) config('pos.rate_limits.login_per_minute'))
            ->by(mb_strtolower((string) $request->input('email')).'|'.$request->ip()));

        RateLimiter::for('refresh', fn (Request $request) => Limit::perMinute(20)
            ->by((string) $request->header('X-Device-Id').'|'.$request->ip()));

        RateLimiter::for('api', fn (Request $request) => Limit::perMinute((int) config('pos.rate_limits.api_per_minute'))
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));

        RateLimiter::for('sync', fn (Request $request) => Limit::perMinute((int) config('pos.rate_limits.sync_per_minute'))
            ->by('device:'.strtolower((string) $request->header('X-Device-Id'))));
    }
}
