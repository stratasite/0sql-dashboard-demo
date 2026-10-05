/**
 * The agent's tools.
 *
 * The model never writes SQL and never sees a connection string. It writes a
 * *query spec* — the same JSON an application would POST — and 0sql decides
 * what SQL that means: which tables, which joins, which grain, and which rows
 * this caller may see. When the spec is wrong, 0sql says so with a class and a
 * message, that comes back as a tool error, and the model tries again.
 *
 * Zod does double duty here: one schema produces the JSON Schema Claude is
 * given and validates what comes back, so a truncated or malformed tool input
 * is caught before it reaches the API.
 */
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, ChartKind, QuerySpec, SecurityContext } from '@/types';
import { ZsqlError, planSql, searchFields } from './zsql';
import { runSql } from './warehouse';
import { addTile, listTiles, removeTile } from './tiles';
import { inferChart } from './chart';

/* ------------------------------------------------------------------ schemas */

const decorator = z
  .object({
    type: z
      .enum(['truncate', 'extract', 'window', 'contribute', 'temporalize', 'customize'])
      .describe(
        'truncate/extract need a date dimension; window/contribute/temporalize apply to measures.',
      ),
    grain: z
      .enum(['day', 'week', 'month', 'quarter', 'year'])
      .optional()
      .describe('Required by truncate.'),
    extract: z
      .enum(['hour', 'day_of_week', 'day_name', 'week_of_year', 'month', 'month_name', 'quarter', 'year'])
      .optional()
      .describe('Required by extract.'),
    mode: z.enum(['moving', 'running']).optional().describe('Required by window.'),
    function: z
      .enum(['avg', 'sum', 'min', 'max', 'count', 'rank', 'dense_rank', 'lag', 'lead'])
      .optional()
      .describe('Required by window.'),
    size: z.number().int().positive().optional().describe('Rows in a moving window.'),
    transform: z
      .enum(['year_over_year', 'quarter_over_quarter', 'month_over_month', 'week_over_week', 'day_over_day'])
      .optional()
      .describe('Required by temporalize.'),
    percent_change: z
      .boolean()
      .optional()
      .describe('With temporalize, return the % change instead of the prior period.'),
    partition_refs: z
      .array(z.string())
      .optional()
      .describe('Projected dimensions to partition a window or a share by.'),
    custom_sql: z
      .string()
      .optional()
      .describe('Required by customize. SQL around @expression, no aggregates.'),
  })
  .strict();

const projection = z
  .object({
    field: z
      .string()
      .optional()
      .describe('A dimension or measure, by name or uid. Omit only on a calculation.'),
    alias: z.string().optional().describe('The output column name.'),
    order_by: z.enum(['asc', 'desc']).optional(),
    hidden: z.boolean().optional().describe('Compute the column but leave it out of the result.'),
    decorators: z.array(decorator).optional(),
    calculation: z.boolean().optional().describe('true for a formula instead of a field.'),
    sql: z
      .string()
      .optional()
      .describe('A calculation formula over [Name]@m, [Name]@d and [Alias]. Needs alias.'),
  })
  .strict();

const filter = z
  .object({
    field: z.string().describe('The field to filter, by name or uid.'),
    predicate: z.enum([
      'equals',
      'does_not_equal',
      'greater_than',
      'greater_than_or_equal_to',
      'less_than',
      'less_than_or_equal_to',
      'between',
      'in_list',
      'exclude_list',
      'contains',
      'does_not_contain',
      'starts_with',
      'ends_with',
      'is_null',
      'is_not_null',
      'top_n',
    ]),
    value: z
      .string()
      .optional()
      .describe(
        'One value, a comma-separated list for in_list, a date (2026-01-31), or a relative date like 28d / 3m / 1y. N for top_n.',
      ),
    value_end: z.string().optional().describe('The upper bound of between.'),
    top_n_measure: z.string().optional().describe('The measure top_n ranks by.'),
  })
  .strict();

