import { useCallback, useMemo, useState } from 'react';
import type { Payment } from '../../domain/entities/Sale';
import { PaymentValidator } from '../../domain/services/payments/PaymentValidator';
import { newUuid } from '../../domain/valueObjects/Uuid';
import { useContainer } from './ContainerContext';

/**
 * Collects (split) payments for a total. All rules come from the registered PaymentMethod
 * strategies — this hook never switches on the method code.
 */
export function usePaymentSession(total: number) {
  const { paymentMethods } = useContainer();
  const [payments, setPayments] = useState<Payment[]>([]);
  const remaining = useMemo(() => PaymentValidator.remaining(total, payments), [total, payments]);
  const change = useMemo(() => payments.reduce((s, p) => s + p.change, 0), [payments]);

  /** Builds and validates a payment; throws PaymentFailedError on invalid input. */
  const build = useCallback(
    (methodCode: string, tendered: number, reference: string | null): Payment => {
      const method = paymentMethods.get(methodCode);
      const count = payments.filter((p) => p.method === methodCode).length;
      if (method.maxPerSale !== null && count >= method.maxPerSale) {
        throw new Error(`Only ${String(method.maxPerSale)} ${method.label} payment allowed.`);
      }
      return method.createPayment({ uuid: newUuid(), tendered, reference }, remaining);
    },
    [paymentMethods, payments, remaining],
  );

  const add = useCallback((p: Payment) => {
    setPayments((list) => [...list, p]);
  }, []);
  const removeAt = useCallback((uuid: string) => {
    setPayments((list) => list.filter((p) => p.uuid !== uuid));
  }, []);
  const reset = useCallback(() => {
    setPayments([]);
  }, []);

  return { payments, remaining, change, build, add, removeAt, reset, methods: paymentMethods.list() };
}
