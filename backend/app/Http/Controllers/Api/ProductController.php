<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Application\Products\SaveProductAction;
use App\Http\Controllers\Controller;
use App\Http\RequestContext;
use App\Http\Requests\ListProductsRequest;
use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

final class ProductController extends Controller
{
    public function index(ListProductsRequest $request): AnonymousResourceCollection
    {
        $search = trim((string) $request->query('search', ''));
        $products = Product::query()
            ->with(['currentPrice', 'balance'])
            ->where('store_id', RequestContext::user($request)->store_id)
            ->when($search !== '', function ($q) use ($search) {
                $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search).'%';
                $q->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('sku', 'like', $like)->orWhere('barcode', $search));
            })
            ->orderBy('name')
            ->paginate(50);

        return ProductResource::collection($products);
    }

    public function store(StoreProductRequest $request, SaveProductAction $action): JsonResponse
    {
        $product = $action->create(RequestContext::user($request), $request->validated(), RequestContext::device($request)->id, $request->ip());

        return (new ProductResource($product))->response()->setStatusCode(201);
    }

    public function update(UpdateProductRequest $request, string $uuid, SaveProductAction $action): ProductResource
    {
        return new ProductResource($action->update(RequestContext::user($request), $this->find($request, $uuid), $request->validated(),
            RequestContext::device($request)->id, $request->ip()));
    }

    public function destroy(Request $request, string $uuid, SaveProductAction $action): Response
    {
        $action->delete(RequestContext::user($request), $this->find($request, $uuid), RequestContext::device($request)->id, $request->ip());

        return response()->noContent();
    }

    private function find(Request $request, string $uuid): Product
    {
        return Product::query()->where('store_id', RequestContext::user($request)->store_id)->where('uuid', $uuid)->firstOrFail();
    }
}
