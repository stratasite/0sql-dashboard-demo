'use client';

/**
 * What the turn cost, collapsed to one line.
 *
 * The demo already shows the spec and the planned SQL, because they are what
 * the agent actually produced. This is the other half of being honest about it:
 * where the seconds went, how big the prompt had grown, how much of it was a
 * cache read, and how many tokens the answer burned. Click to open it.
 *
 * Every number here is measured, not estimated — the timings come from the
 * server as each phase finishes, the token counts from whichever provider ran
 * the turn. A phase with nothing to report shows nothing rather than a zero.
 */
import { ChevronRight } from 'lucide-react';
import { chars, compact, duration, exact, percent } from '@/lib/format';
import type { ModelStep, TokenUsage, ToolStep, TraceStep } from '@/types';

export function TracePanel({ steps, totalMs }: { steps: TraceStep[]; totalMs: number }) {
  const models = steps.filter((step): step is ModelStep => step.kind === 'model');
  const tools = steps.filter((step): step is ToolStep => step.kind === 'tool');

  const counted = models.filter((step) => step.usage);
  const prompt = sum(counted.map((step) => step.usage?.prompt ?? 0));
  const output = sum(counted.map((step) => step.usage?.output ?? 0));
  const cached = sum(counted.map((step) => step.usage?.cacheRead ?? 0));

  const modelMs = sum(models.map((step) => step.ms));
  const toolMs = sum(tools.map((step) => step.ms ?? 0));

  const headline = [
    duration(totalMs),
    `${models.length} model turn${models.length === 1 ? '' : 's'}`,
    counted.length > 0 ? `${compact(prompt)} prompt / ${compact(output)} out` : null,
  ].filter(Boolean);

  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3 py-2 font-mono text-xs text-muted hover:text-foreground">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 self-center transition-transform group-open:rotate-90"
        />
        <span>trace</span>
        <span>·</span>
        <span className="min-w-0 flex-1 truncate">{headline.join(' · ')}</span>
      </summary>

      <div className="space-y-2 border-t border-border px-3 py-3 font-mono text-[11px] leading-relaxed">
        {steps.map((step, index) => (
          <Step key={index} step={step} />
        ))}

        <div className="space-y-0.5 border-t border-border pt-2">
          <Row label="total" value={duration(totalMs)} strong />
          <Detail>
            model {duration(modelMs)} · tools {duration(toolMs)}
            {totalMs > modelMs + toolMs ? ` · elsewhere ${duration(totalMs - modelMs - toolMs)}` : ''}
          </Detail>
          {counted.length > 0 && (
            <Detail>
              {exact(prompt)} prompt tokens
              {cached > 0 ? ` (${percent(cached, prompt)} from cache)` : ''} · {exact(output)} output
            </Detail>
          )}
        </div>
      </div>
    </details>
  );
}

function Step({ step }: { step: TraceStep }) {
  if (step.kind === 'app') {
    return (
      <div>
        <Row label={step.label} value={duration(step.ms)} />
        {step.detail && <Detail>{step.detail}</Detail>}
      </div>
    );
  }

  if (step.kind === 'tool') {
    return (
      <div>
        <Row
          label={`tool ${step.name}`}
          value={step.ms === undefined ? '…' : duration(step.ms)}
          failed={step.ok === false}
        />
        {step.error && <Detail>{step.error}</Detail>}
        {step.parts && step.parts.length > 0 && (
          <Detail>
            {step.parts.map((part) => `${part.label} ${duration(part.ms)}`).join(' · ')}
          </Detail>
        )}
      </div>
    );
  }

  const { usage, context } = step;

  return (
    <div>
      <Row label={`model turn ${step.turn} · ${step.model}`} value={duration(step.ms)} />
      <Detail>
        {step.firstTokenMs !== undefined ? `first token ${duration(step.firstTokenMs)}` : 'no stream'}
        {step.calls.length > 0 ? ` · asked for ${step.calls.join(', ')}` : ' · answered'}
      </Detail>
      {usage && <Detail>{tokens(usage)}</Detail>}
      <Detail>
        context {chars(context.system + context.tools + context.history)} sent — system{' '}
        {chars(context.system)} · tools {chars(context.tools)} · conversation{' '}
        {chars(context.history)} over {context.messages} message
        {context.messages === 1 ? '' : 's'}
      </Detail>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  failed,
}: {
  label: string;
  value: string;
  strong?: boolean;
  failed?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? '' : 'text-foreground'}`}>
      <span className={`min-w-0 truncate ${failed ? 'text-primary' : ''}`}>{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

function Detail({ children }: { children: React.ReactNode }) {
  return <p className="pl-3 text-muted">{children}</p>;
}

/* ----------------------------------------------------------------- formatting */

function tokens(usage: TokenUsage): string {
  const parts = [`prompt ${exact(usage.prompt)}`];
  if (usage.cacheRead) parts.push(`cache read ${exact(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`cache write ${exact(usage.cacheWrite)}`);
  parts.push(`output ${exact(usage.output)}`);
  if (usage.reasoning) parts.push(`of it reasoning ${exact(usage.reasoning)}`);
  return parts.join(' · ');
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
