/**
 * The agent loop.
 *
 * Claude writes query specs; 0sql turns them into SQL; we run that SQL and
 * hand the rows back. The loop is deliberately written out rather than hidden
 * behind a helper, because the point of this demo is what travels through it:
 *
 *   model → spec → 0sql → SQL → warehouse → rows → model
 *
 * Two things are never the model's to decide. The security context is attached
 * on the server, from the session, after the spec exists. And the SQL itself is
 * composed by the planner from a deployed model — so a wrong spec is a 422 from
 * 0sql, not a wrong number on a dashboard.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, SecurityContext } from '@/types';
import { runTool, tools, type RanQuery, type ToolContext } from './tools';
import { fieldCatalog } from './catalog';
import { target } from './zsql';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';

/** How many model turns one question may take before we stop. */
const MAX_TURNS = 8;

const client = new Anthropic();

function systemPrompt(catalog: string): string {
  return `You are the analyst behind a customer service analytics dashboard. You answer questions about contact volume, handling time, resolution and cost, and you build dashboard tiles when asked.

You do not write SQL. You write **query specs** and call \`run_query\`; 0sql plans the SQL from the deployed semantic model — it picks the tables, the joins and the grain, and it compiles row-level security into the statement. A spec that the model cannot answer comes back as an error naming what went wrong; read it and try a corrected spec.

How to work:
- Field names must come from the model. The catalogue below is the full list; call \`search_fields\` when you want a field's description, synonyms or exact spelling.
- Measures are already aggregated (\`Contacts\` is a count, \`Talk Duration Secs\` is a sum). Never wrap a measure in an aggregate and never add a GROUP BY — projecting a dimension groups by it.
- For a trend, project the date dimension with a \`truncate\` decorator and order it \`asc\`. For a ranking, order the measure \`desc\` and add a \`top_n\` filter when the user asked for a top N.
- Relative dates are strings: \`28d\`, \`3m\`, \`1y\`. Use them instead of hardcoding today's date.
- Ratios belong in \`calculations\`: \`{"calculation": true, "alias": "SLA Rate", "sql": "[Answered In SLA Count]@m / nullif([Answered Count]@m, 0)"}\`. Reference measures as \`[Name]@m\` and never divide two measures in a projection.
- One \`run_query\` per question the user asked. Run several when they asked for several things.
- After a query returns, say what the numbers show in one or two sentences. Quote the figures. Do not describe the chart; the user can see it.
- Pin a tile only when the user asks for one ("add that", "put it on the dashboard"), using \`pin_tile\` with the \`query_id\` from \`run_query\`.
- If the result is empty, say so and offer the likely reason — a filter with no matching rows, or a cost measure the caller's region does not cover.

Keep prose short and specific. No preamble, no apologies, no restating the question.

The project is \`${target.project}\` on branch \`${target.branch}\`, one fact table (customer service contacts, one row per contact) joined to its call center sites.

# Fields
${catalog}`;
}

export interface AgentRequest {
  /** The conversation so far, oldest first. */
  messages: Anthropic.MessageParam[];
  context: SecurityContext;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

/** Returns the conversation including this turn's tool traffic, to store. */
export async function runAgent({
  messages,
  context,
  emit,
  signal,
}: AgentRequest): Promise<Anthropic.MessageParam[]> {
  const history = [...messages];
  const ran = new Map<string, RanQuery>();
  const toolContext: ToolContext = { context, emit, ran };
  const catalog = await fieldCatalog();

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: 8192,
        // The catalogue and the tool list are the same bytes on every request,
        // so the whole prefix is a cache hit after the first turn.
        system: [
          { type: 'text', text: systemPrompt(catalog), cache_control: { type: 'ephemeral' } },
        ],
        thinking: { type: 'adaptive' },
        // Chat wants an answer, not an essay. Raise this for harder analysis.
        output_config: { effort: 'medium' },
        tools,
        messages: history,
      },
      { signal },
    );

    stream.on('text', (text) => emit({ type: 'text', text }));

    const message = await stream.finalMessage();
    history.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', message: 'The model declined to answer that.' });
      return history;
    }
    if (message.stop_reason !== 'tool_use') return history;

    const calls = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    for (const call of calls) {
      emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
    }

    // Tools run in parallel when the model asked for several, and every result
    // goes back in one user message — splitting them teaches the model to stop
    // calling tools in parallel.
    const results = await Promise.all(
      calls.map(async (call) => {
        const outcome = await runTool(call.name, call.input, toolContext, call.id);
        emit({
          type: 'tool_result',
          id: call.id,
          name: call.name,
          ok: !outcome.isError,
          summary: outcome.summary,
        });
        return {
          type: 'tool_result' as const,
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        };
      }),
    );

    history.push({ role: 'user', content: results });
  }

  emit({
    type: 'error',
    message: `Stopped after ${MAX_TURNS} turns without settling on an answer. Try asking for one thing at a time.`,
  });
  return history;
}
