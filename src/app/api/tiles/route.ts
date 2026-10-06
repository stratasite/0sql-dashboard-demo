/**
 * GET   /api/tiles?user=<id>  — every tile, re-planned and re-run
 * POST  /api/tiles            — pin a tile from a spec
 * PATCH /api/tiles            — reorder: { order: [tile id, ...] }
 *
 * The GET is the clearest statement of what a semantic layer buys you: the
 * dashboard stores four specs, and each load asks 0sql what SQL they mean
 * today, for this caller. Rename a column in the warehouse, change a join,
 * add a security policy — the tiles follow, because none of them hold SQL.
 */
import { addTile, listTiles, reorderTiles } from '@/lib/tiles';
import { planSql, ZsqlError } from '@/lib/zsql';
import { runSql } from '@/lib/warehouse';
import { userById } from '@/lib/users';
import { inferChart } from '@/lib/chart';
import type { ChartKind, QuerySpec, TileData } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = userById(new URL(request.url).searchParams.get('user'));
  const tiles = await listTiles();

  const data = await Promise.all(
    tiles.map(async (tile): Promise<TileData | { tile: typeof tile; error: string }> => {
      try {
        const planned = await planSql(tile.spec, user.context);
        const result = await runSql(planned.sql);
        return {
          tile: { ...tile, chart: inferChart(tile.chart, result) },
          sql: planned.sql,
          datasource: planned.datasource,
          adapter: planned.adapter,
          result,
        };
      } catch (error) {
        return {
          tile,
          error: error instanceof ZsqlError ? error.toString() : String(error),
        };
      }
    }),
  );

  return Response.json({ tiles: data });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string; chart?: ChartKind; spec?: QuerySpec };
  if (!body.title || !body.spec?.projections?.length) {
    return Response.json({ error: 'title and spec.projections are required' }, { status: 400 });
  }
  const tile = await addTile({
    title: body.title,
    chart: body.chart ?? 'table',
    spec: body.spec,
  });
  return Response.json({ tile }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { order?: unknown } | null;
  const order = body?.order;
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
    return Response.json({ error: 'order must be a list of tile ids' }, { status: 400 });
  }
  const tiles = await reorderTiles(order);
  return Response.json({ order: tiles.map((tile) => tile.id) });
}
