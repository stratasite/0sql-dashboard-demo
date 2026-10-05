'use client';

/**
 * The dashboard column.
 *
 * Every tile is a spec. Loading this panel re-plans all of them against the
 * live model, for the user selected in the header — which is why switching
 * user changes the cost tiles, and why none of this breaks when the warehouse
 * is refactored underneath it.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChartView } from './ChartView';
import type { Tile, TileData } from '@/types';

type Loaded = TileData | { tile: Tile; error: string };

const hasError = (t: Loaded): t is { tile: Tile; error: string } => 'error' in t;

export function Dashboard({ userId, version }: { userId: string; version: number }) {
  const [tiles, setTiles] = useState<Loaded[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const response = await fetch(`/api/tiles?user=${encodeURIComponent(userId)}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `tiles answered ${response.status}`);
      setTiles(body.tiles as Loaded[]);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      setTiles([]);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function remove(id: string) {
    await fetch(`/api/tiles/${id}`, { method: 'DELETE' });
    void load();
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h2 className="font-mono text-sm">dashboard</h2>
        <button type="button" onClick={() => void load()} className="text-xs text-muted hover:text-foreground">
          re-plan
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {failed && <p className="mb-4 text-sm text-primary">{failed}</p>}

        {tiles === null && <p className="text-sm text-muted">Planning tiles…</p>}

        {tiles?.length === 0 && !failed && (
          <p className="text-sm text-muted">
            No tiles. Ask a question and say “pin that”, or use the pin button on a result.
          </p>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          {tiles?.map((loaded) => (
            <article
              key={loaded.tile.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm">{loaded.tile.title}</h3>
                <button
                  type="button"
                  onClick={() => remove(loaded.tile.id)}
                  aria-label={`Remove ${loaded.tile.title}`}
                  className="shrink-0 text-xs text-muted hover:text-primary"
                >
                  remove
                </button>
              </div>

              {hasError(loaded) ? (
                <p className="font-mono text-xs text-primary">{loaded.error}</p>
              ) : (
                <ChartView chart={loaded.tile.chart} result={loaded.result} height={200} />
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
