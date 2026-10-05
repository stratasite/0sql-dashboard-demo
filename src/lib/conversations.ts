/**
 * Conversation memory, in process.
 *
 * The full history is kept server-side — the assistant's tool calls and their
 * results included — so a follow-up like "now split that by BPO" or "pin that
 * one" lands on the same specs the model already wrote, and so the cached
 * prompt prefix keeps hitting.
 *
 * A Map is enough for a demo on one machine. For anything real, put this in
 * Redis or a table keyed by the user's session.
 */
import type { Turn } from './providers';

/** Messages kept per conversation. Older turns fall off the front. */
const WINDOW = 40;
/** Conversations kept at once, oldest evicted first. */
const MAX_CONVERSATIONS = 50;

const store = new Map<string, Turn[]>();

export function getConversation(id: string): Turn[] {
  return store.get(id) ?? [];
}

export function saveConversation(id: string, turns: Turn[]): void {
  // Trim from the front, but never start the window on tool results: every
  // provider rejects a history that answers a call it cannot see.
  let trimmed = turns.slice(-WINDOW);
  while (trimmed.length && trimmed[0].role !== 'user') trimmed = trimmed.slice(1);

  store.delete(id);
  store.set(id, trimmed);
  while (store.size > MAX_CONVERSATIONS) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

export function clearConversation(id: string): void {
  store.delete(id);
}
