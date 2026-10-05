/**
 * The shapes this app passes around. The 0sql ones mirror the API's schemas
 * (see https://0sql.io/docs/api-reference/); the rest are the demo's own.
 */

/** A query spec: what to project, filter and rank. The planner's only input. */
export interface QuerySpec {
  name?: string;
  description?: string;
  limit?: number;
  projections: Projection[];
  calculations?: Projection[];
  filters?: FilterLeaf[];
  segments?: Segment[];
  hints?: string[];
}

export interface Projection {
  field?: string;
  field_type?: 'dimension' | 'measure';
  alias?: string;
  order_by?: 'asc' | 'desc';
  hidden?: boolean;
  decorators?: Decorator[];
  calculation?: boolean;
  sql?: string;
}

export interface Decorator {
  type: 'truncate' | 'extract' | 'window' | 'contribute' | 'temporalize' | 'customize';
  grain?: string;
  extract?: string;
  mode?: 'moving' | 'running';
  function?: string;
  size?: number;
  offset?: number;
  order_by?: Record<string, 'asc' | 'desc'>;
  partition_refs?: string[];
  transform?: string;
  percent_change?: boolean;
  custom_sql?: string;
}

export interface FilterLeaf {
  field: string;
  predicate: string;
  value?: string;
  value_end?: string;
  field_type?: 'dimension' | 'measure';
  top_n_measure?: string;
}

export interface Segment {
  name?: string;
  mode?: 'include' | 'exclude';
  keys: string[];
  measures?: string[];
  filters?: FilterLeaf[];
  apply_to?: string[];
}

/** Who the query is for. Security policies on the branch read this. */
export interface SecurityContext {
  email?: string;
  system_admin?: boolean;
  project_admin?: boolean;
  tags?: string[];
  groups?: { name: string; tags?: string[] }[];
}

export interface SqlResponse {
  sql: string;
  datasource: string;
  datasource_uid: string;
  adapter: string;
  corrections?: { term: string; field_uid: string; field_name: string; score: number }[];
  spec?: QuerySpec;
  items?: string[];
}

export interface Field {
  uid: string;
  name: string;
  kind: 'dimension' | 'measure';
  data_type: string;
  description?: string;
  synonyms?: string[];
  tags?: string[];
  hidden?: boolean;
  tables: string[];
  score?: number;
}

export interface Table {
  uid: string;
  name: string;
  physical_name: string;
  cost: number;
  datasource: string;
  fields: string[];
}

/** A result set from our own warehouse. */
export interface ResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export type ChartKind = 'bar' | 'line' | 'area' | 'number' | 'table';

/**
 * A dashboard tile. It stores the spec, not the SQL: the SQL is re-planned on
 * every load, so a tile follows the model when the model changes.
 */
export interface Tile {
  id: string;
  title: string;
  chart: ChartKind;
  spec: QuerySpec;
  createdAt: string;
}

/** What a tile's data endpoint answers with. */
export interface TileData {
  tile: Tile;
  sql: string;
  datasource: string;
  adapter: string;
  result: ResultSet;
}

/** The events the chat route streams to the browser, one JSON object per line. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'query'; id: string; title: string; chart: ChartKind; spec: QuerySpec; sql: string; result: ResultSet }
  | { type: 'tiles_changed' }
  | { type: 'error'; message: string }
  | { type: 'done' };
