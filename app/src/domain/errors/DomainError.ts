/**
 * Base class for all business-rule errors. `code` is stable and machine readable,
 * `message` is safe to show to an operator (never contains internals or secrets).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(
    message: string,
    readonly details: Readonly<Record<string, string[]>> = {},
  ) {
    super(message);
  }
}

export class InsufficientStockError extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';
  constructor(
    readonly shortages: readonly { productUuid: string; name: string; requested: number; available: number }[],
  ) {
    super(
      `Not enough stock: ${shortages.map((s) => `${s.name} (need ${String(s.requested)}, have ${String(s.available)})`).join(', ')}`,
    );
  }
}

export type PaymentFailureReason =
  | 'TOTAL_MISMATCH'
  | 'INSUFFICIENT_TENDERED'
  | 'DUPLICATE_PAYMENT'
  | 'REFERENCE_REQUIRED'
  | 'TOO_MANY_OF_METHOD'
  | 'INVALID_AMOUNT'
  | 'UNKNOWN_METHOD'
  | 'OVERPAYMENT';

export class PaymentFailedError extends DomainError {
  readonly code = 'PAYMENT_FAILED';
  constructor(
    readonly reason: PaymentFailureReason,
    message: string,
  ) {
    super(message);
  }
}

export type PrinterFailureReason =
  | 'BLUETOOTH_DISABLED'
  | 'PERMISSION_DENIED'
  | 'NOT_CONNECTED'
  | 'TIMEOUT'
  | 'IO_ERROR'
  | 'PAPER_OUT'
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED';

export class PrinterConnectionError extends DomainError {
  readonly code = 'PRINTER_ERROR';
  constructor(
    readonly reason: PrinterFailureReason,
    message: string,
  ) {
    super(message);
  }
}

export class SynchronizationError extends DomainError {
  readonly code = 'SYNC_ERROR';
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class PermissionDeniedError extends DomainError {
  readonly code = 'PERMISSION_DENIED';
  constructor(readonly permission: string) {
    super(`You do not have permission for "${permission}". A manager approval is required.`);
  }
}

export class OfflineSessionExpiredError extends DomainError {
  readonly code = 'OFFLINE_SESSION_EXPIRED';
  constructor() {
    super('Offline sign-in has expired for this user. Connect to the network and sign in online.');
  }
}

export class OfflineLoginNotAllowedError extends DomainError {
  readonly code = 'OFFLINE_LOGIN_NOT_ALLOWED';
  constructor() {
    super('This user has not signed in online on this device recently. Connect to the network to sign in.');
  }
}

export class AccountLockedError extends DomainError {
  readonly code = 'ACCOUNT_LOCKED';
  constructor(message = 'Too many failed attempts. Sign in online or ask a manager.') {
    super(message);
  }
}

export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  constructor(message = 'Incorrect email or password.') {
    super(message);
  }
}

export class ApprovalFailedError extends DomainError {
  readonly code = 'APPROVAL_FAILED';
  constructor(
    message: string,
    readonly remainingAttempts: number | null,
  ) {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
}

export class RegisterNotOpenError extends DomainError {
  readonly code = 'REGISTER_NOT_OPEN';
  constructor() {
    super('No register session is open on this device. Open the register first.');
  }
}

export class InvalidStateError extends DomainError {
  readonly code = 'INVALID_STATE';
}

export class AuthenticationRequiredError extends DomainError {
  readonly code = 'AUTHENTICATION_REQUIRED';
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
  }
}

export class DeviceNotRegisteredError extends DomainError {
  readonly code = 'DEVICE_NOT_REGISTERED';
  constructor(message = 'This device is not registered. A manager must sign in first to register it.') {
    super(message);
  }
}
