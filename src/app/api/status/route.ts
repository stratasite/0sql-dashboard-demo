/**
 * GET /api/status — is this clone actually wired up?
 *
 * The UI calls it once on load so a missing key or an unseeded warehouse shows
 * as an instruction instead of a stack trace in a chart.
 */
import { listTables, target, ZsqlError } from '@/lib/zsql';
import { warehouseCheck, warehousePath } from '@/lib/warehouse';
import { providerStatus } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [warehouse, semantic] = await Promise.all([
    warehouseCheck(),
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
    // `llm` is the chat model; `model` is the semantic model. Two different
    // things called "model", so they get different names on the wire.
    llm: providerStatus(),
    warehouse: { ...warehouse, path: warehousePath.replace(process.cwd(), '.') },
    model: semantic,
  });
}
