/** Exhaustiveness helper for discriminated unions. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${String(value)}`);
}

export function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}
