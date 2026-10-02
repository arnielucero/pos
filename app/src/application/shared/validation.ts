import type { z } from 'zod';
import { ValidationError } from '../../domain/errors/DomainError';

/** Parses with zod and converts failures into a domain ValidationError with field details. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown, message = 'Invalid input'): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    (details[key] ??= []).push(issue.message);
  }
  const first = result.error.issues[0]?.message;
  throw new ValidationError(first ? `${message}: ${first}` : message, details);
}
