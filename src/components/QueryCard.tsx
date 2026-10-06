'use client';

/**
 * A query the agent ran, as it appears in the chat: the chart, and underneath
 * it the query that produced it — the spec the model wrote and the SQL 0sql
 * planned from it, in the same disclosure the dashboard tiles use.
 */
import { Check, Pin } from 'lucide-react';
import { ChartView } from './ChartView';
import { QueryDetails } from './QueryDetails';
import type { ChartKind, QuerySpec, ResultSet } from '@/types';

export function QueryCard({
  title,
  chart,
  spec,
  sql,
  result,
  onPin,
  pinned,
}: {
  title: string;
  chart: ChartKind;
  spec: QuerySpec;
  sql: string;
  result: ResultSet;
  onPin?: () => void;
  pinned?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-sm">{title}</h3>
        {onPin && (
          <button
            type="button"
            onClick={onPin}
            disabled={pinned}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-primary hover:text-primary disabled:border-border disabled:text-muted"
          >
            {pinned ? (
              <Check aria-hidden className="size-3.5" />
            ) : (
              <Pin aria-hidden className="size-3.5" />
            )}
            {pinned ? 'pinned' : 'pin to dashboard'}
          </button>
        )}
      </div>

      <ChartView chart={chart} result={result} />

      <QueryDetails spec={spec} sql={sql} />
    </div>
  );
}
