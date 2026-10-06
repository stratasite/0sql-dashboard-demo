/**
 * The agent loop.
 *
 * The model writes query specs; 0sql turns them into SQL; we run that SQL and
 * hand the rows back. The loop is deliberately written out rather than hidden
 * behind a helper, because the point of this demo is what travels through it:
 *
 *   model → spec → 0sql → SQL → warehouse → rows → model
 *
 * Two things are never the model's to decide. The security context is attached
 * on the server, from the session, after the spec exists. And the SQL itself is
 * composed by the planner from a deployed model — so a wrong spec is a 422 from
 * 0sql, not a wrong number on a dashboard.
 *
 * *Which* model it is turns out to be a detail: the loop talks to a driver
 * (src/lib/providers/), because a query spec is JSON against a published
 * schema, not prose only one vendor can produce.
 *
 * The loop is also where the trace comes from. Every phase is timed and emitted
 * as it finishes — the catalogue fetch, each model turn with what it cost in
 * tokens and how much of the prompt was a cache read, each tool with 0sql
 * planning split from the warehouse. A demo that hides its latency and its
 * token bill is not showing you what running this costs.
 */
import type { AgentEvent, ContextSize, SecurityContext } from '@/types';
import { runTool, toolSpecs, type RanQuery, type ToolContext } from './tools';
import { fieldCatalog } from './catalog';
import { selectDriver, type Driver, type Turn, type TurnResult } from './providers';
import { target } from './zsql';

/** How many model turns one question may take before we stop. */
const MAX_TURNS = 8;

/**
 * Left in the conversation when a question is cancelled. The exchange so far is
 * kept — a chart that already came back is still worth referring to — but the
 * abandoned question has to be closed off explicitly. Left implicit, the next
 * turn reads it as still pending and answers it alongside the new one, which is
 * the opposite of what pressing stop meant.
 */
const STOPPED =
  '[The user stopped that answer. Do not finish it, and do not answer the question that prompted it unless they ask again. Answer only what they ask next.]';

function systemPrompt(catalog: string): string {
  return `You are the analyst behind a customer service analytics dashboard. You answer questions about contact volume, handling time, resolution and cost, and you build dashboard tiles when asked.

You do not write SQL. You write **query specs** and call \`run_query\`; 0sql plans the SQL from the deployed semantic model — it picks the tables, the joins and the grain, and it compiles row-level security into the statement. A spec that the model cannot answer comes back as an error naming what went wrong; read it and try a corrected spec.

How to work:
- Field names must come from the model. The catalogue below lists every measure, and the dimensions of the contact star. It is not the full list: the other tables' dimensions are named but not enumerated, so call \`search_fields\` to reach them, and whenever you want a field's description, synonyms or exact spelling.
- Measures are already aggregated (\`Contacts\` is a count, \`Talk Duration Secs\` is a sum). Never wrap a measure in an aggregate and never add a GROUP BY — projecting a dimension groups by it.
- For a trend, project the date dimension with a \`truncate\` decorator and order it \`asc\`. For a ranking, order the measure \`desc\` and add a \`top_n\` filter when the user asked for a top N.
- Relative dates are strings: \`28d\`, \`3m\`, \`1y\`. Use them instead of hardcoding today's date.
- The rates the business runs on are already measures — AHT Mins, ASA Secs, ART Secs, SLA Rate, Abandon Rate, Escalation Rate, Makegood Rate, Authenticated Rate, Cost Per Contact USD, Cost Per Minute USD. Project those instead of deriving them. They are ratios of sums, computed once over the whole slice; a ratio you build yourself from two totals is right, an average of per-row ratios is not.
- For a ratio the model does *not* publish, use \`calculations\`: \`{"calculation": true, "alias": "KB Articles Per Contact", "sql": "[KB Articles Used Count]@m / nullif([Contacts]@m, 0)"}\`. Reference measures as \`[Name]@m\` and never divide two measures in a projection.
- Agents and Accounts Contacting are distinct counts. They do not add up across a split, so never total them or compare a sum of parts to the whole.
- One \`run_query\` per question the user asked. Run several when they asked for several things.
- After a query returns, say what the numbers show in one or two sentences. Quote the figures. Do not describe the chart; the user can see it.
- Pin a tile only when the user asks for one ("add that", "put it on the dashboard"), using \`pin_tile\` with the \`query_id\` from \`run_query\`.
- If the result is empty, say so and offer the likely reason — a filter with no matching rows, or a cost measure the caller's region does not cover.

Keep prose short and specific. No preamble, no apologies, no restating the question.

The project is \`${target.project}\` on branch \`${target.branch}\`. The centre of it is the contact fact — one row per customer service contact — joined to the site that handled it, the site it was escalated to, the routing skill, the subchannel it arrived on, the transfer type, the customer's country, the agent roster for that day, and whether the customer came back within a week.

Around that sit subject areas you reach only when asked: memberships (accounts, subscriptions, daily membership snapshots), A/B test allocations, and help center traffic. They join through the customer's account and subscription, so "contacts from members on plan X" or "contact rate against the membership base" are answerable; search for their fields first.

# Fields
${catalog}`;
}

