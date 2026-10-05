/**
 * Which model drives the agent.
 *
 * `LLM_PROVIDER=anthropic|openai` decides; with neither set, whichever key is
 * present wins, and Claude wins when both are. Nothing else in the app knows
 * the difference.
 */
import { anthropicDriver } from './anthropic';
import { openaiDriver } from './openai';
import type { Driver } from './types';

export type { Driver, ToolCall, ToolOutcome, ToolSpec, Turn, TurnRequest, TurnResult } from './types';

export class NoProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoProviderError';
  }
}

export function selectDriver(): Driver {
  const asked = process.env.LLM_PROVIDER?.toLowerCase().trim();
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenai = Boolean(process.env.OPENAI_API_KEY);

  if (asked === 'anthropic' || asked === 'claude') {
    if (!hasAnthropic) throw new NoProviderError('LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.');
    return anthropicDriver();
  }
  if (asked === 'openai') {
    if (!hasOpenai) throw new NoProviderError('LLM_PROVIDER=openai but OPENAI_API_KEY is not set.');
    return openaiDriver();
  }
  if (asked) throw new NoProviderError(`LLM_PROVIDER=${asked} is not a provider this demo has. Use anthropic or openai.`);

  if (hasAnthropic) return anthropicDriver();
  if (hasOpenai) return openaiDriver();

  throw new NoProviderError(
    'No model key. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in .env.local — see .env.example.',
  );
}

/** For the status route: what is configured, without constructing a client. */
export function providerStatus(): { provider: string | null; model: string | null } {
  try {
    const driver = selectDriver();
    return { provider: driver.id, model: driver.model };
  } catch {
    return { provider: null, model: null };
  }
}
