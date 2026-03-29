import fs from "node:fs";
import { TOKEN_FILE, type AuthToken } from "./auth.utils";

const BASE_URL = "http://localhost:3000";

function loadToken(): AuthToken {
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as AuthToken;
  if (!data.access_token) throw new Error("No access_token in auth-token.json");
  return data;
}

function authHeaders(token: AuthToken): Record<string, string> {
  return {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
}

// ---- Assignee helpers ----

export async function getAssigneeId(): Promise<string> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/assignees`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`GET /api/assignees failed (${res.status})`);
  const assignees = (await res.json()) as { data: Array<{ id: string }> };
  if (assignees.data.length === 0) throw new Error("No assignees found");
  return assignees.data[0]!.id;
}

export async function createAssignee(label: string): Promise<string> {
  const token = loadToken();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${BASE_URL}/api/assignees`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      name: label,
      email: `test-${suffix}@test.rxlab.app`,
      model: "openai/gpt-oss-120b",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`POST /api/assignees failed (${res.status}): ${err}`);
  }
  const created = (await res.json()) as { id: string };
  return created.id;
}

export async function createAssigneeWithEmail(
  label: string,
  email: string,
): Promise<string> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/assignees`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      name: label,
      email,
      model: "openai/gpt-oss-120b",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`POST /api/assignees failed (${res.status}): ${err}`);
  }
  const created = (await res.json()) as { id: string };
  return created.id;
}

export async function deleteAssignee(assigneeId: string): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/assignees/${assigneeId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `DELETE /api/assignees/${assigneeId} failed (${res.status})`,
    );
  }
}

export async function getAssignee(assigneeId: string): Promise<{
  id: string;
  toolPermissions: Array<{ toolName: string; permission: string }>;
}> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/assignees/${assigneeId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok)
    throw new Error(`GET /api/assignees/${assigneeId} failed (${res.status})`);
  return res.json() as any;
}

/** System tools that always auto-execute and cannot have permissions changed. */
const SYSTEM_TOOLS = new Set([
  "update_document",
  "create_document",
  "search_documents",
  "create_briefing",
  "send_notification",
  "generate_image",
  "search_history",
  "request_upload",
  "read_uploaded_file",
]);

export async function updateAssigneePermissions(
  assigneeId: string,
  toolPermissions: Array<{ toolName: string; permission: string }>,
): Promise<void> {
  const token = loadToken();
  const filtered = toolPermissions.filter(
    (tp) => !SYSTEM_TOOLS.has(tp.toolName),
  );
  const res = await fetch(`${BASE_URL}/api/assignees/${assigneeId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ toolPermissions: filtered }),
  });
  if (!res.ok)
    throw new Error(
      `PUT /api/assignees/${assigneeId} failed (${res.status}): ${await res.text()}`,
    );
}

// ---- Chat helpers ----

export async function clearChatHistory(assigneeId: string): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/chat/${assigneeId}/messages`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  // 404 is OK — no session exists yet
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `DELETE /api/chat/${assigneeId}/messages failed (${res.status})`,
    );
  }
}

export async function sendMessage(
  assigneeId: string,
  content: string,
): Promise<{ queued: boolean; messageId: string }> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/chat/${assigneeId}/message`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `POST /api/chat/${assigneeId}/message failed (${res.status}): ${text}`,
    );
  }
  return res.json() as any;
}

// ---- SSE Stream ----

export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface StreamHandle {
  /** All events received so far */
  events: StreamEvent[];
  /** Wait for the next `done` event on the stream */
  waitForDone: () => Promise<void>;
  /** Wait for the next occurrence of a specific event type */
  waitForEvent: (eventType: string) => Promise<StreamEvent>;
  /** Close the SSE connection */
  cancel: () => void;
}

function streamLog(label?: string, ...args: unknown[]) {
  if (label) {
    console.log(`[${label}]`, ...args);
  } else {
    console.log(...args);
  }
}

