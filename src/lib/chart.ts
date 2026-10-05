/**
 * Turning a result set into something drawable.
 *
 * The planner tells us nothing about presentation on purpose: a spec is a
 * question, not a chart. So the shape of the answer decides. This module runs
 * on both sides — the route handler picks the chart kind, the component reads
 * the series — so it stays free of Node imports.
 */
import type { ChartKind, ResultSet } from '@/types';

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** DECIMAL and BIGINT arrive as strings so they keep their precision. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && NUMERIC.test(value.trim())) return Number(value);
  return null;
}

function isNumericColumn(result: ResultSet, column: string): boolean {
  const seen = result.rows.filter((r) => r[column] !== null && r[column] !== undefined).slice(0, 25);
  return seen.length > 0 && seen.every((r) => asNumber(r[column]) !== null);
}

/** The category column, every other non-numeric column, and the measures. */
export function series(result: ResultSet): {
  categoryKey: string | null;
  valueKeys: string[];
  extraCategoryKeys: string[];
} {
  const valueKeys = result.columns.filter((c) => isNumericColumn(result, c));
  const categories = result.columns.filter((c) => !valueKeys.includes(c));
  return {
    categoryKey: categories[0] ?? null,
    valueKeys,
    extraCategoryKeys: categories.slice(1),
  };
}

/**
 * Honour the chart the model asked for when the result can carry it, and fall
 * back to a table rather than drawing something misleading.
 */
export function inferChart(wanted: ChartKind, result: ResultSet): ChartKind {
  if (result.rows.length === 0) return 'table';

  const { categoryKey, valueKeys, extraCategoryKeys } = series(result);

  // Two dimensions in one result (week × call center) would need the second
  // pivoted into series to draw honestly. Drawing it as one line instead
  // repeats the x labels and joins points that belong to different sites, so
  // the table is what we show. Pivoting is the obvious next feature.
  if (extraCategoryKeys.length > 0 && wanted !== 'number') return 'table';

  if (wanted === 'number') {
    return result.rows.length === 1 && valueKeys.length >= 1 ? 'number' : 'table';
  }
  if (wanted === 'table') return 'table';

  // Past three series the fixed palette runs out. A fourth hue would be
  // invented, so the table is the honest answer.
  if (valueKeys.length > 3) return 'table';

  // bar / line / area all need one category and at least one measure.
  if (!categoryKey || valueKeys.length === 0) {
    return result.rows.length === 1 && valueKeys.length === 1 ? 'number' : 'table';
  }
  // Too many categories to label legibly; the table is more honest.
  if (result.rows.length > 60 && wanted === 'bar') return 'table';
  return wanted;
}

/** Compact axis and tooltip numbers: 12.4k, 1.2M, 3 dp for small decimals. */
export function formatValue(value: unknown): string {
  const n = asNumber(value);
  if (n === null) return value === null || value === undefined ? '—' : String(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Dates come back as `2026-10-05`; show the day and month on an axis. */
export function formatCategory(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [, month, day] = value.slice(0, 10).split('-');
    return `${day}/${month}`;
  }
  return value === null || value === undefined ? '—' : String(value);
}
