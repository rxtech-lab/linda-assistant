# Database Schema

Turso (libSQL/SQLite) via Drizzle ORM. 7 tables total. All use `text` primary keys with `nanoid()` generation.

## Tables

### `assignees`
Agent profiles that define personality, model, and available tools.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | nanoid |
| user_id | text NOT NULL | Owner |
| name | text NOT NULL | e.g. "Linda" |
| email | text NOT NULL | Agent's email (Resend domain) |
| personality | text | System prompt for the agent |
| model | text | AI model ID, e.g. `claude-sonnet-4-5-20250929` |
| available_tools | text (json) | `string[]` of enabled tool names |
| created_at | text | `datetime('now')` |
| updated_at | text | `datetime('now')` |

### `email_inbox`
Received emails, either from Resend webhook or manually created.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| user_id | text NOT NULL | |
| assignee_id | text FK nullable | → assignees.id (set null on delete) |
| from_email | text NOT NULL | |
| from_name | text | |
| to_email | text NOT NULL | |
| subject | text | |
| body | text | HTML or plain text |
| received_at | text NOT NULL | ISO 8601 |
| is_read | integer (bool) | default false |
| metadata | text (json) | messageId, headers, attachments |

### `tasks`
User tasks, optionally linked to chat sessions and emails.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| user_id | text NOT NULL | |
| title | text NOT NULL | |
| description | text | |
| status | text | `pending` / `running` / `finished` / `cancelled` |
| tags | text (json) | `string[]` |
| categories | text (json) | `string[]` |
| created_at | text | |
| updated_at | text | |

### `task_emails`
Join table linking tasks to emails.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| task_id | text FK NOT NULL | → tasks.id (cascade delete) |
| email_id | text FK NOT NULL | → email_inbox.id (cascade delete) |

### `chat_sessions`
AI chat sessions with full message history stored as JSON.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| user_id | text NOT NULL | |
| task_id | text FK nullable | → tasks.id (set null on delete) |
| assignee_id | text FK nullable | → assignees.id (set null on delete) |
| title | text | |
| status | text | `starting` / `in_progress` / `waiting_confirmation` / `stopped` |
| messages | text (json) | `ModelMessage[]` - AI SDK native format |
| created_at | text | |
| updated_at | text | |

### `confirmations`
Pending/resolved tool confirmation requests.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| user_id | text NOT NULL | |
| chat_session_id | text FK NOT NULL | → chat_sessions.id (cascade delete) |
| tool_call_id | text NOT NULL | AI SDK tool call identifier |
| tool_name | text NOT NULL | e.g. `send_email` |
| parameters | text (json) | Tool input arguments |
| status | text | `pending` / `confirmed` / `rejected` |
| created_at | text | |
| resolved_at | text | |

### `devices`
iOS devices registered for push notifications.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| user_id | text NOT NULL | |
| device_token | text NOT NULL | APNs token |
| platform | text NOT NULL | `ios` only |
| created_at | text | |

## Relations

- `assignees` → has many `email_inbox`, `chat_sessions`
- `email_inbox` → belongs to `assignees`, has many `task_emails`
- `tasks` → has many `task_emails`, `chat_sessions`
- `task_emails` → belongs to `tasks` and `email_inbox`
- `chat_sessions` → belongs to `tasks` and `assignees`, has many `confirmations`
- `confirmations` → belongs to `chat_sessions`

## Task Status Sync

Task status auto-updates based on its chat sessions:
- Any session `starting` / `in_progress` / `waiting_confirmation` → task `running`
- All sessions `stopped` → task `finished`
- `cancelled` tasks are never auto-updated

Implemented in `lib/utils/task-status-sync.ts`, called after every chat session status change.