const segment = z
  .object({
    name: z.string().optional(),
    mode: z.enum(['include', 'exclude']).optional().describe('include keeps members, exclude drops them.'),
    keys: z.array(z.string()).min(1).describe('Dimensions identifying the members, the join grain.'),
    measures: z.array(z.string()).optional().describe('Measures whose facts define membership.'),
    filters: z.array(filter).optional(),
    apply_to: z.array(z.string()).optional().describe('Measure aliases this segment constrains.'),
  })
  .strict();

const spec = z
  .object({
    name: z.string().optional().describe('A short name for the query.'),
    projections: z.array(projection).min(1).describe('The columns, in order. At least one.'),
    calculations: z.array(projection).optional().describe('Formulas, appended after the projections.'),
    filters: z.array(filter).optional().describe('Conditions, ANDed together.'),
    segments: z.array(segment).optional().describe('Populations that constrain the query.'),
    limit: z.number().int().positive().max(5000).optional(),
  })
  .strict();

const chart = z
  .enum(['bar', 'line', 'area', 'number', 'table'])
  .describe('number for a single value, line/area over a date, bar for categories, table otherwise.');

const schemas = {
  search_fields: z
    .object({
      query: z
        .string()
        .describe('A word or two: "cost", "handle time", "region". Matches names, uids and synonyms.'),
      kind: z.enum(['dimension', 'measure']).optional().describe('Keep only one kind.'),
    })
    .strict(),

  run_query: z
    .object({
      title: z.string().describe('A short title, as it would read on a dashboard tile.'),
      chart,
      spec,
    })
    .strict(),

  pin_tile: z
    .object({
      query_id: z.string().describe('The query_id returned by run_query.'),
      title: z.string().optional().describe('Override the title the query ran under.'),
    })
    .strict(),

  list_tiles: z.object({}).strict(),

  remove_tile: z.object({ tile_id: z.string() }).strict(),
} as const;

export type ToolName = keyof typeof schemas;

/* -------------------------------------------------------------- definitions */

function define(name: ToolName, description: string): Anthropic.Tool {
  return {
    name,
    description,
    input_schema: z.toJSONSchema(schemas[name], { target: 'draft-7' }) as Anthropic.Tool.InputSchema,
    // The spec argument can be long. Stream it as it is generated rather than
    // waiting for the server to buffer the whole thing; Zod validates what
    // arrives, so a truncated input is caught rather than planned.
    eager_input_streaming: true,
  };
}

export const tools: Anthropic.Tool[] = [
  define(
    'search_fields',
    'Search the deployed semantic model for dimensions and measures. Returns names, kinds, data types, descriptions and synonyms. Use it before writing a spec: field names must come from the model, never from memory.',
  ),
  define(
    'run_query',
    'Plan a query spec with 0sql, run the SQL it returns against the warehouse, and show the result to the user as a chart. Returns the planned SQL, the column names and the first rows so you can read the answer. This is how you answer any question about the data.',
  ),
  define(
    'pin_tile',
    'Pin a query you have already run onto the dashboard as a tile. The tile stores the spec, so it re-plans on every load.',
  ),
  define('list_tiles', 'List the tiles currently on the dashboard, with their ids and titles.'),
  define('remove_tile', 'Remove a tile from the dashboard by id.'),
];

/* ----------------------------------------------------------------- executors */

export interface RanQuery {
  title: string;
  chart: ChartKind;
  spec: QuerySpec;
  sql: string;
}

export interface ToolContext {
  /** Who the query is for. Set on the server from the session, never by the model. */
  context: SecurityContext;
  emit: (event: AgentEvent) => void;
  /** Queries run during this turn, so pin_tile can name one without resending it. */
  ran: Map<string, RanQuery>;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** One line for the UI's tool trace. */
  summary: string;
}

const SQL_IN_RESULT = 2000;

