# API Routes

All routes except webhooks require Bearer token authentication. List endpoints support `limit` and `offset` query parameters for pagination.

## Authentication

Every protected request must include:
```
Authorization: Bearer <rxlab-oauth-token>
```

The middleware calls the RxLab OIDC userinfo endpoint to validate the token and extract `sub` as `userId`. All database queries are scoped to this userId.

## Endpoints

### Assignees

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/assignees` | List assignees (paginated) |
| POST | `/api/assignees` | Create assignee |
| GET | `/api/assignees/[id]` | Get assignee detail |
| PUT | `/api/assignees/[id]` | Update assignee |
| DELETE | `/api/assignees/[id]` | Delete assignee |

**Create/Update body:**
```json
{
  "name": "Linda",
  "email": "linda@assistant.rxlab.io",
  "personality": "You are a helpful assistant...",
  "model": "claude-sonnet-4-5-20250929",
  "toolPermissions": [
    { "toolName": "send_email", "permission": "manual-confirm" },
    { "toolName": "search_emails", "permission": "auto-confirm" },
    { "toolName": "create_task", "permission": "auto-confirm" },
    { "toolName": "update_task", "permission": "auto-confirm" }
  ]
}
```

Permission values: `auto-confirm` (execute without asking), `manual-confirm` (pause for user approval), `auto-reject` (tool unavailable). Tools not listed default to `manual-confirm`.

### Emails

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/emails` | List emails (paginated) |
| POST | `/api/emails` | Create email manually |
| GET | `/api/emails/[id]` | Get email detail |
| PUT | `/api/emails/[id]` | Update (mark read, edit metadata) |
| DELETE | `/api/emails/[id]` | Delete email |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List tasks (paginated) |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/[id]` | Get task with embedded chat sessions and linked emails |
| PUT | `/api/tasks/[id]` | Update task |
| DELETE | `/api/tasks/[id]` | Delete task |
| GET | `/api/tasks/[id]/chat-sessions` | List chat sessions for a task |

### Chat Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat-sessions` | List all sessions (paginated, excludes messages) |
| POST | `/api/chat-sessions` | Create session |
| GET | `/api/chat-sessions/[id]` | Get session with full messages JSON |
| DELETE | `/api/chat-sessions/[id]` | Delete session |
| POST | `/api/chat-sessions/[id]/messages` | Send message (queues agent task) |
| GET | `/api/chat-sessions/[id]/stream` | SSE stream for real-time agent output |

**Send message:**

```
POST /api/chat-sessions/{id}/messages
Content-Type: application/json

{
  "content": "Draft an email to John about the meeting",
  "attachments": [
    { "type": "image", "url": "https://s3.../photo.jpg", "name": "photo.jpg" }
  ]
}
```

Returns `{ "queued": true }` immediately. The message is saved to the session and a task is published to the RabbitMQ `agent-tasks` queue. A worker process picks up the task and runs the AI agent asynchronously.

Supported attachment types: `image`, `pdf`, `audio`.

**SSE stream:**

```
GET /api/chat-sessions/{id}/stream
Accept: text/event-stream
```

The stream stays open indefinitely — connect once and receive events for all agent runs in this session. The stream replays cached events on reconnection (1h TTL), then forwards live events from the worker via RabbitMQ. Only closes when the client disconnects.

**Stream events:**
```
event: status
data: {"status":"in_progress"}

event: text-delta
data: {"text":"I'll draft that email..."}

event: tool-call
data: {"toolCallId":"tc_1","toolName":"send_email","input":{...}}

event: tool-result
data: {"toolCallId":"tc_1","toolName":"send_email","output":{...}}

event: confirmation_required
data: {"toolCallId":"tc_1","toolName":"send_email","parameters":{...}}

event: done
data: {}
```

### Confirmations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/confirmations` | List pending confirmations |
| POST | `/api/confirmations/[id]/resolve` | Confirm or reject |

**Resolve body:**
```json
{ "action": "confirm" }
```
or
```json
{ "action": "reject" }
```

### Other

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/devices` | Register device for push notifications |
| DELETE | `/api/devices/[id]` | Unregister device |
| POST | `/api/uploads/presigned-url` | Get S3 presigned upload URL |
| GET | `/api/tools` | List available agent tools |
| POST | `/api/webhooks/resend` | Inbound email webhook (no auth, Svix verification) |

## Response Format

**Success:**
```json
{ "data": { ... } }
```

**Paginated:**
```json
{
  "data": [...],
  "pagination": { "total": 42, "limit": 20, "offset": 0, "hasMore": true }
}
```

**Error:**
```json
{ "error": "Description of error" }
```

## OpenAPI Spec

Generated at `public/openapi.json`. Interactive docs available at `/api-docs` when the server is running.
