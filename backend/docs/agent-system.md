# Agent System

## Overview

The agent system uses Vercel AI SDK v6's `streamText` with a manual loop to support mid-execution pausing for human-in-the-loop tool confirmations. The agent runs server-side and streams responses to the client via Server-Sent Events (SSE).

## Agent Loop (`lib/ai/agent.ts`)

```
runAgent(sessionId, userId, callbacks, signal)
  │
  ├── Load session from DB (including messages JSON)
  ├── Load assignee config (personality, model, available tools)
  ├── Set Redis stream active flag
  ├── Clear previous stream chunks in Redis
  │
  └── while (stepCount < MAX_STEPS):
      │
      ├── streamText({ model, system, messages, tools })
      │   └── for await (part of fullStream):
      │       ├── text-delta → cache in Redis, emit via SSE
      │       ├── tool-call → emit via SSE
      │       ├── tool-result → emit via SSE
      │       └── error → emit via SSE
      │
      ├── await finishReason
      │
      ├── if finishReason === 'tool-calls':
      │   ├── Check if any tool requires confirmation
      │   ├── if YES (e.g. send_email):
      │   │   ├── Save messages to DB
      │   │   ├── Create confirmation record
      │   │   ├── Send push notification
      │   │   ├── Emit confirmation_required event
      │   │   └── RETURN (paused)
      │   └── if NO:
      │       └── continue loop (tools auto-executed)
      │
      └── else: break (agent finished)
```

## Tools

### Defined in `lib/ai/tools/`

| Tool | Has Execute | Requires Confirmation |
|------|-------------|----------------------|
| `send_email` | No | Yes |
| `search_emails` | Yes | No |
| `create_task` | Yes | No |
| `update_task` | Yes | No |

Tools are built per-request with `buildToolSet(userId, availableTools)`:
- `userId` is injected into tool closures for data scoping
- `availableTools` filters which tools the agent can use (from assignee config)
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
5. Sets Redis trigger to resume agent
6. Agent picks up on next SSE connection

**Reject (`action: "reject"`):**

1. Adds rejection tool result to messages
2. Sets session status to `stopped`
3. Agent does not resume

## SSE Streaming (`app/api/chat-sessions/[id]/stream/route.ts`)

### Stream Lifecycle

1. Client connects to `GET /api/chat-sessions/[id]/stream`
2. Server replays cached chunks from Redis (reconnection support)
3. Checks if agent is already running (polls if yes)
4. Checks for trigger signal (from message send or confirmation resolve)
5. If triggered or session is `starting`/`in_progress`: runs agent
6. Agent streams events through SSE callbacks
7. On completion: sends `done` event, closes stream

### Stream Events

| Event | Data | When |
|-------|------|------|
| `status` | `{status: string}` | Session status changes |
| `text-delta` | `{text: string}` | AI generates text |
| `tool-call` | `{toolCallId, toolName, input}` | AI calls a tool |
| `tool-result` | `{toolCallId, toolName, output}` | Tool returns result |
| `confirmation_required` | `{toolCallId, toolName, parameters}` | Tool needs approval |
| `error` | `{error: string}` | Error occurred |
| `done` | `{}` | Stream finished |

### Stream Recovery

Chunks are cached in Redis (`stream:chunks:{sessionId}`) with 1-hour TTL. When a client reconnects, cached chunks are replayed before live streaming continues. This handles network interruptions gracefully.

## Redis Keys

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `stream:chunks:{sessionId}` | Cached SSE chunks for replay | 1 hour |
| `stream:active:{sessionId}` | Whether agent is currently running | 5 min |
| `stream:trigger:{sessionId}` | Signal to start/resume agent | 5 min |
