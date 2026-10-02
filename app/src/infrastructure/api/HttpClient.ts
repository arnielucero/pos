import type { z } from 'zod';
import type { TokenStore } from '../../application/ports/Credentials';
import type { Logger } from '../../application/ports/Logger';
import { RemoteCallError } from '../../application/ports/RemoteCallError';
import { errorEnvelopeSchema, loginResponseSchema } from './schemas';

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** Typed API error (API.md error envelope) with the contract's retry classification. */
export class ApiError extends RemoteCallError {}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export interface RequestOptions<S extends z.ZodType> {
  readonly body?: unknown;
  readonly schema: S | null;
  readonly auth?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number;
}

export interface HttpClientDeps {
  readonly baseUrl: string;
  readonly fetchFn: FetchFn;
  readonly tokens: TokenStore;
  readonly deviceUuid: () => Promise<string>;
  readonly logger: Logger;
  readonly timeoutMs?: number;
  /** Called when the refresh token is rejected: the user must sign in online again. */
  readonly onAuthLost?: () => void;
  readonly now?: () => Date;
}

/**
 * fetch wrapper: JSON in/out, zod-validated responses, `Authorization` + `X-Device-Id` on
 * every call, request timeout, typed ApiError, and a single-flight token refresh on
 * `401 TOKEN_EXPIRED` (the original request is retried once with the new token).
 */
export class HttpClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(private readonly deps: HttpClientDeps) {}

  async request<S extends z.ZodType>(method: string, path: string, opts: RequestOptions<S>): Promise<z.infer<S>> {
    const auth = opts.auth ?? true;
    if (auth) {
      const tokens = await this.deps.tokens.get();
      if (!tokens) throw new ApiError('AUTH_REQUIRED', 'UNAUTHENTICATED', 'Sign in required', 401, false);
      const now = (this.deps.now ?? (() => new Date()))().getTime();
      if (Date.parse(tokens.accessExpiresAt) <= now) {
        // Proactive refresh of an access token we know is expired.
        await this.refreshOrThrow();
      }
    }
    try {
      return await this.send(method, path, opts, auth);
    } catch (e) {
      if (auth && e instanceof ApiError && e.httpStatus === 401 && e.code === 'TOKEN_EXPIRED') {
        await this.refreshOrThrow();
        return this.send(method, path, opts, auth);
      }
      throw e;
    }
  }

  private async refreshOrThrow(): Promise<void> {
    const ok = await this.refresh();
    if (!ok) throw new ApiError('AUTH_REQUIRED', 'TOKEN_EXPIRED', 'Session expired. Sign in again.', 401, false);
  }

  /** Single-flight refresh. Network failures propagate (retryable) and keep the tokens. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const current = await this.deps.tokens.get();
    if (!current) return false;
    try {
      const res = await this.send(
        'POST',
        '/auth/refresh',
        { schema: loginResponseSchema, body: { refresh_token: current.refreshToken } },
        false,
      );
      await this.deps.tokens.save({
        accessToken: res.access_token,
        accessExpiresAt: res.access_expires_at,
        refreshToken: res.refresh_token,
        refreshExpiresAt: res.refresh_expires_at,
      });
      this.deps.logger.info('Access token refreshed');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.httpStatus !== null && e.httpStatus >= 400 && e.httpStatus < 500 && !e.retryable) {
        this.deps.logger.security('Refresh token rejected; re-login required', { code: e.code });
        await this.deps.tokens.clear();
        this.deps.onAuthLost?.();
        return false;
      }
      throw e;
    }
  }

  private async send<S extends z.ZodType>(
    method: string,
    path: string,
    opts: RequestOptions<S>,
    auth: boolean,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Device-Id': await this.deps.deviceUuid(),
      ...opts.headers,
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const tokens = await this.deps.tokens.get();
      if (!tokens) throw new ApiError('AUTH_REQUIRED', 'UNAUTHENTICATED', 'Sign in required', 401, false);
      headers['Authorization'] = `Bearer ${tokens.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? this.deps.timeoutMs ?? 20_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    // Some fetch implementations (e.g. native HTTP bridges) ignore AbortSignal: race it explicitly.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
    let response: Response;
    try {
      response = await Promise.race([
        this.deps.fetchFn(`${this.deps.baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? null : JSON.stringify(opts.body),
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
        }),
        aborted,
      ]);
    } catch {
      if (timedOut) throw new ApiError('TIMEOUT', 'TIMEOUT', 'The server took too long to respond.', null, true);
      if (opts.signal?.aborted) throw new ApiError('NETWORK', 'ABORTED', 'Request cancelled.', null, true);
      throw new ApiError('NETWORK', 'NETWORK_ERROR', 'Cannot reach the server.', null, true);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    if (response.status === 204) {
      return undefined as z.infer<S>;
    }
    let json: unknown = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!response.ok) {
      const env = errorEnvelopeSchema.safeParse(json);
      const code = env.success ? env.data.error.code : `HTTP_${String(response.status)}`;
      const message = env.success ? env.data.error.message : `Request failed (${String(response.status)})`;
      const details = env.success ? (env.data.error.details ?? {}) : {};
      let kind: 'HTTP' | 'AUTH_REQUIRED' = 'HTTP';
      if (auth && response.status === 401 && code !== 'TOKEN_EXPIRED') kind = 'AUTH_REQUIRED';
      throw new ApiError(kind, code, message, response.status, isRetryableStatus(response.status), details);
    }

    if (!opts.schema) return json as z.infer<S>;
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      this.deps.logger.error('Invalid API response', { path, issues: parsed.error.issues.slice(0, 5) });
      throw new ApiError('INVALID_RESPONSE', 'INVALID_RESPONSE', 'The server sent an unexpected response.', response.status, true);
    }
    return parsed.data as z.infer<S>;
  }
}
