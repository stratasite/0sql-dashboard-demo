/**
 * POST /api/chat — one question in, a stream of events out.
 *
 * The response is newline-delimited JSON (`AgentEvent` per line) rather than
 * plain text, because the browser needs more than prose: it draws the chart
 * when a query returns and shows the tool trace as it happens.
 *
 * The API keys stay here. The browser never sees the 0sql key, the model key
 * or the warehouse.
 */
import { runAgent } from '@/lib/agent';
import { getConversation, saveConversation } from '@/lib/conversations';
import { NoProviderError, selectDriver } from '@/lib/providers';
import { userById } from '@/lib/users';
import type { AgentEvent } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const { conversationId, message, userId } = (await request.json()) as {
    conversationId?: string;
    message?: string;
    userId?: string;
  };

  if (!conversationId || !message?.trim()) {
    return Response.json({ error: 'conversationId and message are required' }, { status: 400 });
  }
  // Fail before opening a stream: a missing key should read as a setup
  // problem, not as an error halfway through an answer.
  let driver;
  try {
    driver = selectDriver();
  } catch (error) {
    if (error instanceof NoProviderError) return Response.json({ error: error.message }, { status: 500 });
    throw error;
  }

  const user = userById(userId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: AgentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the client went away
        }
      };

      try {
        const history = await runAgent({
          turns: [...getConversation(conversationId), { role: 'user', text: message }],
          context: user.context,
          emit,
          signal: request.signal,
          driver,
        });
        saveConversation(conversationId, history);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        emit({ type: 'error', message: detail });
      } finally {
        emit({ type: 'done' });
        open = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
    },
  });
}