export interface AgentRequest {
  /** The conversation so far, oldest first. */
  turns: Turn[];
  context: SecurityContext;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** Defaults to whichever provider is configured. */
  driver?: Driver;
}

/** Returns the conversation including this turn's tool traffic, to store. */
export async function runAgent({
  turns,
  context,
  emit,
  signal,
  driver = selectDriver(),
}: AgentRequest): Promise<Turn[]> {
  const history = [...turns];
  const ran = new Map<string, RanQuery>();
  const toolContext: ToolContext = { context, emit, ran };

  // Memoized for five minutes and byte-identical between requests, so the
  // prompt cache keeps hitting. The trace shows this as ~0ms on every question
  // after the first, which is the point of it being memoized.
  const catalogStart = performance.now();
  const catalog = await fieldCatalog();
  emit({
    type: 'step',
    step: {
      kind: 'app',
      label: 'field catalogue',
      ms: performance.now() - catalogStart,
      detail: 'GET /fields, memoized',
    },
  });

  const system = systemPrompt(catalog);
  const toolChars = JSON.stringify(toolSpecs).length;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const contextSize: ContextSize = {
      system: system.length,
      tools: toolChars,
      history: JSON.stringify(history).length,
      messages: history.length,
    };

    const turnStart = performance.now();
    let result: TurnResult;
    try {
      result = await driver.turn({
        system,
        tools: toolSpecs,
        turns: history,
        onText: (text) => emit({ type: 'text', text }),
        signal,
      });
    } catch (error) {
      // A cancelled question is not a failure, and nothing can be emitted about
      // it: the browser has already gone. Save what happened and stop paying
      // for the rest of an answer nobody will read.
      if (signal?.aborted) return [...history, { role: 'user', text: STOPPED }];
      throw error;
    }

    emit({
      type: 'step',
      step: {
        kind: 'model',
        turn: turn + 1,
        provider: driver.id,
        model: driver.model,
        ms: performance.now() - turnStart,
        firstTokenMs: result.firstTokenMs,
        usage: result.usage,
        context: contextSize,
        calls: result.calls.map((call) => call.name),
      },
    });

    history.push({
      role: 'assistant',
      text: result.text,
      calls: result.calls,
      provider: driver.id,
      raw: result.raw,
    });

    if (result.stopped?.reason === 'refusal') {
      emit({
        type: 'error',
        message: `The model declined to answer that${result.stopped.detail ? `: ${result.stopped.detail}` : '.'}`,
      });
      return history;
    }
    if (result.stopped?.reason === 'error') {
      emit({ type: 'error', message: result.stopped.detail ?? 'The model run failed.' });
      return history;
    }
    if (result.stopped?.reason === 'length' && result.calls.length === 0) {
      emit({ type: 'error', message: 'The answer hit the token ceiling. Ask for less at once.' });
      return history;
    }

    if (result.calls.length === 0) return history;

    for (const call of result.calls) {
      emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
    }

    // Tools run in parallel when the model asked for several, and every result
    // goes back in one turn — a driver that splits them teaches the model to
    // stop calling tools in parallel.
    const results = await Promise.all(
      result.calls.map(async (call) => {
        const started = performance.now();
        const outcome = await runTool(call.name, call.input, toolContext, call.id);
        emit({
          type: 'tool_result',
          id: call.id,
          name: call.name,
          ok: !outcome.isError,
          summary: outcome.summary,
          ms: performance.now() - started,
          ...(outcome.parts ? { parts: outcome.parts } : {}),
        });
        return {
          id: call.id,
          name: call.name,
          content: outcome.content,
          ...(outcome.isError ? { isError: true } : {}),
        };
      }),
    );

    history.push({ role: 'tool', results });
  }

  emit({
    type: 'error',
    message: `Stopped after ${MAX_TURNS} turns without settling on an answer. Try asking for one thing at a time.`,
  });
  return history;
}
