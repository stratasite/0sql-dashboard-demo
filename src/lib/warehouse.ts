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
  //
  // READ_ONLY on purpose. 0sql plans SELECTs and this app runs them, so the
  // write lock would buy nothing — and DuckDB allows one writer per file, so
  // taking it means a second `npm run dev`, or one left running in another
  // terminal, locks the dashboard out. Read-only also refuses to create an
  // empty database when the file is missing, which turns "run npm run seed"
  // into the error you actually get instead of "table not found".
  pending ??= DuckDBInstance.fromCache(dbPath, { access_mode: 'READ_ONLY' }).then((instance) =>
    instance.connect(),
  );
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

/** For the status route: the reason, not just the verdict. */
export async function warehouseCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    await runSql('SELECT 1');
    return { ok: true };
  } catch (error) {
    // The connection promise is cached, so a failed first open would stick for
    // the life of the process. Drop it and let the next call try again.
    pending = null;
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { ok: false, error: message };
  }
}

export const warehousePath = dbPath;
