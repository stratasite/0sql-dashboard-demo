/**
 * Conversation memory, in process.
 *
 * The full Anthropic history is kept server-side — assistant tool_use blocks
 * and tool results included — so a follow-up like "now split that by BPO" or
 * "pin that one" lands on the same specs the model already wrote, and so the
 * cached prompt prefix keeps hitting.
 *
 * A Map is enough for a demo on one machine. For anything real, put this in
 * Redis or a table keyed by the user's session.
 */
import type Anthropic from '@anthropic-ai/sdk';

/** Messages kept per conversation. Older turns fall off the front. */
const WINDOW = 40;
/** Conversations kept at once, oldest evicted first. */
const MAX_CONVERSATIONS = 50;

const store = new Map<string, Anthropic.MessageParam[]>();

export function getConversation(id: string): Anthropic.MessageParam[] {
  return store.get(id) ?? [];
}

export function saveConversation(id: string, messages: Anthropic.MessageParam[]): void {
  // Trim from the front, but never start the window on a tool_result message:
  // the API rejects a history whose first message answers a call it cannot see.
  let trimmed = messages.slice(-WINDOW);
  while (trimmed.length && !startsCleanly(trimmed[0])) trimmed = trimmed.slice(1);

  store.delete(id);
  store.set(id, trimmed);
  while (store.size > MAX_CONVERSATIONS) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

function startsCleanly(message: Anthropic.MessageParam): boolean {
  if (message.role !== 'user') return false;
  if (typeof message.content === 'string') return true;
  return !message.content.some((block) => block.type === 'tool_result');
}

export function clearConversation(id: string): void {
  store.delete(id);
}
