/**
 * The provider seam.
 *
 * The agent loop does not know which model it is talking to. It hands a driver
 * a system prompt, a tool list and the conversation so far; the driver answers
 * with the text the model produced and the tool calls it wants made. Each
 * driver owns the translation to its own wire format and nothing else.
 *
 * This is cheap to do here precisely because of what the model produces: a
 * query spec is JSON against a published schema, so "can this model drive the
 * semantic layer" reduces to "can it call a function". The spec is the
 * contract, not the provider.
 */

/** A tool, as the loop knows it. Drivers reshape this for their API. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema, generated from the Zod schema in tools.ts. */
  schema: Record<string, unknown>;
}

export interface ToolCall {
  /** Provider-assigned id; tool results must quote it back. */
  id: string;
  name: string;
  /** Parsed arguments, still unvalidated. */
  input: unknown;
}

export interface ToolOutcome {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

/**
 * One entry of conversation, provider-neutral. `raw` carries the provider's
 * own representation of an assistant turn so a replay is byte-faithful on the
 * provider that produced it — thinking blocks for Anthropic, output items for
 * OpenAI — and is ignored by any other driver.
 */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: ToolCall[]; provider?: string; raw?: unknown }
  | { role: 'tool'; results: ToolOutcome[] };

export interface TurnResult {
  text: string;
  calls: ToolCall[];
  raw?: unknown;
  /** Set when the model stopped for a reason the loop should report. */
  stopped?: { reason: 'refusal' | 'length' | 'error'; detail?: string };
}

export interface TurnRequest {
  system: string;
  tools: ToolSpec[];
  turns: Turn[];
  /** Called with each text fragment as it arrives. */
  onText: (text: string) => void;
  signal?: AbortSignal;
}

export interface Driver {
  /** Stable id, also the value of LLM_PROVIDER. */
  readonly id: string;
  readonly model: string;
  turn(request: TurnRequest): Promise<TurnResult>;
}