export function consumeStream(
  assigneeId: string,
  options?: {
    timeout?: number;
    label?: string;
    /** Automatically cancel the stream when a `done` event is received */
    autoDisconnect?: boolean;
    /** Device token to send as query parameter for per-device stream recovery */
    deviceToken?: string;
    onMessage?: (event: StreamEvent) => void | Promise<void>;
  },
): StreamHandle {
  const timeout = options?.timeout ?? 120_000;
  const token = loadToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const events: StreamEvent[] = [];
  let doneCount = 0;
  const doneWaiters: Array<{
    target: number;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];
  const eventWaiters: Array<{
    eventType: string;
    resolve: (evt: StreamEvent) => void;
    reject: (err: Error) => void;
  }> = [];

  const notifyDone = () => {
    doneCount++;
    const resolved: number[] = [];
    for (let i = 0; i < doneWaiters.length; i++) {
      if (doneCount >= doneWaiters[i]!.target) {
        doneWaiters[i]!.resolve();
        resolved.push(i);
      }
    }
    for (let i = resolved.length - 1; i >= 0; i--) {
      doneWaiters.splice(resolved[i]!, 1);
    }
  };

  const notifyEventWaiters = (evt: StreamEvent) => {
    const resolved: number[] = [];
    for (let i = 0; i < eventWaiters.length; i++) {
      if (eventWaiters[i]!.eventType === evt.event) {
        eventWaiters[i]!.resolve(evt);
        resolved.push(i);
      }
    }
    for (let i = resolved.length - 1; i >= 0; i--) {
      eventWaiters.splice(resolved[i]!, 1);
    }
  };

  const rejectAll = (err: Error) => {
    for (const w of doneWaiters) w.reject(err);
    doneWaiters.length = 0;
    for (const w of eventWaiters) w.reject(err);
    eventWaiters.length = 0;
  };

  // Start reading SSE in background
  (async () => {
    try {
      // Retry on 404 — chat session may not exist yet for new assignees
      let res: Response;
      let retries = 0;
      while (true) {
        res = await fetch(`${BASE_URL}/api/chat/${assigneeId}/stream${options?.deviceToken ? `?deviceToken=${encodeURIComponent(options.deviceToken)}` : ""}`, {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: controller.signal,
        });
        if (res.status === 404 && retries < 20) {
          retries++;
          streamLog(options?.label, `Stream 404, retrying (${retries}/20)...`);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (!res.ok) {
          throw new Error(
            `GET /api/chat/${assigneeId}/stream failed (${res.status})`,
          );
        }
        break;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop()!; // keep incomplete line in buffer

        let currentEvent = "";
        let currentData = "";

        for (const line of lines) {
          streamLog(options?.label, "SSE line:", line);
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          } else if (line === "" && currentEvent && currentData) {
            // End of SSE frame
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(currentData);
            } catch {
              // Skip unparseable data (e.g. ping frames)
              currentEvent = "";
              currentData = "";
              continue;
            }

            const evt: StreamEvent = { event: currentEvent, data };
            events.push(evt);

            if (currentEvent === "error") {
              const errMsg =
                typeof data.message === "string"
                  ? data.message
                  : JSON.stringify(data);
              rejectAll(new Error(`SSE error: ${errMsg}`));
              return;
            }

            if (currentEvent === "done") {
              notifyDone();
              if (options?.autoDisconnect) {
                controller.abort();
                clearTimeout(timer);
                return;
              }
            }
            notifyEventWaiters(evt);

            if (options?.onMessage) {
              await options.onMessage(evt);
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        streamLog(options?.label, "Stream error:", err);
        rejectAll(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return {
    events,
    waitForDone: () => {
      const target = doneCount + 1;
      return new Promise<void>((resolve, reject) => {
        if (doneCount >= target) {
          resolve();
          return;
        }
        doneWaiters.push({ target, resolve, reject });
      });
    },
    waitForEvent: (eventType: string) => {
      return new Promise<StreamEvent>((resolve, reject) => {
        eventWaiters.push({ eventType, resolve, reject });
      });
    },
    cancel: () => {
      controller.abort();
      clearTimeout(timer);
    },
  };
}

// ---- Chat History ----

interface MessagePart {
  type: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: MessagePart[] | string;
  [key: string]: unknown;
}

export async function getChatHistory(
  assigneeId: string,
): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/chat/${assigneeId}/messages`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/chat/${assigneeId}/messages failed (${res.status})`,
    );
  }
  return res.json() as any;
}

// ---- Confirmations ----

interface Confirmation {
  id: string;
  chatSessionId: string;
  toolName: string;
  toolCallId: string;
  status: string;
  [key: string]: unknown;
}

export async function listConfirmations(): Promise<Confirmation[]> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/confirmations`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`GET /api/confirmations failed (${res.status})`);
  return res.json() as any;
}

export async function resolveConfirmation(
  id: string,
  action: "confirm" | "reject",
  options?: { alwaysAllow?: boolean },
): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/confirmations/${id}/resolve`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ action, ...options }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/confirmations/${id}/resolve failed (${res.status}): ${await res.text()}`,
    );
  }
}

// ---- Questions ----

interface Question {
  id: string;
  toolName: string;
  toolCallId: string;
  status: string;
  questionsData: Array<{
    title: string;
    description?: string;
    type: string;
    options?: Array<{ title: string; description?: string }>;
  }>;
  [key: string]: unknown;
}

export async function listQuestions(): Promise<Question[]> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/questions`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`GET /api/questions failed (${res.status})`);
  return res.json() as any;
}

export async function answerQuestion(
  id: string,
  action: "answer" | "reject",
  answers?: Array<{ questionIndex: number; answer: string | string[] | boolean }>,
): Promise<void> {
  const token = loadToken();
  const body: Record<string, unknown> = { action };
  if (answers) body.answers = answers;
  const res = await fetch(`${BASE_URL}/api/questions/${id}/answer`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/questions/${id}/answer failed (${res.status}): ${await res.text()}`,
    );
  }
}

// ---- Location Response ----

export async function sendLocationResponse(
  toolCallId: string,
  action: "confirm" | "reject",
  data?: { latitude: number; longitude: number; accuracy?: number },
): Promise<void> {
  const token = loadToken();
  const body: Record<string, unknown> = { toolCallId, action };
  if (action === "confirm" && data) {
    body.latitude = data.latitude;
    body.longitude = data.longitude;
    body.accuracy = data.accuracy ?? 0;
  }
  const res = await fetch(`${BASE_URL}/api/location-response`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/location-response failed (${res.status}): ${await res.text()}`,
    );
  }
}

