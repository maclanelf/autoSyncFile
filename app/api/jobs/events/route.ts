import { subscribeToTaskUpdates } from "@/lib/task-monitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  function cleanup() {
    if (closed) return;
    closed = true;
    unsubscribe?.();
  }

  function close() {
    cleanup();
    try {
      controller?.close();
    } catch {
      // The stream can already be cancelled when the request aborts.
    }
  }

  const stream = new ReadableStream({
    start(streamController) {
      controller = streamController;
      unsubscribe = subscribeToTaskUpdates((jobs) => {
        if (!closed && streamController.desiredSize !== null && streamController.desiredSize > 0) {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify(jobs)}\n\n`));
        }
      }, () => !closed && streamController.desiredSize !== null && streamController.desiredSize > 0);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener("abort", close, {once: true});

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}
