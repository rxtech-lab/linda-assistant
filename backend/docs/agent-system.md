# Agent System

## Overview

The agent system uses Vercel AI SDK v6's `streamText` with a manual loop to support mid-execution pausing for human-in-the-loop tool confirmations. Agent execution is **decoupled from client connections** via RabbitMQ — a separate worker process runs the agent independently, so the agent completes even if the client disconnects.

## Architecture

```
POST /messages ──> save to DB ──> publish to [agent-tasks] queue
                                        │
                        ┌───────────────┘
                        ▼
               Worker Process (bun worker/index.ts)
                        │
                        ├─ check Redis lock (stream:active)
                        ├─ runAgent(sessionId, userId)
                        │    ├─ text-delta ──> publish to [agent-events] exchange + cache in Redis
                        │    ├─ tool-call  ──> publish to [agent-events] exchange + cache in Redis
                        │    ├─ done       ──> publish to [agent-events] exchange + cache in Redis
                        │    └─ (all events cached for replay)
                        └─ release lock

GET /stream ──> subscribe to [agent-events] exchange (exclusive queue)
            ──> replay cached Redis chunks
            ──> forward live events as SSE
```

### RabbitMQ Topology

| Component | Type | Purpose |
|-----------|------|---------|
| `agent-tasks` | Durable queue | Triggers agent runs. Message: `{sessionId, userId, type}` |
| `agent-events` | Topic exchange | Real-time agent output. Routing key: `session.{sessionId}` |
| Per-SSE connection | Exclusive auto-delete queue | Bound to exchange — only receives events for that session |

### Worker Process

The worker (`worker/index.ts`) is a **separate Bun process** that runs alongside the Next.js API server. It connects to RabbitMQ, consumes tasks from the `agent-tasks` queue (prefetch: 5), and runs the agent to completion. In development:

```bash
bun run dev          # Next.js API server
bun run worker:dev   # Worker process (with --watch)
```

For production (k8s), the same Docker image is used with different CMD arguments, allowing independent scaling of API servers and workers.

## Agent Loop (`lib/ai/agent.ts`)

```
runAgent(sessionId, userId, onEvent)
  │
  ├── Load session from DB (including messages JSON)
  ├── Load assignee config (personality, model, available tools)
  ├── Set Redis stream active flag
  │
  └── while (stepCount < MAX_STEPS):
      │
      ├── streamText({ model, system, messages, tools })
      │   └── for await (part of fullStream):
      │       ├── text-delta → await onEvent("text-delta", ...)
      │       ├── tool-call  → await onEvent("tool-call", ...)
      │       ├── tool-result → await onEvent("tool-result", ...)
      │       └── error → await onEvent("error", ...)
      │
      ├── Sanitize response messages (strip providerOptions)
      ├── await finishReason
      │
      ├── if finishReason === 'tool-calls':
      │   ├── Check if any tool requires confirmation
      │   ├── if YES (e.g. send_email):
      │   │   ├── Save messages to DB
      │   │   ├── Create confirmation record
      │   │   ├── Send push notification
      │   │   ├── await onEvent("confirmation_required", ...)
      │   │   └── RETURN (paused)
      │   └── if NO:
      │       └── continue loop (tools auto-executed)
      │
      └── else: break (agent finished)
```

## Tools

### Defined in `lib/ai/tools/`

| Tool | Has Execute | Default Permission |
|------|-------------|-------------------|
| `send_email` | No | `manual-confirm` |
| `search_emails` | Yes | `manual-confirm` |
| `create_task` | Yes | `manual-confirm` |
| `update_task` | Yes | `manual-confirm` |

Tools are built per-request with `buildToolSet(userId, toolPermissions)`:
- `userId` is injected into tool closures for data scoping
- `toolPermissions` controls per-tool behavior (from assignee config): `auto-confirm`, `manual-confirm`, or `auto-reject`
- Tools with `auto-reject` are excluded from the tool set
- Tools not listed in permissions default to `manual-confirm`
- Tools without `execute` (like `send_email`) cause `streamText` to return `finishReason: 'tool-calls'` without executing them

### Tool Definition Pattern (AI SDK v6)