// ---- Upload helpers ----

export async function resolveUpload(
  id: string,
  action: "complete" | "reject",
  uploadedKeys?: string[],
): Promise<void> {
  const token = loadToken();
  const body: Record<string, unknown> = { action };
  if (uploadedKeys) body.uploadedKeys = uploadedKeys;
  const res = await fetch(`${BASE_URL}/api/uploads/${id}/resolve`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/uploads/${id}/resolve failed (${res.status}): ${await res.text()}`,
    );
  }
}

export async function getUploadDownloadUrls(
  id: string,
): Promise<Array<{ key: string; url: string; extension: string; mimeType: string }>> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/uploads/${id}/download-urls`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/uploads/${id}/download-urls failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as any;
}

export async function getUploadPresignedUrls(
  id: string,
  extensions: string[],
): Promise<Array<{ url: string; key: string; extension: string }>> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/uploads/${id}/presigned-urls`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ extensions }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/uploads/${id}/presigned-urls failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as any;
}

export async function getUpload(
  id: string,
): Promise<{
  id: string;
  status: string;
  urls: Array<{ url: string; key: string; extension: string }>;
  uploadedKeys: string[] | null;
  numberUploads: number | null;
  extensions: string[];
  title: string;
  [key: string]: unknown;
}> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/uploads/${id}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/uploads/${id} failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as any;
}

export async function uploadFileToPresignedUrl(
  presignedUrl: string,
  content: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: content,
  });
  if (!res.ok) {
    throw new Error(
      `PUT presigned URL failed (${res.status}): ${await res.text()}`,
    );
  }
}

// ---- Task helpers ----

export async function createTask(
  assigneeId: string,
  title: string,
  description: string,
): Promise<string> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ assigneeId, title, description }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /api/tasks failed (${res.status}): ${text}`);
  }
  const created = (await res.json()) as { id: string };
  return created.id;
}

export async function deleteTask(taskId: string): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE /api/tasks/${taskId} failed (${res.status})`);
  }
}

export async function executeTaskNow(
  taskId: string,
): Promise<{ sessionId: string }> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/execute-now`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `POST /api/tasks/${taskId}/execute-now failed (${res.status}): ${text}`,
    );
  }
  return res.json() as any;
}

