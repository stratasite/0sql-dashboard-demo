'use client';

/**
 * The dashboard column.
 *
 * Every tile is a spec. Loading this panel re-plans all of them against the
 * live model, for the user selected in the header — which is why switching
 * user changes the cost tiles, and why none of this breaks when the warehouse
 * is refactored underneath it.
 *
 * Each tile opens onto the query behind it. That is worth more here than in the
 * chat: the SQL under a tile was planned seconds ago for the current user, so
 * switching user and opening it again is the row-level security policy, visible
 * in the `WHERE` clause, with the spec above it unchanged.
 *
 * Tiles are dragged by the grip in their header, never by the body, so the
 * charts' own pointer handling is left alone. A drop reorders the local list
 * and saves the order; it does not reload, because a reload would re-plan and
 * re-run every tile for a change that touched none of their data.
 */
import { useCallback, useEffect, useState } from 'react';
import { GripVertical, RefreshCw, X } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChartView } from './ChartView';
import { QueryDetails } from './QueryDetails';
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

  // A few pixels of travel before a drag starts, so a click on the grip is
  // still a click; and arrow keys for anyone not using a pointer.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!tiles || !over || active.id === over.id) return;
    const from = tiles.findIndex((t) => t.tile.id === active.id);
    const to = tiles.findIndex((t) => t.tile.id === over.id);
    if (from < 0 || to < 0) return;

    const moved = arrayMove(tiles, from, to);
    setTiles(moved);

    const response = await fetch('/api/tiles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: moved.map((t) => t.tile.id) }),
    });
    if (!response.ok) {
      // The order on screen is now a lie; put the saved one back.
      setFailed('Could not save the tile order.');
      void load();
    }
  }

  const ids = tiles?.map((t) => t.tile.id) ?? [];

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h2 className="font-mono text-sm">dashboard</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
        >
          <RefreshCw aria-hidden className="size-3.5" />
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

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className="grid gap-4 xl:grid-cols-2">
              {tiles?.map((loaded) => (
                <TileCard key={loaded.tile.id} loaded={loaded} onRemove={() => remove(loaded.tile.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}

function TileCard({ loaded, onRemove }: { loaded: Loaded; onRemove: () => void }) {
  const { tile } = loaded;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: tile.id });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl border border-border bg-surface p-4 ${
        isDragging ? 'relative z-10 opacity-80 shadow-lg ring-1 ring-primary' : ''
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Move ${tile.title}`}
            title="Drag to reorder"
            className="-ml-1.5 shrink-0 cursor-grab touch-none rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="size-4" />
          </button>
          <h3 className="truncate font-mono text-sm">{tile.title}</h3>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${tile.title}`}
          title="Remove from dashboard"
          className="shrink-0 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-primary"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      {hasError(loaded) ? (
        // A tile that would not plan still has its spec, and that is
        // exactly what you want to read when 0sql has refused it.
        <>
          <p className="font-mono text-xs text-primary">{loaded.error}</p>
          <QueryDetails spec={tile.spec} />
        </>
      ) : (
        <>
          <ChartView chart={tile.chart} result={loaded.result} height={200} />
          <QueryDetails
            spec={tile.spec}
            sql={loaded.sql}
            datasource={loaded.datasource}
            adapter={loaded.adapter}
          />
        </>
      )}
    </article>
  );
}
