/**
 * GET /api/status — is this clone actually wired up?
 *
 * The UI calls it once on load so a missing key or an unseeded warehouse shows
 * as an instruction instead of a stack trace in a chart.
 */
import { listTables, target, ZsqlError } from '@/lib/zsql';
import { warehouseIsReachable, warehousePath } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [warehouse, model] = await Promise.all([
    warehouseIsReachable(),
    listTables().then(
      (tables) => ({ ok: true as const, tables: tables.length }),
      (error: unknown) => ({
        ok: false as const,
        error: error instanceof ZsqlError ? error.toString() : String(error),
      }),
    ),
  ]);

  return Response.json({
    project: target.project,
    branch: target.branch,
    apiBase: target.base,
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    warehouse: { ok: warehouse, path: warehousePath.replace(process.cwd(), '.') },
    model,
  });
}
