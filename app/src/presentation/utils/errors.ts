import { RemoteCallError } from '../../application/ports/RemoteCallError';
import { DomainError } from '../../domain/errors/DomainError';

const REMOTE_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  DEVICE_NOT_REGISTERED: 'This device is not registered. A manager must sign in first to register it.',
  DEVICE_DISABLED: 'This device has been disabled by a manager.',
  DEVICE_STORE_MISMATCH: 'This device belongs to a different store.',
  FORBIDDEN: 'You are not allowed to do that.',
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
  NETWORK_ERROR: 'Cannot reach the server. Check the connection.',
  TIMEOUT: 'The server took too long to respond.',
  VALIDATION_FAILED: 'Some information is invalid.',
};

/** Turns any thrown value into a short operator-friendly message (never a stack trace). */
export function toUserMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  if (e instanceof RemoteCallError) {
    if (e.kind === 'AUTH_REQUIRED') return 'Your session has expired. Please sign in again.';
    if (e.kind === 'INVALID_RESPONSE') return 'The server sent an unexpected response. Try again later.';
    if (e.httpStatus !== null && e.httpStatus >= 500) return 'The server had a problem. Try again shortly.';
    return REMOTE_MESSAGES[e.code] ?? e.message;
  }
  return 'Something went wrong. Please try again.';
}