export async function executeTaskNowRaw(
  taskId: string,
): Promise<Response> {
  const token = loadToken();
  return fetch(`${BASE_URL}/api/tasks/${taskId}/execute-now`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export async function stopTask(taskId: string): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/stop`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `POST /api/tasks/${taskId}/stop failed (${res.status}): ${text}`,
    );
  }
}

export async function getTask(taskId: string): Promise<{
  id: string;
  status: string;
  toolPermissions: Array<{
    toolName: string;
    permission: string;
    conditions?: unknown[];
    conditionLogic?: string;
  }> | null;
  [key: string]: unknown;
}> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok)
    throw new Error(`GET /api/tasks/${taskId} failed (${res.status})`);
  return res.json() as any;
}

export async function updateTaskPermissions(
  taskId: string,
  toolPermissions: Array<{
    toolName: string;
    permission: string;
    conditions?: Array<{
      parameterName: string;
      parameterType: string;
      operator: string;
      value: string | number;
    }>;
    conditionLogic?: string;
  }>,
): Promise<void> {
  const token = loadToken();
  const filtered = toolPermissions.filter(
    (tp) => !SYSTEM_TOOLS.has(tp.toolName),
  );
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ toolPermissions: filtered }),
  });
  if (!res.ok)
    throw new Error(
      `PUT /api/tasks/${taskId} failed (${res.status}): ${await res.text()}`,
    );
}

// ---- Session-based helpers (for task chat) ----

export function consumeSessionStream(
  sessionId: string,
  options?: {
    timeout?: number;
    label?: string;
    autoDisconnect?: boolean;
    onMessage?: (event: StreamEvent) => void | Promise<void>;
  },
): StreamHandle {
  const timeout = options?.timeout ?? 120_000;
  const token = loadToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const events: StreamEvent[] = [];
  let doneCount = 0;
  const doneWaiters: Array<{
    target: number;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];
  const eventWaiters: Array<{
    eventType: string;
    resolve: (evt: StreamEvent) => void;
    reject: (err: Error) => void;
  }> = [];

  const notifyDone = () => {
    doneCount++;
    const resolved: number[] = [];
    for (let i = 0; i < doneWaiters.length; i++) {
      if (doneCount >= doneWaiters[i]!.target) {
        doneWaiters[i]!.resolve();
        resolved.push(i);
      }
    }
    for (let i = resolved.length - 1; i >= 0; i--) {
      doneWaiters.splice(resolved[i]!, 1);
    }
  };

  const notifyEventWaiters = (evt: StreamEvent) => {
    const resolved: number[] = [];
    for (let i = 0; i < eventWaiters.length; i++) {
      if (eventWaiters[i]!.eventType === evt.event) {
        eventWaiters[i]!.resolve(evt);
        resolved.push(i);
      }
    }
    for (let i = resolved.length - 1; i >= 0; i--) {
      eventWaiters.splice(resolved[i]!, 1);
    }
  };

  const rejectAll = (err: Error) => {
    for (const w of doneWaiters) w.reject(err);
    doneWaiters.length = 0;
    for (const w of eventWaiters) w.reject(err);
    eventWaiters.length = 0;
  };

  (async () => {
    try {
      let res: Response;
      let retries = 0;
      while (true) {
        res = await fetch(`${BASE_URL}/api/chat-sessions/${sessionId}/stream`, {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: controller.signal,
        });
        if (res.status === 404 && retries < 20) {
          retries++;
          streamLog(options?.label, `Session stream 404, retrying (${retries}/20)...`);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (!res.ok) {
          throw new Error(
            `GET /api/chat-sessions/${sessionId}/stream failed (${res.status})`,
          );
        }
        break;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        let currentEvent = "";
        let currentData = "";

        for (const line of lines) {
          streamLog(options?.label, "SSE line:", line);
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          } else if (line === "" && currentEvent && currentData) {
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(currentData);
            } catch {
              currentEvent = "";
              currentData = "";
              continue;
            }

            const evt: StreamEvent = { event: currentEvent, data };
            events.push(evt);

            if (currentEvent === "error") {
              const errMsg =
                typeof data.message === "string"
                  ? data.message
                  : JSON.stringify(data);
              rejectAll(new Error(`SSE error: ${errMsg}`));
              return;
            }

            if (currentEvent === "done") {
              notifyDone();
              if (options?.autoDisconnect) {
                controller.abort();
                clearTimeout(timer);
                return;
              }
            }
            notifyEventWaiters(evt);

            if (options?.onMessage) {
              await options.onMessage(evt);
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        streamLog(options?.label, "Stream error:", err);
        rejectAll(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return {
    events,
    waitForDone: () => {
      const target = doneCount + 1;
      return new Promise<void>((resolve, reject) => {
        if (doneCount >= target) {
          resolve();
          return;
        }
        doneWaiters.push({ target, resolve, reject });
      });
    },
    waitForEvent: (eventType: string) => {
      return new Promise<StreamEvent>((resolve, reject) => {
        eventWaiters.push({ eventType, resolve, reject });
      });
    },
    cancel: () => {
      controller.abort();
      clearTimeout(timer);
    },
  };
}

export async function sendSessionMessage(
  sessionId: string,
  content: string,
): Promise<{ queued: boolean; messageId: string }> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/chat-sessions/${sessionId}/messages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `POST /api/chat-sessions/${sessionId}/messages failed (${res.status}): ${text}`,
    );
  }
  return res.json() as any;
}

export async function getSessionMessages(
  sessionId: string,
): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/chat-sessions/${sessionId}/messages`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/chat-sessions/${sessionId}/messages failed (${res.status})`,
    );
  }
  return res.json() as any;
}

// ---- Utility: find parts in messages ----

export function findToolCallParts(
  messages: ChatMessage[],
  toolName: string,
): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "tool-call" && part.toolName === toolName) {
        parts.push(part);
      }
    }
  }
  return parts;
}

export function findToolResultParts(
  messages: ChatMessage[],
  toolName: string,
): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "tool-result" && part.toolName === toolName) {
        parts.push(part);
      }
    }
  }
  return parts;
}

export function findAllToolCallParts(messages: ChatMessage[]): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "tool-call") {
        parts.push(part);
      }
    }
  }
  return parts;
}

export function findAllToolResultParts(messages: ChatMessage[]): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "tool-result") {
        parts.push(part);
      }
    }
  }
  return parts;
}

// ---- Task tools helpers ----

export async function getTaskTools(taskId: string): Promise<
  Array<{
    name: string;
    description: string;
    defaultPermission: string;
    parameters?: Array<{ name: string; type: string; description?: string; required: boolean }>;
    disablePermissionChange?: boolean;
  }>
> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/tools`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/tasks/${taskId}/tools failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as any;
}

export async function getTaskExtensionDetail(
  taskId: string,
  extensionId: string,
): Promise<{
  id: string;
  prefix: string;
  enabled: boolean;
  toolPermissions: Array<{ toolName: string; permission: string }> | null;
  tools: Array<{ name: string; description: string; effectivePermission: string }>;
  [key: string]: unknown;
}> {
  const token = loadToken();
  const res = await fetch(
    `${BASE_URL}/api/tasks/${taskId}/extensions/${extensionId}`,
    {
      headers: authHeaders(token),
    },
  );
  if (!res.ok) {
    throw new Error(
      `GET /api/tasks/${taskId}/extensions/${extensionId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as any;
}

export async function getAssigneeExtensionDetail(
  assigneeId: string,
  extensionId: string,
): Promise<{
  id: string;
  prefix: string;
  enabled: boolean;
  toolPermissions: Array<{ toolName: string; permission: string }> | null;
  tools: Array<{ name: string; description: string; effectivePermission: string }>;
  [key: string]: unknown;
}> {
  const token = loadToken();
  const res = await fetch(
    `${BASE_URL}/api/assignees/${assigneeId}/extensions/${extensionId}`,
    {
      headers: authHeaders(token),
    },
  );
  if (!res.ok) {
    throw new Error(
      `GET /api/assignees/${assigneeId}/extensions/${extensionId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as any;
}

// ---- Document helpers ----

export async function listChatDocuments(
  assigneeId: string,
): Promise<Array<{ id: string; title: string; format: string; content: string }>> {
  const token = loadToken();
  const res = await fetch(
    `${BASE_URL}/api/chat/${assigneeId}/documents`,
    { headers: authHeaders(token) },
  );
  if (!res.ok)
    throw new Error(`GET /api/chat/${assigneeId}/documents failed (${res.status})`);
  const body = (await res.json()) as { data: Array<{ id: string; title: string; format: string; content: string }> };
  return body.data;
}