```typescript
// Tool with auto-execution
export const searchEmailsTool = (userId: string) =>
  tool({
    description: "Search through the user's email inbox",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().default(10),
    }),
    execute: async ({ query, limit }) => {
      // Runs automatically when agent calls this tool
      return results;
    },
  });

// Tool requiring confirmation (no execute)
export const sendEmailTool = tool({
  description: "Send an email. Requires confirmation.",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
    emailId: z.string().optional(),
  }),
  // No execute → agent loop must handle manually
});
```

## Confirmation Flow (`lib/ai/confirmation.ts`)

### Creating a Confirmation

1. Agent detects a tool call for `send_email` (no execute function)
2. Agent saves current messages to `chat_sessions.messages` in DB
3. Creates a `confirmations` record with tool call details
4. Sends APNs push notification to all user devices
5. Sets chat session status to `waiting_confirmation`
6. SSE emits `confirmation_required` event

### Resolving a Confirmation

**Confirm (`POST /api/confirmations/[id]/resolve` with `action: "confirm"`):**

1. Validates confirmation belongs to user and is pending
2. Executes the tool (e.g., sends email via Resend)
3. Adds tool result message to `chat_sessions.messages`
4. Sets session status to `in_progress`
5. Publishes a `confirmation_resolved` task to RabbitMQ
6. Worker picks up the task and resumes the agent

**Reject (`action: "reject"`):**

1. Adds rejection tool result to messages
2. Sets session status to `stopped`
3. Agent does not resume

## SSE Streaming (`app/api/chat-sessions/[id]/stream/route.ts`)

### Stream Lifecycle

1. Client connects to `GET /api/chat-sessions/[id]/stream`
2. Server subscribes to the `agent-events` RabbitMQ exchange (routing key: `session.{id}`)
3. Replays cached chunks from Redis (reconnection support, 1h TTL)
4. Sends current session status
5. If cached chunks contain `done`/`error`, closes immediately (agent already finished)
6. Otherwise, switches to live mode — forwarding events from the RabbitMQ subscription as SSE
7. Stream stays open indefinitely until the client disconnects

The subscribe-first approach ensures no events are lost between reading the cache and establishing the subscription. Events received during cache replay are buffered and flushed afterward.

### Sending a Message

1. `POST /api/chat-sessions/[id]/messages` with `{ "content": "..." }`
2. The message is appended to the session's message history in the DB
3. A task is published to the `agent-tasks` RabbitMQ queue
4. The endpoint returns immediately with `{ "queued": true }`
5. The worker picks up the task and runs the agent
6. Agent events flow through RabbitMQ to any connected SSE clients

### Stream Events

| Event | Data | When |
|-------|------|------|
| `status` | `{status: string}` | Session status changes |
| `text-delta` | `{text: string}` | AI generates text |
| `tool-call` | `{toolCallId, toolName, input}` | AI calls a tool |
| `tool-result` | `{toolCallId, toolName, output}` | Tool returns result |
| `confirmation_required` | `{toolCallId, toolName, parameters}` | Tool needs approval |
| `error` | `{error: string}` | Error occurred |
| `done` | `{}` | Agent run finished |

### Stream Recovery

Chunks are cached in Redis (`stream:chunks:{sessionId}`) with 1-hour TTL. When a client reconnects, cached chunks are replayed before live streaming continues. This handles network interruptions gracefully. The cache is cleared at the start of each new agent run.

## RabbitMQ Queue (`lib/queue/`)

| File | Purpose |
|------|---------|
| `types.ts` | Shared interfaces (`AgentTask`, `AgentEvent`) and queue/exchange name constants |
| `connection.ts` | AMQP connection singleton with lazy topology setup |
| `producer.ts` | `publishTask()` — sends to `agent-tasks` queue; `publishEvent()` — publishes to `agent-events` exchange |
| `consumer.ts` | `consumeTasks()` — worker task consumer; `subscribeToEvents()` — per-SSE exclusive queue subscriber |

## Redis Keys

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `stream:chunks:{sessionId}` | Cached SSE chunks for replay | 1 hour |
| `stream:active:{sessionId}` | Whether agent is currently running | 5 min |
