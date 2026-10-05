/**
 * The OpenAI driver, on the Responses API.
 *
 * It exists to make a point the demo could otherwise only assert: the agent's
 * output is a query spec against a published JSON Schema, so any model that
 * can call a function can drive the semantic layer, and the guarantees — joins,
 * grain, dialect, row-level security — do not move when the model does.
 *
 * `store: false`, so nothing is retained on OpenAI's side; the whole
 * conversation is re-sent each turn, which is what the loop does anyway.
 * Reasoning items are dropped on replay rather than round-tripped, since
 * carrying them with `store: false` needs encrypted-content handling the demo
 * does not need.
 */
import OpenAI from 'openai';
import type { Responses } from 'openai/resources/responses/responses';
import type { Driver, ToolCall, ToolSpec, Turn, TurnRequest, TurnResult } from './types';

const DEFAULT_MODEL = 'gpt-5.1';

export function openaiDriver(): Driver {
  const client = new OpenAI();
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;

  return {
    id: 'openai',
    model,

    async turn({ system, tools, turns, onText, signal }: TurnRequest): Promise<TurnResult> {
      const stream = await client.responses.create(
        {
          model,
          instructions: system,
          input: toInput(turns),
          tools: tools.map(toTool),
          max_output_tokens: 16000,
          reasoning: { effort: 'medium' },
          store: false,
          stream: true,
        },
        { signal },
      );

      let final: Responses.Response | undefined;
      let failure: string | undefined;

      for await (const event of stream) {
        switch (event.type) {
          case 'response.output_text.delta':
            onText(event.delta);
            break;
          case 'response.completed':
          case 'response.incomplete':
            final = event.response;
            break;
          case 'response.failed':
            final = event.response;
            failure = event.response.error?.message ?? 'the model run failed';
            break;
          case 'error':
            failure = event.message;
            break;
        }
      }

      const output = final?.output ?? [];

      const calls: ToolCall[] = [];
      for (const item of output) {
        if (item.type !== 'function_call') continue;
        calls.push({
          id: item.call_id,
          name: item.name,
          // Arguments arrive as a JSON string; a truncated run can leave it
          // unparseable, which the loop reports as an invalid tool input.
          input: parseArguments(item.arguments),
        });
      }

      const text = output
        .filter((item): item is Responses.ResponseOutputMessage => item.type === 'message')
        .flatMap((item) => item.content)
        .filter((part): part is Responses.ResponseOutputText => part.type === 'output_text')
        .map((part) => part.text)
        .join('');

      const refusal = output
        .filter((item): item is Responses.ResponseOutputMessage => item.type === 'message')
        .flatMap((item) => item.content)
        .find((part) => part.type === 'refusal');

      return {
        text,
        calls,
        raw: output,
        stopped: failure
          ? { reason: 'error', detail: failure }
          : refusal && refusal.type === 'refusal'
            ? { reason: 'refusal', detail: refusal.refusal }
            : final?.incomplete_details?.reason === 'max_output_tokens'
              ? { reason: 'length' }
              : undefined,
      };
    },
  };
}

/** `{}` keeps the failure in one place: Zod rejects it and the model retries. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toTool(tool: ToolSpec): Responses.FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.schema,
    // Not strict mode: the spec schema has optional keys, and strict mode
    // wants every property listed in `required`. Zod validates the arguments
    // when they come back, which is the check that actually matters.
    strict: false,
  };
}

function toInput(turns: Turn[]): Responses.ResponseInput {
  const input: Responses.ResponseInput = [];

  for (const turn of turns) {
    if (turn.role === 'user') {
      input.push({ role: 'user', content: turn.text });
      continue;
    }

    if (turn.role === 'tool') {
      for (const result of turn.results) {
        input.push({
          type: 'function_call_output',
          call_id: result.id,
          // The Responses API takes one string; an error is marked in the text
          // rather than a flag, so say so plainly.
          output: result.isError ? `error: ${result.content}` : result.content,
        });
      }
      continue;
    }

    if (turn.provider === 'openai' && Array.isArray(turn.raw)) {
      for (const item of turn.raw as Responses.ResponseOutputItem[]) {
        if (item.type === 'reasoning') continue;
        input.push(item as Responses.ResponseInputItem);
      }
      continue;
    }

    // A turn another provider produced, or one whose items we did not keep.
    if (turn.text) input.push({ role: 'assistant', content: turn.text });
    for (const call of turn.calls) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input),
      });
    }
  }

  return input;
}
