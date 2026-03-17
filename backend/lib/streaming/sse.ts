export function createSSEStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    cancel() {
      controller = null;
    },
  });

  function send(event: string, data: unknown) {
    if (!controller) {
      console.log(`[SSE] send: controller=null, dropping event=${event}`);
      return;
    }
    try {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      console.log(`[SSE] send: event=${event} payloadLen=${payload.length}`);
      controller.enqueue(encoder.encode(payload));
    } catch {
      // Stream closed
    }
  }

  /** Send an SSE comment as a keepalive ping (ignored by EventSource parsers). */
  function ping() {
    if (!controller) return;
    try {
      controller.enqueue(encoder.encode(": ping\n\n"));
    } catch {
      // Stream closed
    }
  }

  function close() {
    if (!controller) return;
    try {
      controller.close();
    } catch {
      // Already closed
    }
    controller = null;
  }

  return { stream, send, ping, close };
}

export function sseResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
