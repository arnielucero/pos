<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\ProductPrice;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class PullAndCatalogTest extends TestCase
{
    public function test_full_pull_contains_catalog_inventory_approvers_and_settings(): void
    {
        $chicken = $this->makeProduct('ML-001', 12000, 25);
        $this->makeProduct('DR-001', 9000, 10);

        $res = $this->api('GET', '/sync/pull', [], $this->authHeaders($this->users['CASHIER']))->assertOk();
        $res->assertJsonStructure(['server_time', 'has_more', 'products', 'inventory', 'approvers', 'settings'])
            ->assertJsonPath('has_more', false)
            ->assertJsonCount(2, 'products')
            ->assertJsonCount(2, 'inventory')
            ->assertJsonPath('settings.tax_rate_bp', 1200)
            ->assertJsonPath('settings.currency', 'PHP')
            ->assertJsonPath('settings.max_discount_bp', 5000)
            ->assertJsonPath('settings.receipt_header', "HMR POS\nSTORE-001");

        $product = collect($res->json('products'))->firstWhere('uuid', $chicken->uuid);
        $this->assertSame(['uuid' => $chicken->uuid, 'sku' => 'ML-001', 'barcode' => null, 'name' => 'Product ML-001', 'category' => 'Meals',
            'price' => 12000, 'is_active' => true, 'track_stock' => true, 'updated_at' => $product['updated_at'], 'deleted' => false], $product);
        $this->assertSame(25, collect($res->json('inventory'))->firstWhere('product_uuid', $chicken->uuid)['quantity_on_hand']);

        // Approvers: manager + supervisor (approval.grant AND a PIN). Admin has no PIN, cashier no approval.grant.
        $approvers = collect($res->json('approvers'));
        $this->assertEqualsCanonicalizing([$this->users['MANAGER']->uuid, $this->users['SUPERVISOR']->uuid], $approvers->pluck('user_uuid')->all());
        $this->assertStringStartsWith('$2y$', $approvers->first()['pin_hash']);
        $this->assertContains('approval.grant', $approvers->first()['permissions']);
        $this->assertStringNotContainsString('"password"', $res->getContent());
    }

    public function test_store_settings_override_config(): void
    {
        $this->store->update(['settings' => ['tax_rate_bp' => 0, 'receipt_footer' => 'Salamat!']]);
        $this->api('GET', '/sync/pull', [], $this->authHeaders($this->users['CASHIER']))
            ->assertJsonPath('settings.tax_rate_bp', 0)->assertJsonPath('settings.receipt_footer', 'Salamat!');
    }

    public function test_incremental_pull_and_soft_deletes(): void
    {
        $old = $this->makeProduct('OLD-1', 1000, 0);
        $gone = $this->makeProduct('GONE-1', 1000, 0);
        DB::table('products')->update(['updated_at' => now()->subDay()]);
        DB::table('inventory_balances')->update(['updated_at' => now()->subDay()]);

        $this->travel(1)->seconds();
        $since = now()->subSecond()->utc()->format('Y-m-d\TH:i:s\Z');
        $manager = $this->authHeaders($this->users['MANAGER']);
        $this->api('DELETE', '/products/'.$gone->uuid, [], $manager)->assertNoContent();
        $this->api('PUT', '/products/'.$old->uuid, ['price' => 1500], $manager)->assertOk()->assertJsonPath('data.price', 1500);
        $fresh = $this->makeProduct('NEW-1', 2000, 3);

        $res = $this->api('GET', '/sync/pull?since='.urlencode($since), [], $manager)->assertOk();
        $products = collect($res->json('products'))->keyBy('uuid');
        $this->assertCount(3, $products);
        $this->assertTrue($products[$gone->uuid]['deleted']);
        $this->assertSame(1500, $products[$old->uuid]['price']);
        $this->assertFalse($products[$fresh->uuid]['deleted']);
        $this->assertSame([$fresh->uuid], array_column($res->json('inventory'), 'product_uuid'));

        // Price change closed the old window and opened a new one.
        $this->assertSame(2, ProductPrice::query()->where('product_id', $old->id)->count());
        $this->assertSame(1, ProductPrice::query()->where('product_id', $old->id)->whereNull('effective_to')->count());
    }

    public function test_pull_pagination(): void
    {
        config(['pos.sync.pull_page_size' => 2]);
        foreach (range(1, 5) as $i) {
            $this->makeProduct("P-$i", 1000, 1);
        }
        $headers = $this->authHeaders($this->users['CASHIER']);
        $this->api('GET', '/sync/pull?page=1', [], $headers)->assertJsonPath('has_more', true)->assertJsonCount(2, 'products');
        $this->api('GET', '/sync/pull?page=3', [], $headers)->assertJsonPath('has_more', false)->assertJsonCount(1, 'products');
    }

    public function test_product_permissions(): void
    {
        $body = ['sku' => 'ML-099', 'name' => 'Arroz Caldo', 'category' => 'Meals', 'price' => 8000, 'initial_stock' => 12];

        $this->api('POST', '/products', $body, $this->authHeaders($this->users['CASHIER']))->assertStatus(403)->assertJsonPath('error.code', 'FORBIDDEN');
        $this->api('POST', '/products', $body, $this->authHeaders($this->users['INVENTORY']))->assertStatus(403);

        $manager = $this->authHeaders($this->users['MANAGER']);
        $created = $this->api('POST', '/products', $body, $manager)->assertCreated()
            ->assertJsonPath('data.price', 8000)->assertJsonPath('data.quantity_on_hand', 12)->json('data');
        $this->api('POST', '/products', $body, $manager)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->api('POST', '/products', ['price' => 12.5] + $body + ['sku' => 'X'], $manager)->assertStatus(422);

        $this->api('PUT', '/products/'.$created['uuid'], ['name' => 'Hacked'], $this->authHeaders($this->users['CASHIER']))->assertStatus(403);
        $this->api('GET', '/products?search=arroz', [], $this->authHeaders($this->users['CASHIER']))->assertOk()->assertJsonCount(1, 'data');
    }
}
