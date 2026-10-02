<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->uuid('key');
            $table->string('operation_type', 32);
            $table->char('payload_hash', 64);
            $table->uuid('entity_uuid')->nullable();
            $table->json('result');
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('created_at');

            $table->unique(['store_id', 'key']);
        });

        Schema::create('sync_conflicts', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->string('reference_type', 32); // owning record, e.g. sale / register_closure
            $table->uuid('reference_uuid');
            $table->string('entity_type', 32);   // offending record, e.g. sale_item
            $table->uuid('entity_uuid');
            $table->string('conflict_type', 48);
            $table->string('message')->nullable();
            $table->json('local_payload')->nullable();
            $table->json('server_payload')->nullable();
            $table->enum('resolution_status', ['OPEN', 'RESOLVED', 'DISMISSED'])->default('OPEN');
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('resolved_at')->nullable();
            $table->datetimes();

            $table->index(['store_id', 'resolution_status']);
            $table->index(['reference_type', 'reference_uuid']);
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('action', 64);
            $table->enum('level', ['INFO', 'WARNING', 'SECURITY', 'AUDIT'])->default('INFO');
            $table->enum('source', ['SERVER', 'DEVICE'])->default('SERVER');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->foreignId('store_id')->nullable()->constrained('stores')->nullOnDelete();
            $table->string('entity_type', 32)->nullable();
            $table->uuid('entity_uuid')->nullable();
            $table->json('metadata')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->dateTime('occurred_at');
            $table->dateTime('created_at');

            $table->index(['store_id', 'occurred_at']);
            $table->index(['store_id', 'action']);
            $table->index(['entity_type', 'entity_uuid']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('sync_conflicts');
        Schema::dropIfExists('idempotency_keys');
    }
};
