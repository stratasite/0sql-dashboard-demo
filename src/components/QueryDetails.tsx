'use client';

/**
 * The query behind a chart: the spec the model wrote, and the SQL 0sql planned
 * from it. Both are collapsed, and both are the point of the demo, so neither
 * is hidden behind a developer flag.
 *
 * It is shared by the chat card and the dashboard tile deliberately. A tile
 * stores a spec and re-plans on every load, for the user in the header — so the
 * SQL under a tile is not a record of what once ran, it is what runs for *this*
 * caller right now. Switch user and read it again: the `WHERE` clause moves and
 * the spec above it does not. That is the whole argument for a semantic layer,
 * and it is only convincing if you can open it.
 */
import { useState } from 'react';
import type { QuerySpec } from '@/types';

export function QueryDetails({
  spec,
  sql,
  datasource,
  adapter,
}: {
  spec: QuerySpec;
  /** Absent when planning failed — the spec is then the interesting half. */
  sql?: string;
  datasource?: string;
  adapter?: string;
}) {
  const [shown, setShown] = useState<'none' | 'spec' | 'sql'>('none');

  const body = shown === 'spec' ? JSON.stringify(spec, null, 2) : (sql ?? '');
  const where = [adapter, datasource].filter(Boolean).join(' · ');

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <div className="flex gap-3">
          <Tab active={shown === 'spec'} onClick={() => setShown(shown === 'spec' ? 'none' : 'spec')}>
            spec
          </Tab>
          {sql && (
            <Tab active={shown === 'sql'} onClick={() => setShown(shown === 'sql' ? 'none' : 'sql')}>
              planned sql
            </Tab>
          )}
        </div>
        {where && <span className="shrink-0 truncate font-mono text-muted">{where}</span>}
      </div>

      {shown !== 'none' && (
        <div className="relative mt-2">
          <pre className="max-h-80 overflow-auto rounded-lg bg-code-bg p-3 pr-16 font-mono text-[11px] leading-relaxed text-code-text">
            {body}
          </pre>
          <Copy text={body} />
        </div>
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

/** Planned SQL is made to be pasted into a warehouse console. */
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard refused (insecure origin, or the user denied it). Saying
          // "copied" when nothing was would be worse than saying nothing.
        }
      }}
      className="absolute top-2 right-2 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-muted hover:border-primary hover:text-primary"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}
