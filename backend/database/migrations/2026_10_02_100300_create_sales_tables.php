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
        // Financial rows are append-only: money columns are never updated after insert.
        Schema::create('sales', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid');
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->foreignId('device_id')->constrained('devices')->restrictOnDelete();
            $table->foreignId('cashier_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('synced_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('register_session_id')->nullable()->constrained('register_sessions')->nullOnDelete();
            $table->uuid('register_session_uuid')->nullable();
            $table->string('receipt_number', 64);
            $table->string('client_receipt_number', 64); // as sent; differs only on a receipt-number collision
            $table->enum('status', ['COMPLETED', 'FLAGGED', 'VOIDED']);
            $table->unsignedBigInteger('subtotal');
            $table->unsignedBigInteger('discount_total');
            $table->string('order_discount_type', 16)->nullable();
            $table->unsignedBigInteger('order_discount_value')->nullable();
            $table->unsignedBigInteger('order_discount_amount')->default(0);
            $table->json('order_discount_approval')->nullable();
            $table->unsignedBigInteger('tax_total');
            $table->unsignedInteger('tax_rate_bp');
            $table->unsignedBigInteger('total');
            $table->unsignedBigInteger('cash_change')->default(0);
            $table->dateTime('client_created_at');
            $table->dateTime('catalog_synced_at')->nullable();
            $table->dateTime('received_at');
            $table->char('payload_hash', 64);
            $table->datetimes();

            $table->unique(['store_id', 'uuid']);
            $table->unique(['store_id', 'receipt_number']);
            $table->index(['store_id', 'client_created_at']);
            $table->index(['store_id', 'status']);
            $table->index('register_session_uuid');
        });

        Schema::create('sale_items', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid'); // client-generated; unique within its sale
            $table->foreignId('sale_id')->constrained('sales')->restrictOnDelete();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->string('product_name');
            $table->string('sku', 64);
            $table->unsignedInteger('quantity');
            $table->unsignedBigInteger('unit_price');
            $table->unsignedBigInteger('server_unit_price')->nullable(); // server price at created_at
            $table->string('discount_type', 16)->nullable();
            $table->unsignedBigInteger('discount_value')->nullable();
            $table->json('discount_approval')->nullable();
            $table->json('price_override')->nullable();
            $table->unsignedBigInteger('line_gross');
            $table->unsignedBigInteger('line_discount');
            $table->unsignedBigInteger('line_total');
            $table->dateTime('created_at');

            $table->unique(['sale_id', 'uuid']);
            $table->index(['product_id', 'sale_id']);
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid');
            $table->foreignId('sale_id')->constrained('sales')->restrictOnDelete();
            $table->enum('method', ['CASH', 'GCASH', 'CARD']);
            $table->unsignedBigInteger('amount');
            $table->unsignedBigInteger('tendered');
            $table->unsignedBigInteger('change_amount'); // `change` is a reserved word in MySQL
            $table->string('reference', 128)->nullable();
            $table->dateTime('created_at');

            $table->unique(['sale_id', 'uuid']);
            $table->index(['sale_id', 'method']);
        });

        Schema::create('sale_voids', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('sale_id')->unique()->constrained('sales')->restrictOnDelete();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->foreignId('voided_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->json('approval')->nullable();
            $table->string('reason');
            $table->dateTime('voided_at');
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->foreignId('synced_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('created_at');
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE sale_items ADD CONSTRAINT chk_sale_items_qty CHECK (quantity > 0)');
            DB::statement('ALTER TABLE sale_items ADD CONSTRAINT chk_sale_items_math CHECK (line_discount <= line_gross AND line_total = line_gross - line_discount)');
            DB::statement('ALTER TABLE sales ADD CONSTRAINT chk_sales_total CHECK (total >= 0 AND total <= subtotal)');
            DB::statement('ALTER TABLE payments ADD CONSTRAINT chk_payments_change CHECK (tendered >= amount)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_voids');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('sale_items');
        Schema::dropIfExists('sales');
    }
};
