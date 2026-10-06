'use client';

/**
 * The chat column.
 *
 * It reads the newline-delimited event stream from /api/chat and lays the turn
 * out in arrival order: what the model said, which tools it reached for, and
 * the queries that came back. The tool trace is deliberately visible — seeing
 * `run_query → 9 rows · duckdb · 612ms` is how you learn what the agent is doing.
 *
 * A question can take ten seconds, most of it a model thinking before it has
 * said a word, so the stream drives a live status line: what phase it is in and
 * how long it has been there. When the turn ends, the same events become a
 * `TracePanel` — timings, context size and token usage, collapsed to one line.
 *
 * Stopping aborts the fetch, which the route turns into an abort of the model
 * call itself. Whatever had already arrived stays on screen, trace included, so
 * a cancelled question still shows what it cost.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, CircleAlert, MessageSquarePlus, Square, Wrench } from 'lucide-react';
import { QueryCard } from './QueryCard';
import { TracePanel } from './TracePanel';
import { compact, duration } from '@/lib/format';
import type { AgentEvent, ChartKind, QuerySpec, ResultSet, TraceStep } from '@/types';

type Entry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; ok?: boolean; summary?: string; ms?: number }
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
  | { kind: 'trace'; id: string; steps: TraceStep[]; totalMs: number }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'error'; id: string; text: string };

/** What the turn is doing right now, for the status line. */
interface Progress {
  phase: string;
  startedAt: number;
  prompt: number;
  output: number;
}

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
  const [progress, setProgress] = useState<Progress | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // The steps of the turn in flight. A ref, because they are rendered once at
  // the end rather than on every event.
  const steps = useRef<TraceStep[]>([]);
  // The question in flight, so it can be stopped. Also the test for whether a
  // turn's late events still belong anywhere: after a reset, they do not.
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries, progress]);

  /** Returning the same object when nothing moved keeps a token from re-rendering. */
  const phase = useCallback((next: string) => {
    setProgress((current) => (current && current.phase !== next ? { ...current, phase: next } : current));
  }, []);

  /** The trace half of an event: timings, tokens, and the phase line. */
  const observe = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case 'step':
          steps.current = [...steps.current, event.step];
          if (event.step.kind === 'model') {
            const usage = event.step.usage;
            phase('thinking');
            setProgress((current) =>
              current && usage
                ? {
                    ...current,
                    prompt: current.prompt + usage.prompt,
                    output: current.output + usage.output,
                  }
                : current,
            );
          }
          break;
        case 'tool_call':
          steps.current = [...steps.current, { kind: 'tool', id: event.id, name: event.name }];
          phase(event.name);
          break;
        case 'tool_result':
          steps.current = steps.current.map((step) =>
            step.kind === 'tool' && step.id === event.id
              ? {
                  ...step,
                  ok: event.ok,
                  ms: event.ms,
                  parts: event.parts,
                  ...(event.ok ? {} : { error: event.summary }),
                }
              : step,
          );
          phase('thinking');
          break;
        case 'text':
          phase('writing');
          break;
      }
    },
    [phase],
  );

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
              ? { ...entry, ok: event.ok, summary: event.summary, ms: event.ms }
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

    const startedAt = Date.now();
    const controller = new AbortController();
    steps.current = [];
    inflight.current = controller;
    setProgress({ phase: 'thinking', startedAt, prompt: 0, output: 0 });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message, userId }),
        signal: controller.signal,
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
          observe(event);
          if (event.type === 'tiles_changed') onTilesChanged();
          else apply(event);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (inflight.current === controller) {
          setEntries((current) => [
            ...current,
            { kind: 'note', id: crypto.randomUUID(), text: 'stopped' },
          ]);
        }
      } else {
        apply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      // A reset took the conversation away while this was in flight; its
      // leftovers belong to a turn that no longer exists.
      const live = inflight.current === controller;
      if (live) inflight.current = null;

      // Total is measured in the browser on purpose: it is the wait the person
      // actually sat through, network and all, not the server's share of it.
      if (live && steps.current.length > 0) {
        const trace: Entry = {
          kind: 'trace',
          id: crypto.randomUUID(),
          steps: steps.current,
          totalMs: Date.now() - startedAt,
        };
        setEntries((current) => [...current, trace]);
      }
      if (live) {
        setProgress(null);
        setBusy(false);
      }
    }
  }

  /** Stop the question in flight. The route aborts the model call with it. */
  function stop() {
    inflight.current?.abort();
  }

  function reset() {
    inflight.current?.abort();
    inflight.current = null;
    steps.current = [];
    setEntries([]);
    setProgress(null);
    setBusy(false);
    setConversationId(crypto.randomUUID());
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
            onClick={reset}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
          >
            <MessageSquarePlus aria-hidden className="size-3.5" />
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
          // A query event carries its tool call's id, so the tool line and the
          // card it produced would otherwise share a key.
          const key = `${entry.kind}:${entry.id}`;
          switch (entry.kind) {
            case 'user':
              return (
                <p
                  key={key}
                  className="ml-auto max-w-[85%] rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap"
                >
                  {entry.text}
                </p>
              );
            case 'assistant':
              return (
                <p key={key} className="max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap">
                  {entry.text}
                </p>
              );
            case 'tool':
              return (
                <p key={key} className="flex items-baseline gap-2 font-mono text-xs text-muted">
                  <Wrench
                    aria-hidden
                    className={`size-3 shrink-0 self-center ${entry.ok === false ? 'text-primary' : ''}`}
                  />
                  <span>
                    <span className={entry.ok === false ? 'text-primary' : undefined}>
                      {entry.name}
                    </span>
                    {entry.summary ? ` → ${entry.summary}` : ' …'}
                    {entry.ms !== undefined && ` · ${duration(entry.ms)}`}
                  </span>
                </p>
              );
            case 'query':
              return (
                <QueryCard
                  key={key}
                  title={entry.title}
                  chart={entry.chart}
                  spec={entry.spec}
                  sql={entry.sql}
                  result={entry.result}
                  pinned={entry.pinned}
                  onPin={() => pin(entry)}
                />
              );
            case 'trace':
              return <TracePanel key={key} steps={entry.steps} totalMs={entry.totalMs} />;
            case 'note':
              return (
                <p key={key} className="font-mono text-xs text-muted">
                  {entry.text}
                </p>
              );
            case 'error':
              return (
                <p
                  key={key}
                  className="flex items-start gap-2 rounded-lg border border-primary/40 bg-surface px-3 py-2 text-sm text-primary"
                >
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{entry.text}</span>
                </p>
              );
          }
        })}

        {progress && <Working progress={progress} />}
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
              if (event.key === 'Escape' && busy) {
                event.preventDefault();
                stop();
              }
            }}
            rows={2}
            placeholder="Ask a question, or say what to put on the dashboard…"
            className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop"
              title="Stop (Esc)"
              className="rounded-lg border border-border p-2.5 text-muted hover:border-primary hover:text-primary"
            >
              <Square aria-hidden className="size-4" fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Ask"
              title="Ask (Enter)"
              className="rounded-lg bg-primary p-2.5 text-primary-foreground disabled:opacity-40"
            >
              <ArrowUp aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

/**
 * The live status line. It owns its own clock so the ticking seconds re-render
 * one paragraph instead of the whole conversation, and it says what is
 * happening rather than just that something is: `run_query · 2.4s`.
 */
function Working({ progress }: { progress: Progress }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, []);

  const elapsed = (Date.now() - progress.startedAt) / 1000;
  const tokens = progress.prompt + progress.output;

  return (
    <p className="flex items-baseline gap-2 font-mono text-xs text-muted">
      <span
        aria-hidden
        className="size-1.5 shrink-0 self-center rounded-full bg-primary motion-safe:animate-pulse"
      />
      <span aria-live="polite" className="text-foreground">
        {progress.phase}
      </span>
      <span aria-hidden className="tabular-nums">
        {elapsed.toFixed(1)}s
      </span>
      {tokens > 0 && (
        <span aria-hidden className="truncate">
          · {compact(tokens)} tokens so far
        </span>
      )}
    </p>
  );
}
