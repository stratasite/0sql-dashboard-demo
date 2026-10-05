/**
 * DELETE /api/tiles/<id> — drop a tile
 * GET    /api/tiles/<id>?user=<id> — re-plan and re-run one tile
 */
import { getTile, removeTile } from '@/lib/tiles';
import { planSql, ZsqlError } from '@/lib/zsql';
import { runSql } from '@/lib/warehouse';
import { userById } from '@/lib/users';
import { inferChart } from '@/lib/chart';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const tile = await getTile(id);
  if (!tile) return Response.json({ error: 'no such tile' }, { status: 404 });

  const user = userById(new URL(request.url).searchParams.get('user'));
  try {
    const planned = await planSql(tile.spec, user.context);
    const result = await runSql(planned.sql);
    return Response.json({
      tile: { ...tile, chart: inferChart(tile.chart, result) },
      sql: planned.sql,
      datasource: planned.datasource,
      adapter: planned.adapter,
      result,
    });
  } catch (error) {
    const message = error instanceof ZsqlError ? error.toString() : String(error);
    return Response.json({ tile, error: message }, { status: 502 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const tile = await removeTile(id);
  if (!tile) return Response.json({ error: 'no such tile' }, { status: 404 });
  return Response.json({ removed: tile.id });
}
