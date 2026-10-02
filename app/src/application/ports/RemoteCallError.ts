export type RemoteErrorKind = 'NETWORK' | 'TIMEOUT' | 'HTTP' | 'INVALID_RESPONSE' | 'AUTH_REQUIRED';

/**
 * Error raised by any gateway (HTTP API). `retryable` follows API.md "Retry semantics":
 * network errors, 408, 429 and 5xx are retryable; other 4xx are permanent.
 */
export class RemoteCallError extends Error {
  constructor(
    readonly kind: RemoteErrorKind,
    readonly code: string,
    message: string,
    readonly httpStatus: number | null,
    readonly retryable: boolean,
    readonly details: Readonly<Record<string, readonly string[]>> = {},
  ) {
    super(message);
    this.name = 'RemoteCallError';
  }

  get isNetworkFailure(): boolean {
    return this.kind === 'NETWORK' || this.kind === 'TIMEOUT';
  }
}

export function isRemoteCallError(e: unknown): e is RemoteCallError {
  return e instanceof RemoteCallError;
}
