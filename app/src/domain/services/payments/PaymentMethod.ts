import type { Payment } from '../../entities/Sale';

/** Input collected by the payment dialog for one tender. All centavos. */
export interface PaymentInput {
  readonly uuid: string;
  /** For cash: the amount handed over. For non-cash: the amount charged. */
  readonly tendered: number;
  readonly reference?: string | null | undefined;
}

/**
 * Open/Closed payment strategy. New methods (e.g. Maya, vouchers) are added by registering a
 * new implementation in the PaymentMethodRegistry — checkout code never switches on `code`.
 */
export interface PaymentMethod {
  readonly code: string;
  readonly label: string;
  readonly requiresReference: boolean;
  /** Whether this method may produce change (only cash, per contract). */
  readonly producesChange: boolean;
  /** Max number of payments of this method in one sale (null = unlimited). */
  readonly maxPerSale: number | null;
  /** Builds a payment line applying at most `remainingDue` to the sale. */
  createPayment(input: PaymentInput, remainingDue: number): Payment;
  /** Validates a single payment line in isolation. Throws PaymentFailedError. */
  validate(payment: Payment): void;
}
