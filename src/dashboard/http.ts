/** A JSON API handler. GET handlers receive query parameters, POST handlers the parsed JSON body. */
export type Handler = (input: Record<string, unknown>) => unknown;
/** Keyed by "METHOD /path", e.g. "GET /api/tasks". */
export type Routes = Record<string, Handler>;

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function str(v: unknown, name: string, max = 4000): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${name} is required.`);
  if (v.length > max) throw new HttpError(400, `${name} is too long (max ${max} characters).`);
  return v.trim();
}

export const optStr = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function int(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${name} must be a positive whole number.`);
  return n;
}
