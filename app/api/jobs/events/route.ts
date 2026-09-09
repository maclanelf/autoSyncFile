import { subscribeToTaskUpdates } from "@/lib/task-monitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = subscribeToTaskUpdates((jobs) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(jobs)}\n\n`));
      });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });

  request.signal.addEventListener("abort", () => {
    closed = true;
    unsubscribe?.();
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}
