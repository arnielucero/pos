import type { FetchFn } from '../../src/infrastructure/api/HttpClient';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

type OpResult = Record<string, unknown>;
type ResultFn = (op: { idempotency_key: string; type: string; payload: Record<string, unknown> }) => OpResult | null;

/** In-process fake of the Laravel API used to drive HttpClient + SyncEngine in Node tests. */
export class FakeApiServer {
  readonly requests: RecordedRequest[] = [];
  down = false;
  status500 = false;
  /** Next N calls with the current access token answer 401 TOKEN_EXPIRED. */
  expireAccessToken = false;
  refreshFails = false;
  accessToken = 'access-1';
  refreshCount = 0;
  serverTime = '2026-10-02T02:00:00Z';
  resultFor: ResultFn = (op) => ({
    idempotency_key: op.idempotency_key,
    status: 'APPLIED',
    http_status: 201,
    entity_uuid: op.payload['uuid'] ?? null,
    server_id: 1000 + this.requests.length,
    conflicts: [],
    error: null,
    retryable: false,
  });
  pullPages: Record<string, unknown>[] = [];

  json(status: number, body: unknown): Response {
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  fetch: FetchFn = (input, init) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/api\/v1/, '') + url.search;
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    this.requests.push({ method: init.method ?? 'GET', path, headers, body });
    if (this.down) return Promise.reject(new TypeError('Failed to fetch'));
    if (this.status500) return Promise.resolve(this.json(500, { error: { code: 'SERVER_ERROR', message: 'boom' } }));

    if (path.startsWith('/auth/refresh')) {
      this.refreshCount += 1;
      if (this.refreshFails) return Promise.resolve(this.json(401, { error: { code: 'UNAUTHENTICATED', message: 'revoked' } }));
      this.accessToken = `access-${String(this.refreshCount + 1)}`;
      this.expireAccessToken = false;
      return Promise.resolve(
        this.json(200, {
          access_token: this.accessToken,
          access_expires_at: '2099-01-01T00:00:00Z',
          refresh_token: `refresh-${String(this.refreshCount + 1)}`,
          refresh_expires_at: '2099-01-01T00:00:00Z',
          user: { uuid: 'u', name: 'n', email: 'e', role: 'CASHIER', permissions: [], store: { uuid: 's', code: 'S', name: 'S' } },
          device: { uuid: 'd', code: 'POS-01', status: 'ACTIVE' },
          offline_policy: { max_offline_hours: 72, max_failed_attempts: 5 },
          server_time: this.serverTime,
        }),
      );
    }
    if (headers['Authorization'] !== `Bearer ${this.accessToken}` || this.expireAccessToken) {
      return Promise.resolve(this.json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }));
    }
    if (path === '/sync' && init.method === 'POST') {
      const ops = (body as { operations: { idempotency_key: string; type: string; payload: Record<string, unknown> }[] }).operations;
      const results = ops.map((op) => this.resultFor(op)).filter((r): r is OpResult => r !== null);
      return Promise.resolve(this.json(200, { results, server_time: this.serverTime }));
    }
    if (path.startsWith('/sync/pull')) {
      const page = Number(url.searchParams.get('page') ?? '1');
      const data = this.pullPages[page - 1] ?? { products: [], inventory: [], approvers: [] };
      return Promise.resolve(
        this.json(200, { server_time: this.serverTime, has_more: page < this.pullPages.length, settings: null, ...data }),
      );
    }
    if (path === '/health') return Promise.resolve(this.json(200, { status: 'ok', server_time: this.serverTime }));
    return Promise.resolve(this.json(404, { error: { code: 'NOT_FOUND', message: 'nope' } }));
  };

  syncCalls(): RecordedRequest[] {
    return this.requests.filter((r) => r.path === '/sync');
  }
}
