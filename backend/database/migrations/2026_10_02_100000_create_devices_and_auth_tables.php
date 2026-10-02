<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('store_id')->constrained('stores')->restrictOnDelete();
            $table->string('code', 32);
            $table->string('name');
            $table->string('type', 32);
            $table->enum('status', ['ACTIVE', 'DISABLED'])->default('ACTIVE');
            $table->foreignId('registered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('registered_at');
            $table->dateTime('last_sync_at')->nullable();
            $table->datetimes();

            $table->unique(['store_id', 'code']);
        });

        // Bind Sanctum access tokens to the device they were issued for and to a refresh-token family.
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->uuid('device_uuid')->nullable()->index();
            $table->uuid('refresh_family_id')->nullable()->index();
        });

        Schema::create('refresh_tokens', function (Blueprint $table) {
            $table->id();
            $table->char('token_hash', 64)->unique(); // sha256 hex of the opaque token; plaintext never stored
            $table->uuid('family_id')->index();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->uuid('device_uuid');
            $table->unsignedBigInteger('access_token_id')->nullable()->index();
            $table->dateTime('expires_at');
            $table->dateTime('revoked_at')->nullable();
            $table->foreignId('replaced_by')->nullable()->constrained('refresh_tokens')->nullOnDelete();
            $table->datetimes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('refresh_tokens');
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropIndex(['device_uuid']);
            $table->dropIndex(['refresh_family_id']);
            $table->dropColumn(['device_uuid', 'refresh_family_id']);
        });
        Schema::dropIfExists('devices');
    }
};
