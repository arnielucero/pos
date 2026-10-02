<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->string('sku', 64);
            $table->string('barcode', 64)->nullable();
            $table->string('name');
            $table->string('category', 100)->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('track_stock')->default(true);
            $table->datetimes();
            $table->softDeletesDatetime();

            $table->unique(['store_id', 'sku']);
            $table->index(['store_id', 'barcode']);
            $table->index(['store_id', 'updated_at']);
            $table->index(['store_id', 'name']);
        });

        Schema::create('product_prices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->unsignedBigInteger('price'); // centavos
            $table->dateTime('effective_from');
            $table->dateTime('effective_to')->nullable(); // null = current
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('created_at')->nullable();

            $table->index(['product_id', 'effective_from']);
            $table->index(['product_id', 'effective_to']);
        });

        // Append-only stock ledger.
        Schema::create('inventory_movements', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->enum('type', ['STOCK_IN', 'STOCK_OUT', 'SALE', 'RETURN', 'ADJUSTMENT', 'TRANSFER', 'VOID']);
            $table->bigInteger('quantity'); // signed: + adds stock, - removes
            $table->string('reference_type', 32)->nullable();
            $table->uuid('reference_uuid')->nullable();
            $table->string('reason')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('occurred_at')->nullable(); // client time
            $table->dateTime('created_at');

            $table->index(['store_id', 'product_id', 'created_at']);
            $table->index(['reference_type', 'reference_uuid']);
        });

        Schema::create('inventory_balances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->bigInteger('quantity_on_hand')->default(0); // may go negative (offline sales)
            $table->dateTime('updated_at')->nullable();

            $table->unique(['product_id', 'store_id']);
            $table->index(['store_id', 'updated_at']);
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE inventory_movements ADD CONSTRAINT chk_movements_qty_nonzero CHECK (quantity <> 0)');
            DB::statement('ALTER TABLE product_prices ADD CONSTRAINT chk_prices_window CHECK (effective_to IS NULL OR effective_to >= effective_from)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_balances');
        Schema::dropIfExists('inventory_movements');
        Schema::dropIfExists('product_prices');
        Schema::dropIfExists('products');
    }
};
