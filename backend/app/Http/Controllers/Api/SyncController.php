<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Application\Sync\PullSyncAction;
use App\Application\Sync\SyncBatchProcessor;
use App\Http\Controllers\Controller;
use App\Http\RequestContext;
use App\Http\Requests\PullSyncRequest;
use App\Http\Requests\SyncRequest;
use App\Support\Iso;
use Illuminate\Http\JsonResponse;

final class SyncController extends Controller
{
    public function pull(PullSyncRequest $request, PullSyncAction $action): JsonResponse
    {
        $user = RequestContext::user($request);
        $user->loadMissing('store');

        return response()->json($action->pull($user->store, RequestContext::device($request),
            Iso::parse($request->query('since')), (int) ($request->query('page') ?? 1)));
    }

    public function push(SyncRequest $request, SyncBatchProcessor $processor): JsonResponse
    {
        $results = $processor->process(RequestContext::sync($request), $request->input('operations', []));

        return response()->json(['results' => $results, 'server_time' => Iso::now()]);
    }
}
