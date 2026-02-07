# Linda Assistant Backend - Architecture

## Overview

Backend-only Next.js 16 API server powering a personal assistant that manages emails, tasks, and AI-powered chat sessions with human-in-the-loop tool confirmations. Multi-user system where every resource is scoped by `userId` from external RxLab OAuth.

## Tech Stack

- **Runtime**: Next.js 16 App Router (API routes only)
- **Database**: Turso (libSQL) via Drizzle ORM
- **Cache/State**: Upstash Redis
- **AI**: Vercel AI SDK v6 + Anthropic Claude
- **Email**: Resend (send + inbound webhooks)
- **Storage**: AWS S3 (presigned uploads)
- **Push**: Apple Push Notification service (APNs)
- **API Docs**: next-openapi-gen + Scalar UI

## Directory Structure

```
backend/
├── app/
│   ├── api/
│   │   ├── assignees/          # Agent profiles CRUD
│   │   │   ├── route.ts        # GET (list), POST (create)
│   │   │   └── [id]/route.ts   # GET, PUT, DELETE
│   │   ├── emails/             # Email inbox CRUD
│   │   │   ├── route.ts
│   │   │   └── [id]/route.ts
│   │   ├── tasks/              # Tasks CRUD
│   │   │   ├── route.ts
│   │   │   └── [id]/
│   │   │       ├── route.ts          # GET (with embedded sessions/emails), PUT, DELETE
│   │   │       └── chat-sessions/route.ts  # GET sessions for task
│   │   ├── chat-sessions/      # Chat session management
│   │   │   ├── route.ts        # GET (list), POST (create)
│   │   │   └── [id]/
│   │   │       ├── route.ts          # GET (with messages), DELETE
│   │   │       ├── messages/route.ts  # POST (send message, triggers agent)
│   │   │       └── stream/route.ts    # GET (SSE stream)
│   │   ├── confirmations/      # Tool confirmation management
│   │   │   ├── route.ts        # GET (list pending)
│   │   │   └── [id]/resolve/route.ts  # POST (confirm/reject)
│   │   ├── devices/            # Push notification devices
│   │   │   ├── route.ts        # POST (register)
│   │   │   └── [id]/route.ts   # DELETE (unregister)
│   │   ├── uploads/
│   │   │   └── presigned-url/route.ts  # POST (get S3 upload URL)
│   │   ├── tools/route.ts      # GET (list available tools)
│   │   └── webhooks/
│   │       └── resend/route.ts # POST (inbound email webhook)
│   ├── api-docs/page.tsx       # Scalar API documentation UI
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── ai/
│   │   ├── agent.ts            # Manual agent loop with streamText
│   │   ├── confirmation.ts     # Confirmation create/resolve logic
│   │   └── tools/
│   │       ├── index.ts        # Tool registry and builder
│   │       ├── send-email.ts   # Requires confirmation (no execute)
│   │       ├── search-emails.ts
│   │       ├── create-task.ts
│   │       └── update-task.ts
│   ├── auth/middleware.ts       # Bearer token → userId via OIDC userinfo
│   ├── db/
│   │   ├── schema.ts           # 7 Drizzle table definitions
│   │   ├── relations.ts        # Drizzle relation definitions
│   │   └── index.ts            # Database client singleton
│   ├── push/index.ts           # APNs push notification sender
│   ├── redis/index.ts          # Upstash Redis singleton
│   ├── resend/index.ts         # Resend client singleton
│   ├── s3/index.ts             # S3 client + presigned URL helper
│   ├── schemas/index.ts        # Zod schemas (drizzle-zod + custom)
│   ├── streaming/
│   │   ├── manager.ts          # Redis-backed stream chunk caching
│   │   └── sse.ts              # SSE stream creation utilities
│   └── utils/
│       ├── pagination.ts       # Pagination schema and parser
│       ├── response.ts         # JSON response helpers
│       └── task-status-sync.ts # Auto-sync task status from chat sessions
├── drizzle.config.ts           # Drizzle Kit config for Turso
├── next.openapi.json           # OpenAPI generator config
└── public/openapi.json         # Generated OpenAPI spec
```

## Key Design Decisions

### Messages stored as JSON in chat_sessions
Rather than a separate `chat_messages` table, messages are stored as a `ModelMessage[]` JSON array in `chat_sessions.messages`. This preserves the AI SDK's native message format (tool calls, parts, results) without lossy decomposition into relational columns.

### Manual agent loop (not maxSteps)
The agent uses a manual `while` loop around `streamText` instead of `maxSteps` to support mid-loop pausing when a tool requires human confirmation. When `send_email` is called, the loop saves state to the database, creates a confirmation record, sends a push notification, and returns control.

### Per-assignee model configuration
Each assignee has an optional `model` field (e.g., `claude-sonnet-4-5-20250929`) allowing users to configure different AI models for different agent personas. Defaults to Claude Sonnet 4.5.

### Redis for transient state only
Redis stores only ephemeral data: stream chunks for SSE replay, stream active flags, and agent trigger signals. All persistent state lives in the database. This means Redis can be flushed without data loss.
