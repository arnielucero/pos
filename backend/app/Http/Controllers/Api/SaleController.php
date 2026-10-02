<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Application\Sales\CompleteSaleAction;
use App\Application\Sync\IdempotentOperationRunner;
use App\Domain\Sync\OperationStatus;
use App\Domain\Sync\OperationType;
use App\Http\Controllers\Controller;
use App\Http\RequestContext;
use App\Http\Requests\ListSalesRequest;
use App\Http\Requests\StoreSaleRequest;
use App\Http\Resources\SaleResource;
use App\Http\Responses\ErrorEnvelope;
use App\Models\Sale;
use App\Support\Iso;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class SaleController extends Controller
{
    /** POST /sales — standalone CREATE_SALE: 201 new, 200 replay, error envelope on rejection. */
    public function store(StoreSaleRequest $request, IdempotentOperationRunner $runner, CompleteSaleAction $action): JsonResponse
    {
        $ctx = RequestContext::sync($request);
        $key = (string) $request->header('Idempotency-Key');
        $result = $runner->run($ctx, OperationType::CREATE_SALE, $key, $request->payload(), $action);

        if ($result->status === OperationStatus::REJECTED) {
            return ErrorEnvelope::response($result->error['code'] ?? 'SERVER_ERROR', $result->error['message'] ?? 'Rejected.',
                $result->httpStatus, $result->error['details'] ?? []);
        }

        $sale = Sale::query()->where('store_id', $ctx->storeId())->where('uuid', $result->entityUuid)->firstOrFail();

        return response()->json([
            'data' => (new SaleResource($sale))->toArray($request),
            'result' => $result->toArray($key),
        ], $result->httpStatus);
    }

    public function show(Request $request, string $uuid): SaleResource
    {
        return new SaleResource(
            Sale::query()->where('store_id', RequestContext::user($request)->store_id)->where('uuid', $uuid)->firstOrFail()
        );
    }

    public function index(ListSalesRequest $request): AnonymousResourceCollection
    {
        $sales = Sale::query()
            ->where('store_id', RequestContext::user($request)->store_id)
            ->when($request->query('from'), fn ($q, $from) => $q->where('client_created_at', '>=', Iso::parse((string) $from)))
            ->when($request->query('to'), fn ($q, $to) => $q->where('client_created_at', '<=', Iso::parse((string) $to)))
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->orderByDesc('client_created_at')->orderByDesc('id')
            ->paginate(50);

        return SaleResource::collection($sales);
    }
}
