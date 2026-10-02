import { z } from 'zod';

/** Zod schemas for every API response consumed by the client (docs/API.md). */

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.array(z.string())).optional().nullable(),
  }),
});

const storeSchema = z.object({ uuid: z.string(), code: z.string(), name: z.string() });

export const userSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
  store: storeSchema,
});

export const deviceSchema = z.object({
  uuid: z.string(),
  code: z.string(),
  status: z.string(),
  name: z.string().optional(),
  store_uuid: z.string().optional(),
});

export const loginResponseSchema = z.object({
  access_token: z.string().min(1),
  access_expires_at: z.string(),
  refresh_token: z.string().min(1),
  refresh_expires_at: z.string(),
  user: userSchema,
  device: deviceSchema.nullable(),
  offline_policy: z
    .object({ max_offline_hours: z.number().positive(), max_failed_attempts: z.number().int().positive() })
    .default({ max_offline_hours: 72, max_failed_attempts: 5 }),
  server_time: z.string(),
});
export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

export const registerDeviceResponseSchema = z.object({
  data: z.object({
    uuid: z.string(),
    code: z.string(),
    name: z.string().optional(),
    status: z.string(),
    store_uuid: z.string().optional(),
    registered_at: z.string().optional(),
  }),
});

const productSchema = z.object({
  uuid: z.string(),
  sku: z.string(),
  barcode: z.string().nullable().optional(),
  name: z.string(),
  category: z.string().nullable().optional(),
  price: z.number().int().min(0),
  is_active: z.boolean(),
  track_stock: z.boolean(),
  updated_at: z.string(),
  deleted: z.boolean().default(false),
});

export const pullResponseSchema = z.object({
  server_time: z.string(),
  has_more: z.boolean(),
  products: z.array(productSchema).default([]),
  inventory: z
    .array(z.object({ product_uuid: z.string(), quantity_on_hand: z.number().int(), updated_at: z.string() }))
    .default([]),
  approvers: z
    .array(
      z.object({
        user_uuid: z.string(),
        name: z.string(),
        permissions: z.array(z.string()),
        pin_hash: z.string(),
        is_active: z.boolean(),
      }),
    )
    .default([]),
  settings: z
    .object({
      tax_rate_bp: z.number().int().min(0).optional(),
      currency: z.string().optional(),
      receipt_header: z.string().optional(),
      receipt_footer: z.string().optional(),
      max_discount_bp: z.number().int().min(0).max(10000).optional(),
      offline_max_hours: z.number().positive().optional(),
    })
    .nullable()
    .optional(),
});
export type PullResponseDto = z.infer<typeof pullResponseSchema>;

export const pushResponseSchema = z.object({
  results: z.array(
    z.object({
      idempotency_key: z.string(),
      status: z.enum(['APPLIED', 'DUPLICATE', 'FLAGGED', 'REJECTED']),
      original_status: z.enum(['APPLIED', 'DUPLICATE', 'FLAGGED', 'REJECTED']).nullable().optional(),
      http_status: z.number().int().nullable().optional(),
      entity_uuid: z.string().nullable().optional(),
      server_id: z.number().int().nullable().optional(),
      conflicts: z
        .array(
          z.object({
            type: z.string(),
            entity_type: z.string().nullable().optional(),
            entity_uuid: z.string().nullable().optional(),
            local_value: z.unknown().optional(),
            server_value: z.unknown().optional(),
            message: z.string().nullable().optional(),
          }),
        )
        .nullable()
        .optional(),
      error: z.object({ code: z.string(), message: z.string() }).nullable().optional(),
      retryable: z.boolean().default(false),
    }),
  ),
  server_time: z.string(),
});

export const healthSchema = z.object({ status: z.string(), server_time: z.string().optional() });
