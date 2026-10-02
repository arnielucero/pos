import type { SqlRow } from '../database/SqlDatabase';

/** Strict row accessors: a schema drift fails loudly instead of producing `undefined` data. */
export function str(row: SqlRow, col: string): string {
  const v = row[col];
  if (typeof v !== 'string') throw new Error(`Column ${col} is not a string`);
  return v;
}

export function strOrNull(row: SqlRow, col: string): string | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Error(`Column ${col} is not a string`);
  return v;
}

export function int(row: SqlRow, col: string): number {
  const v = row[col];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`Column ${col} is not an integer`);
  return v;
}

export function intOrNull(row: SqlRow, col: string): number | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number') throw new Error(`Column ${col} is not a number`);
  return v;
}

export function bool(row: SqlRow, col: string): boolean {
  return int(row, col) !== 0;
}

export function jsonOr<T>(row: SqlRow, col: string, fallback: T, guard: (v: unknown) => v is T): T {
  const raw = strOrNull(row, col);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Escapes LIKE wildcards; use with `ESCAPE '\\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}
