'use client';

/**
 * The chat column.
 *
 * It reads the newline-delimited event stream from /api/chat and lays the turn
 * out in arrival order: what the model said, which tools it reached for, and
 * the queries that came back. The tool trace is deliberately visible — seeing
 * `run_query → 9 rows · duckdb` is how you learn what the agent is doing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { QueryCard } from './QueryCard';
import type { AgentEvent, ChartKind, QuerySpec, ResultSet } from '@/types';

type Entry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; ok?: boolean; summary?: string }
  | {
      kind: 'query';
      id: string;
      title: string;
      chart: ChartKind;
      spec: QuerySpec;
      sql: string;
      result: ResultSet;
      pinned?: boolean;
    }
  | { kind: 'error'; id: string; text: string };

const SUGGESTIONS = [
  'Which call centers have the longest average handle time?',
  'Contacts per week over the last three months',
  'Top 5 ticket dispositions by volume, and pin it to the dashboard',
  'How does total contact cost split by BPO vendor?',
];

export function Chat({
  userId,
  onTilesChanged,
}: {
  userId: string;
  onTilesChanged: () => void;
}) {
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries]);

  const apply = useCallback((event: AgentEvent) => {
    setEntries((current) => {
      switch (event.type) {
        case 'text': {
          const last = current[current.length - 1];
          if (last?.kind === 'assistant') {
            return [...current.slice(0, -1), { ...last, text: last.text + event.text }];
          }
          return [...current, { kind: 'assistant', id: crypto.randomUUID(), text: event.text }];
        }
        case 'tool_call':
          return [...current, { kind: 'tool', id: event.id, name: event.name }];
        case 'tool_result':
          return current.map((entry) =>
            entry.kind === 'tool' && entry.id === event.id
              ? { ...entry, ok: event.ok, summary: event.summary }
              : entry,
          );
        case 'query':
          return [
            ...current,
            {
              kind: 'query',
              id: event.id,
              title: event.title,
              chart: event.chart,
              spec: event.spec,
              sql: event.sql,
              result: event.result,
            },
          ];
        case 'error':
          return [...current, { kind: 'error', id: crypto.randomUUID(), text: event.message }];
        default:
          return current;
      }
    });
  }, []);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setDraft('');
    setEntries((current) => [...current, { kind: 'user', id: crypto.randomUUID(), text: message }]);
    setBusy(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message, userId }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        apply({ type: 'error', message: detail?.error ?? `The chat route answered ${response.status}.` });
        return;
      }

      // One JSON object per line; a chunk can split a line in half.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AgentEvent;
          if (event.type === 'tiles_changed') onTilesChanged();
          else apply(event);
        }
      }
    } catch (error) {
      apply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function pin(entry: Extract<Entry, { kind: 'query' }>) {
    const response = await fetch('/api/tiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: entry.title, chart: entry.chart, spec: entry.spec }),
    });
    if (!response.ok) return;
    setEntries((current) =>
      current.map((e) => (e.id === entry.id && e.kind === 'query' ? { ...e, pinned: true } : e)),
    );
    onTilesChanged();
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h2 className="font-mono text-sm">ask</h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setEntries([]);
              setConversationId(crypto.randomUUID());
            }}
            className="text-xs text-muted hover:text-foreground"
          >
            new conversation
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {entries.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Ask about contact volume, handling time, resolution or cost. The model writes a 0sql
              query spec, 0sql plans the SQL, this app runs it. Say “pin that” to keep one.
            </p>
            <ul className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => send(s)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:border-primary"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {entries.map((entry) => {
          switch (entry.kind) {
            case 'user':
              return (
                <p
                  key={entry.id}
                  className="ml-auto max-w-[85%] rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap"
                >
                  {entry.text}
                </p>
              );
            case 'assistant':
              return (
                <p key={entry.id} className="max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap">
                  {entry.text}
                </p>
              );
            case 'tool':
              return (
                <p key={entry.id} className="font-mono text-xs text-muted">
                  <span className={entry.ok === false ? 'text-primary' : undefined}>
                    {entry.name}
                  </span>
                  {entry.summary ? ` → ${entry.summary}` : ' …'}
                </p>
              );
            case 'query':
              return (
                <QueryCard
                  key={entry.id}
                  title={entry.title}
                  chart={entry.chart}
                  spec={entry.spec}
                  sql={entry.sql}
                  result={entry.result}
                  pinned={entry.pinned}
                  onPin={() => pin(entry)}
                />
              );
            case 'error':
              return (
                <p
                  key={entry.id}
                  className="rounded-lg border border-primary/40 bg-surface px-3 py-2 text-sm text-primary"
                >
                  {entry.text}
                </p>
              );
          }
        })}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        className="border-t border-border p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={2}
            placeholder="Ask a question, or say what to put on the dashboard…"
            className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
          >
            {busy ? '…' : 'ask'}
          </button>
        </div>
      </form>
    </section>
  );
}
