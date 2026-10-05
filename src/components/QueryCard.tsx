'use client';

/**
 * A query the agent ran, as it appears in the chat: the chart, and underneath
 * it the two artefacts worth seeing — the spec the model wrote, and the SQL
 * 0sql planned from it. Both are collapsed by default and both are the point
 * of the demo, so neither is hidden behind a developer flag.
 */
import { useState } from 'react';
import { ChartView } from './ChartView';
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
  const [shown, setShown] = useState<'none' | 'spec' | 'sql'>('none');

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-sm">{title}</h3>
        {onPin && (
          <button
            type="button"
            onClick={onPin}
            disabled={pinned}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-primary hover:text-primary disabled:border-border disabled:text-muted"
          >
            {pinned ? 'pinned' : 'pin to dashboard'}
          </button>
        )}
      </div>

      <ChartView chart={chart} result={result} />

      <div className="mt-3 flex gap-3 border-t border-border pt-3 text-xs">
        <Tab active={shown === 'spec'} onClick={() => setShown(shown === 'spec' ? 'none' : 'spec')}>
          spec
        </Tab>
        <Tab active={shown === 'sql'} onClick={() => setShown(shown === 'sql' ? 'none' : 'sql')}>
          planned sql
        </Tab>
      </div>

      {shown !== 'none' && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-code-bg p-3 font-mono text-[11px] leading-relaxed text-code-text">
          {shown === 'spec' ? JSON.stringify(spec, null, 2) : sql}
        </pre>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono underline decoration-dotted underline-offset-4 ${
        active ? 'text-primary' : 'text-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
