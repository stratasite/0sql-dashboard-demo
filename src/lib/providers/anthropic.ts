/**
 * The Claude driver — the demo's default.
 *
 * Adaptive thinking is on, effort is `medium` because a chat answer is not an
 * essay, and the system prompt carries a cache breakpoint: the field catalogue
 * and the tool definitions are the same bytes every request, so after the
 * first turn the bulk of the prompt is a cache read.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Driver, ToolCall, ToolSpec, Turn, TurnRequest, TurnResult } from './types';

const DEFAULT_MODEL = 'claude-opus-5';

export function anthropicDriver(): Driver {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  return {
    id: 'anthropic',
    model,

    async turn({ system, tools, turns, onText, signal }: TurnRequest): Promise<TurnResult> {
      const stream = client.messages.stream(
        {
          model,
          // Thinking tokens count against this, and a spec is a long tool
          // input; 16k leaves room so a turn is never truncated mid-argument.
          max_tokens: 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          tools: tools.map(toTool),
          messages: toMessages(turns),
        },
        { signal },
      );

      stream.on('text', onText);
      const message = await stream.finalMessage();

      const calls: ToolCall[] = message.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map((block) => ({ id: block.id, name: block.name, input: block.input }));

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        calls,
        raw: message.content,
        stopped:
          message.stop_reason === 'refusal'
            ? { reason: 'refusal', detail: message.stop_details?.explanation ?? undefined }
            : message.stop_reason === 'max_tokens'
              ? { reason: 'length' }
              : undefined,
      };
    },
  };
}

function toTool(tool: ToolSpec): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.schema as Anthropic.Tool.InputSchema,
    // A spec argument can be long. Stream it as it is generated rather than
    // waiting for the server to buffer the whole thing; Zod validates what
    // arrives, so a truncated input is caught rather than planned.
    eager_input_streaming: true,
  };
}

function toMessages(turns: Turn[]): Anthropic.MessageParam[] {
  return turns.map((turn): Anthropic.MessageParam => {
    if (turn.role === 'user') return { role: 'user', content: turn.text };

    if (turn.role === 'tool') {
      // Every result for a turn goes back in one user message — splitting them
      // teaches the model to stop calling tools in parallel.
      return {
        role: 'user',
        content: turn.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      };
    }

    // Replay Claude's own blocks when Claude produced them: thinking blocks
    // must go back unchanged. Another provider's turn is rebuilt from text.
    if (turn.provider === 'anthropic' && Array.isArray(turn.raw)) {
      return { role: 'assistant', content: turn.raw as Anthropic.ContentBlockParam[] };
    }

    const content: Anthropic.ContentBlockParam[] = [];
    if (turn.text) content.push({ type: 'text', text: turn.text });
    for (const call of turn.calls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
    }
    return { role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] };
  });
}
