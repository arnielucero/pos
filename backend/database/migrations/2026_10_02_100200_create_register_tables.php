<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('register_sessions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->foreignId('opened_by')->constrained('users')->restrictOnDelete();
            $table->dateTime('opened_at');
            $table->unsignedBigInteger('opening_cash');
            $table->enum('status', ['OPEN', 'CLOSED'])->default('OPEN');
            $table->foreignId('synced_by')->nullable()->constrained('users')->nullOnDelete();
            $table->datetimes();

            $table->index(['store_id', 'status']);
            $table->index(['device_id', 'status']);
        });

        // Closing figures are a separate append-only row (client and server figures side by side).
        Schema::create('register_closures', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('register_session_id')->unique()->constrained('register_sessions')->restrictOnDelete();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->foreignId('closed_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('closed_at');
            $table->unsignedBigInteger('actual_cash');
            $table->bigInteger('client_expected_cash');
            $table->unsignedBigInteger('client_cash_sales');
            $table->unsignedBigInteger('client_cash_refunds');
            $table->bigInteger('client_cash_adjustments');
            $table->bigInteger('client_variance');
            $table->bigInteger('server_expected_cash');
            $table->unsignedBigInteger('server_cash_sales');
            $table->bigInteger('server_variance');
            $table->enum('status', ['RECONCILED', 'FLAGGED']);
            $table->foreignId('synced_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('register_closures');
        Schema::dropIfExists('register_sessions');
    }
};