export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  callId: string,
): Promise<ToolOutcome> {
  const schema = schemas[name as ToolName];
  if (!schema) return { content: `No tool named ${name}.`, isError: true, summary: 'unknown tool' };

  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    // Covers both a model mistake and an input truncated by max_tokens.
    return {
      content: `Those arguments did not validate:\n${z.prettifyError(parsed.error)}`,
      isError: true,
      summary: 'invalid arguments',
    };
  }
  const input = parsed.data;

  try {
    switch (name) {
      case 'search_fields': {
        const { query, kind } = input as z.infer<typeof schemas.search_fields>;
        let fields = await searchFields(query);
        if (kind) fields = fields.filter((f) => f.kind === kind);
        const top = fields.slice(0, 25).map((f) => ({
          name: f.name,
          kind: f.kind,
          type: f.data_type,
          ...(f.description ? { description: f.description } : {}),
          ...(f.synonyms?.length ? { synonyms: f.synonyms } : {}),
          ...(f.tags?.length ? { tags: f.tags } : {}),
        }));
        return {
          content: top.length
            ? JSON.stringify(top)
            : `No field matches "${query}". Try a broader word, or list what exists with a single common term like "contact".`,
          summary: `${top.length} field${top.length === 1 ? '' : 's'} for “${query}”`,
        };
      }

      case 'run_query': {
        const { title, chart: wanted, spec: querySpec } = input as z.infer<typeof schemas.run_query>;
        const planned = await planSql(querySpec as QuerySpec, ctx.context);
        const result = await runSql(planned.sql);
        const kind = inferChart(wanted, result);

        ctx.ran.set(callId, { title, chart: kind, spec: querySpec as QuerySpec, sql: planned.sql });
        ctx.emit({
          type: 'query',
          id: callId,
          title,
          chart: kind,
          spec: querySpec as QuerySpec,
          sql: planned.sql,
          result,
        });

        const preview = result.rows.slice(0, 12);
        return {
          content: JSON.stringify({
            query_id: callId,
            datasource: planned.datasource,
            adapter: planned.adapter,
            sql: planned.sql.slice(0, SQL_IN_RESULT),
            columns: result.columns,
            row_count: result.rows.length,
            rows: preview,
            ...(result.rows.length > preview.length
              ? { note: `${result.rows.length} rows returned, first ${preview.length} shown; the user sees all of them.` }
              : {}),
            ...(planned.corrections?.length
              ? { corrections: planned.corrections.map((c) => `${c.term} → ${c.field_name}`) }
              : {}),
          }),
          summary: `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} · ${planned.adapter}`,
        };
      }

      case 'pin_tile': {
        const { query_id, title } = input as z.infer<typeof schemas.pin_tile>;
        const query = ctx.ran.get(query_id);
        if (!query) {
          return {
            content: `No query with id ${query_id} ran this turn. Run the query first, then pin the query_id it returns.`,
            isError: true,
            summary: 'unknown query_id',
          };
        }
        const tile = await addTile({
          title: title ?? query.title,
          chart: query.chart,
          spec: query.spec,
        });
        ctx.emit({ type: 'tiles_changed' });
        return {
          content: JSON.stringify({ tile_id: tile.id, title: tile.title, chart: tile.chart }),
          summary: `pinned “${tile.title}”`,
        };
      }

      case 'list_tiles': {
        const tiles = await listTiles();
        return {
          content: JSON.stringify(
            tiles.map((t) => ({ tile_id: t.id, title: t.title, chart: t.chart })),
          ),
          summary: `${tiles.length} tile${tiles.length === 1 ? '' : 's'}`,
        };
      }

      case 'remove_tile': {
        const { tile_id } = input as z.infer<typeof schemas.remove_tile>;
        const tile = await removeTile(tile_id);
        if (!tile) {
          return {
            content: `No tile with id ${tile_id}. Call list_tiles for the current ids.`,
            isError: true,
            summary: 'unknown tile',
          };
        }
        ctx.emit({ type: 'tiles_changed' });
        return { content: `Removed “${tile.title}”.`, summary: `removed “${tile.title}”` };
      }

      default:
        return { content: `No tool named ${name}.`, isError: true, summary: 'unknown tool' };
    }
  } catch (error) {
    if (error instanceof ZsqlError) {
      // The interesting case: 0sql refused the spec. The class says why, and
      // the model can usually fix it on the next turn.
      return {
        content: `0sql refused this request — ${error.errorClass}: ${error.message}`,
        isError: true,
        summary: error.errorClass,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { content: `The tool failed: ${message}`, isError: true, summary: 'failed' };
  }
}
