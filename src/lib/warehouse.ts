/**
 * The warehouse half of the demo: run the statement 0sql planned.
 *
 * This is the part a real deployment replaces. Swap DuckDB for Snowflake,
 * Postgres or BigQuery, change `adapter` in semantic/datasources.yml to match,
 * and nothing else about the app moves — 0sql emits that dialect instead.
 *
 * Statements come from 0sql, which composes them from a deployed model, so
 * there is no string interpolation of user input anywhere in this path.
 */
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { resolve } from 'node:path';
import type { ResultSet } from '@/types';

// turbopackIgnore keeps the bundler from tracing the whole project just
// because the path comes from the environment; it is read at runtime.
const dbPath = resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.DUCKDB_PATH ?? 'warehouse/cs_warehouse.duckdb',
);

/** Rows beyond this are dropped before they reach a chart or the model. */
export const ROW_CAP = 500;

let pending: Promise<DuckDBConnection> | null = null;

function connection(): Promise<DuckDBConnection> {
  // One cached connection per server process. `fromCache` keeps a single
  // instance per file, which matters under Next's dev-mode module reloading.
  pending ??= DuckDBInstance.fromCache(dbPath).then((instance) => instance.connect());
  return pending;
}

export async function runSql(sql: string): Promise<ResultSet> {
  const reader = await (await connection()).runAndReadAll(sql);
  // getRowObjectsJson keeps DECIMAL, BIGINT and DATE legible as JSON: numbers
  // that fit stay numbers, the rest become strings instead of silently losing
  // precision through a float.
  const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
  return {
    columns: reader.columnNames(),
    rows: rows.slice(0, ROW_CAP),
    truncated: rows.length > ROW_CAP,
  };
}

export async function warehouseIsReachable(): Promise<boolean> {
  try {
    await runSql('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export const warehousePath = dbPath;
