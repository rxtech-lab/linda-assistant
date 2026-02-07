export interface SSEEvent {
  event: string;
  data: any;
}

export async function consumeSSE(
  url: string,
  options: {
    headers?: Record<string, string>;
    stopOnEvent?: string;
    timeoutMs?: number;
  } = {}
): Promise<SSEEvent[]> {
  const { headers = {}, stopOnEvent = "done", timeoutMs = 15000 } = options;

  const events: SSEEvent[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/event-stream",
        ...headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE request failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "") {
          // Empty line = end of event
          if (currentEvent && currentData) {
            let parsed: any;
            try {
              parsed = JSON.parse(currentData);
            } catch {
              parsed = currentData;
            }
            events.push({ event: currentEvent, data: parsed });

            if (currentEvent === stopOnEvent) {
              reader.cancel();
              return events;
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      // Timeout — return what we have
    } else {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }

  return events;
}
