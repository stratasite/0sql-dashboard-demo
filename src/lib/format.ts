/**
 * How the trace prints its numbers. Shared by the panel and the live status
 * line so one turn does not read as `1.2s` in one place and `1200ms` in the
 * other.
 */

/** Sub-millisecond is real — a memoized catalogue hit looks like this. */
export function duration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function exact(count: number): string {
  return count.toLocaleString('en-US');
}

export function compact(count: number): string {
  return count < 10_000 ? exact(count) : `${(count / 1000).toFixed(1)}k`;
}

/**
 * Characters we sent, which for this prompt is also bytes. The space is
 * non-breaking so a narrow column never wraps a number away from its unit.
 */
export function chars(count: number): string {
  return count < 1024 ? `${count}\u00a0B` : `${(count / 1024).toFixed(1)}\u00a0KB`;
}

export function percent(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`;
}
