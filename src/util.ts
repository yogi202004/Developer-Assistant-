import { config } from './config';

export function splitMessage(text: string, max = 1900): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (line.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
      continue;
    }
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > max) { out.push(cur); cur = line; } else cur = next;
  }
  if (cur) out.push(cur);
  return out.length ? out : ['(empty response)'];
}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function fmtDate(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }).format(ms);
}

/** YYYY-MM-DD in the configured timezone */
export function dayKey(ms = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(ms);
}

export function isQuietHours(): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(config.quietHours);
  if (!m) return false;
  const [start, end] = [Number(m[1]), Number(m[2])];
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return start > end ? h >= start || h < end : h >= start && h < end;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** "a@x.com, b@y.com" -> validated, de-duplicated list. Throws on anything invalid. */
export function parseAddresses(input: string): string[] {
  const parts = input.split(/[,;\s]+/).map((s) => s.trim().replace(/^<|>$/g, '')).filter(Boolean);
  const bad = parts.filter((p) => !EMAIL_RE.test(p));
  if (bad.length) throw new Error(`Invalid email address: ${bad.join(', ')}`);
  if (!parts.length) throw new Error('No recipient email address given.');
  return [...new Set(parts.map((p) => p.toLowerCase()))];
}
