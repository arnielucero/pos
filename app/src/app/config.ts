import { z } from 'zod';

const envSchema = z.object({
  // Absolute URL, or a same-origin path (e.g. "/api/v1", proxied by the Vite dev server).
  VITE_API_BASE_URL: z.union([z.url(), z.string().regex(/^\/[A-Za-z0-9/_-]*$/)]),
  VITE_APP_ENV: z.enum(['development', 'staging', 'production', 'test']),
});

export interface AppConfig {
  readonly apiBaseUrl: string;
  readonly appEnv: 'development' | 'staging' | 'production' | 'test';
}

/** Validates build-time env (VITE_* values are public — never secrets). */
export function loadConfig(env: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid app configuration (VITE_API_BASE_URL / VITE_APP_ENV)');
  if (parsed.data.VITE_APP_ENV === 'production' && !parsed.data.VITE_API_BASE_URL.startsWith('https://')) {
    throw new Error('Production builds must use an https:// API base URL');
  }
  return { apiBaseUrl: parsed.data.VITE_API_BASE_URL.replace(/\/+$/, ''), appEnv: parsed.data.VITE_APP_ENV };
}
