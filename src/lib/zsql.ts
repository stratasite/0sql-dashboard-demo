/**
 * The 0sql client. Four calls are all this demo needs:
 *
 *   planSql      POST /sql       a query spec in, one SQL statement out
 *   explore      POST /explore   what a spec can add from where it stands
 *   searchFields GET  /fields    the deployed dimensions and measures
 *   listTables   GET  /tables    the deployed tables
 *
 * 0sql never touches the warehouse. It answers with SQL; running it is our job
 * (src/lib/warehouse.ts). The key lives in the server environment and never
 * reaches the browser — everything here runs in a route handler.
 */
import type { Field, QuerySpec, SecurityContext, SqlResponse, Table } from '@/types';

const base = (process.env.ZSQL_API_BASE ?? 'https://app.0sql.io').replace(/\/$/, '');
const project = process.env.ZSQL_PROJECT ?? 'customer-service';
const branch = process.env.ZSQL_BRANCH ?? 'main';

export const target = { base, project, branch };

/** A 0sql error: `{"error": {"class": ..., "message": ...}}` with a status. */
export class ZsqlError extends Error {
  constructor(
    readonly status: number,
    readonly errorClass: string,
    message: string,
  ) {
    super(message);
    this.name = 'ZsqlError';
  }

  /** What the agent sees. The class matters: it says whose fault it is. */
  toString() {
    return `${this.errorClass}: ${this.message}`;
  }
}

function key(): string {
  const value = process.env.ZSQL_QUERY_KEY;
  if (!value) {
    throw new ZsqlError(
      401,
      'Unauthorized',
      'ZSQL_QUERY_KEY is not set. Create a query key in the 0sql console, grant it the project, and put it in .env.local.',
    );
  }
  return value;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}/projects/${project}/branches/${branch}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.error;
    throw new ZsqlError(res.status, error?.class ?? 'Unknown', error?.message ?? res.statusText);
  }
  return body as T;
}

/** Plan a spec into one SQL statement for the branch's datasource. */
export function planSql(spec: QuerySpec, context: SecurityContext): Promise<SqlResponse> {
  return call<SqlResponse>('/sql', { method: 'POST', body: JSON.stringify({ spec, context }) });
}

/** Plan a shorthand line (`call center, contacts desc`) instead of a spec. */
export function planExpr(expr: string, context: SecurityContext): Promise<SqlResponse> {
  return call<SqlResponse>('/sql', { method: 'POST', body: JSON.stringify({ expr, context }) });
}

/** Dimensions and measures a spec can still add, optionally filtered by term. */
export function explore(spec: QuerySpec, q?: string) {
  return call<{ dimensions: Field[]; measures: Field[] }>('/explore', {
    method: 'POST',
    body: JSON.stringify({ spec, ...(q ? { q } : {}) }),
  });
}

/** Search the deployed fields. Best match first; omit `q` for all of them. */
export async function searchFields(q?: string): Promise<Field[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  const { fields } = await call<{ fields: Field[] }>(`/fields${query}`);
  return fields;
}

export async function listTables(): Promise<Table[]> {
  const { tables } = await call<{ tables: Table[] }>('/tables');
  return tables;
}
