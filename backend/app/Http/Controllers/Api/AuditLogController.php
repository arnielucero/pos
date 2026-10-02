<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\RequestContext;
use App\Http\Requests\ListAuditLogsRequest;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Support\Iso;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class AuditLogController extends Controller
{
    public function index(ListAuditLogsRequest $request): AnonymousResourceCollection
    {
        $logs = AuditLog::query()
            ->with(['user', 'device'])
            ->where('store_id', RequestContext::user($request)->store_id)
            ->when($request->query('action'), fn ($q, $action) => $q->where('action', $action))
            ->when($request->query('from'), fn ($q, $from) => $q->where('occurred_at', '>=', Iso::parse((string) $from)))
            ->when($request->query('to'), fn ($q, $to) => $q->where('occurred_at', '<=', Iso::parse((string) $to)))
            ->orderByDesc('occurred_at')->orderByDesc('id')
            ->paginate(100);

        return AuditLogResource::collection($logs);
    }
}
