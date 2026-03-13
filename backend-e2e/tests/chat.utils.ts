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

export async function updateAssigneePermissions(
  assigneeId: string,
  toolPermissions: Array<{ toolName: string; permission: string }>,
): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/assignees/${assigneeId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ toolPermissions }),
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

export async function consumeStream(
  assigneeId: string,
  options?: {
    until?: "done" | "confirmation_required";
    timeout?: number;
  },
): Promise<StreamEvent[]> {
  const until = options?.until ?? "done";
  const timeout = options?.timeout ?? 120_000;
  const token = loadToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${BASE_URL}/api/chat/${assigneeId}/stream`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(
        `GET /api/chat/${assigneeId}/stream failed (${res.status})`,
      );
    }

    const events: StreamEvent[] = [];
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
        console.log("SSE line:", line);
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "" && currentEvent && currentData) {
          // End of SSE frame
          try {
            const data = JSON.parse(currentData);
            const evt: StreamEvent = { event: currentEvent, data };
            events.push(evt);

            // Check stop conditions
            if (until === "done" && currentEvent === "done") {
              reader.cancel();
              return events;
            }
            if (
              until === "confirmation_required" &&
              currentEvent === "confirmation_required"
            ) {
              reader.cancel();
              return events;
            }
          } catch {
            // Skip unparseable data (e.g. ping frames)
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }

    return events;
  } finally {
    clearTimeout(timer);
  }
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
): Promise<void> {
  const token = loadToken();
  const res = await fetch(`${BASE_URL}/api/confirmations/${id}/resolve`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/confirmations/${id}/resolve failed (${res.status}): ${await res.text()}`,
    );
  }
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
