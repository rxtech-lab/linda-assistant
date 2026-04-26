# Linda Assistant

A personal, full-stack AI assistant. The iOS app surfaces chat, email, and task management. An AI agent (Claude) runs on the backend, acting autonomously on your behalf — drafting emails, creating tasks, and searching your inbox — with human-in-the-loop confirmation for sensitive actions.

---

## Screenshots

<table>
  <tr>
    <td align="center"><img src="images/chat.png" width="200" alt="Chat"><br><b>Chat</b><br>Converse with the AI agent — create documents, research topics, and get briefings</td>
    <td align="center"><img src="images/briefing.png" width="200" alt="Briefing"><br><b>Briefing</b><br>AI-generated briefings with rich card previews</td>
  </tr>
  <tr>
    <td align="center"><img src="images/task.png" width="200" alt="Task"><br><b>Tasks</b><br>Manage scheduled tasks with cron automation and status tracking</td>
    <td align="center"><img src="images/usage.png" width="200" alt="Usage"><br><b>Usage</b><br>Track token consumption, costs, and daily usage by assignee</td>
  </tr>
  <tr>
    <td align="center"><img src="images/models.png" width="200" alt="Model Selection"><br><b>Model Selection</b><br>Choose from multiple AI models per assistant</td>
    <td align="center"><img src="images/permissions.png" width="200" alt="Tool Permissions"><br><b>Tool Permissions</b><br>Fine-grained approval controls — auto-approve, require confirmation, or reject</td>
  </tr>
  <tr>
    <td align="center"><img src="images/document.png" width="200" alt="Document"><br><b>Documents</b><br>AI-created documents with original and PDF download options</td>
    <td align="center"><img src="images/extensions.png" width="200" alt="Extensions"><br><b>Extensions</b><br>Extend agent capabilities with system and custom extensions</td>
  </tr>
</table>

---

## Table of Contents

- [Screenshots](#screenshots)
- [Architecture Overview](#architecture-overview)
- [Components](#components)
- [Request & Agent Flow](#request--agent-flow)
- [CI / CD Pipelines](#ci--cd-pipelines)
- [Local Development](#local-development)

---

## Architecture Overview

```mermaid
graph TD
    subgraph iOS["iOS App (SwiftUI)"]
        A[Chat View]
        B[Task / Email Views]
    end

    subgraph Backend["Backend (Next.js · Bun)"]
        C[API Server\n/api/*]
        D[Worker Process\nworker/index.ts]
    end

    subgraph Services["Supporting Services"]
        E[(Turso\nlibSQL DB)]
        F[(Upstash Redis\nSSE cache)]
        G[RabbitMQ\nagent-tasks queue\nagent-events exchange]
    end

    subgraph External["External / Infra"]
        H[Anthropic Claude\nAI model]
        I[Resend\nEmail send + webhook]
        J[APNs\niOS push]
        K[AWS S3\nFile storage]
        L[RxLab OIDC\nAuth]
    end

    subgraph Python["Python Microservices"]
        M[Celery Scheduler\nFastAPI + RedBeat]
        N[Mem0 Server\nVector memory]
    end

    A -- "REST / SSE\nBearer token" --> C
    B -- "REST\nBearer token" --> C

    C -- "persist messages\nread sessions" --> E
    C -- "cache stream chunks" --> F
    C -- "publish agent-tasks" --> G
    C -- "presigned upload" --> K
    C -- "validate token" --> L

    G -- "consume agent-tasks" --> D
    D -- "run AI loop" --> H
    D -- "publish agent-events" --> G
    D -- "cache stream chunks" --> F
    D -- "write messages/status" --> E
    D -- "send push" --> J

    C -- "SSE: subscribe agent-events\nreplay Redis cache" --> G
    C -- "replay cache" --> F

    I -- "inbound webhook\nPOST /api/webhooks/resend" --> C

    M -- "POST /api/tasks/:id/execute\nschedule cron" --> C
    N -- "vector memory\nstore / search" --> D
```

---

## Components

### iOS App (`ios/`)

SwiftUI application. Communicates exclusively with the backend via REST and SSE. Uses `EventManager` for cross-view reactivity — every CRUD operation emits an `AppEvent` that other views subscribe to.

| Package | Purpose |
|---------|---------|
| `ios/` | Main app target — views, cache, UI logic |
| `packages/AssistantCore/` | Shared Swift package — API client, models, EventManager |

### Backend API Server (`backend/app/api/`)

Next.js 16 App Router running on Bun. All routes require a Bearer token validated against RxLab OIDC. Every database query is scoped by `userId`.

| Route group | Purpose |
|-------------|---------|
| `/api/assignees` | AI agent profiles (name, personality, model, tool permissions) |
| `/api/tasks` | Task management with cron scheduling |
| `/api/chat-sessions` | Chat history and message dispatch |
| `/api/chat-sessions/[id]/stream` | SSE stream for real-time agent output |
| `/api/confirmations` | Human-in-the-loop tool approvals |
| `/api/emails` | Email inbox |
| `/api/devices` | APNs device registration |
| `/api/uploads/presigned-url` | S3 presigned upload URLs |
| `/api/tools` | List available agent tools |
| `/api/webhooks/resend` | Inbound email webhook (Svix-verified) |

### Worker Process (`backend/worker/`)

A separate Bun process that consumes tasks from the `agent-tasks` RabbitMQ queue. Runs the AI agent loop to completion regardless of client connectivity. After each run, sends an APNs push notification with a response preview.

```
RabbitMQ [agent-tasks]
         │
         ▼
   Worker (Bun)
         │
         ├─ runAgent(sessionId, userId)
         │     ├─ streamText (Claude)
         │     ├─ publish events → [agent-events] exchange
         │     └─ cache chunks in Redis (for SSE replay)
         └─ APNs push notification
```

### Celery Scheduler (`celery/`)

Python FastAPI service with Celery + RedBeat. Manages cron schedules for periodic tasks. When a schedule fires, it calls the backend's `/api/tasks/:id/execute` endpoint to trigger the AI agent for that task.

### Mem0 Server (`mem0/`)

Python FastAPI service wrapping the [mem0](https://github.com/mem0ai/mem0) library. Provides long-term vector memory for the AI agent — stores and retrieves conversation facts using Qdrant or Upstash Vector.

---

## Request & Agent Flow

### Sending a Chat Message

```mermaid
sequenceDiagram
    participant iOS
    participant API as Backend API
    participant DB as Turso DB
    participant MQ as RabbitMQ
    participant W as Worker
    participant AI as Claude (Anthropic)
    participant R as Redis

    iOS->>API: POST /api/chat-sessions/:id/messages
    API->>DB: Append user message to session
    API->>MQ: Publish to agent-tasks queue
    API-->>iOS: { queued: true }

    iOS->>API: GET /api/chat-sessions/:id/stream (SSE)
    API->>R: Replay cached chunks
    API->>MQ: Subscribe to agent-events (session.{id})

    MQ->>W: Consume task
    W->>AI: streamText(messages, tools)
    AI-->>W: text-delta / tool-call / tool-result
    W->>MQ: Publish to agent-events
    W->>R: Cache chunks
    MQ-->>API: Forward events
    API-->>iOS: SSE events (text-delta, tool-call, done…)
    W->>DB: Save final messages + status
```

### Tool Confirmation Flow

When a tool requires human approval (e.g. `send_email`):

```mermaid
sequenceDiagram
    participant W as Worker
    participant DB as Turso DB
    participant APNs
    participant iOS
    participant API as Backend API
    participant MQ as RabbitMQ

    W->>DB: Save messages (paused state)
    W->>DB: Create confirmation record
    W->>APNs: Push notification → iOS
    W-->>iOS: SSE: confirmation_required

    iOS->>API: POST /api/confirmations/:id/resolve { action: "confirm" }
    API->>DB: Execute tool (send email via Resend)
    API->>DB: Append tool result to session
    API->>MQ: Publish confirmation_resolved task
    MQ->>W: Resume agent loop
```

### Inbound Email Auto-Dispatch

```mermaid
sequenceDiagram
    participant Resend
    participant API as Backend API
    participant DB as Turso DB
    participant MQ as RabbitMQ
    participant W as Worker

    Resend->>API: POST /api/webhooks/resend (Svix-verified)
    API->>DB: Store email + create chat session
    API->>MQ: Publish to agent-tasks
    MQ->>W: Consume task
    W->>W: Agent reads email and responds
```

---

## CI / CD Pipelines

### `playwright.yml` — E2E Tests

Runs on every push and pull request to `main`. Contains three jobs:

```mermaid
flowchart TD
    Push([Push / PR to main]) --> T[test]
    Push --> K[e2e-k8s\nPR only]
    T --> R[result]
    K --> R

    subgraph test["job: test (blacksmith-4vcpu)"]
        T1[Start RabbitMQ + Redis +\nMinIO via GitHub service containers]
        T2[bun install + Playwright install]
        T3[bun test — unit tests]
        T4[bun run test:e2e — backend E2E\nagainst local SQLite + services]
        T1 --> T2 --> T3 --> T4
    end

    subgraph k8s["job: e2e-k8s (blacksmith-4vcpu)"]
        K1[Build Docker images\nlinda-frontend, linda-worker, linda-mem0, linda-celery]
        K2[Start Minikube cluster]
        K3[Load images into Minikube]
        K4[Deploy via kubectl apply -k k8s/]
        K5[Wait for all deployments to roll out]
        K6[Port-forward frontend service]
        K7[Run backend-e2e Playwright tests\nagainst the Minikube cluster]
        K1 --> K2 --> K3 --> K4 --> K5 --> K6 --> K7
    end
```

**`test` job** runs the backend's own Playwright tests (`backend/e2e/`) against a local SQLite test database. It spins up RabbitMQ, Redis, and MinIO as GitHub service containers.

**`e2e-k8s` job** (pull requests only) provides a near-production smoke test:
1. Builds all four Docker images from source.
2. Starts a full Minikube cluster and loads the images.
3. Deploys the entire stack using `kubectl apply -k k8s/`.
4. Runs the `backend-e2e/` Playwright tests against the live cluster.

> **`backend-e2e/` vs `backend/e2e/`**
>
> | | `backend/e2e/` | `backend-e2e/` |
> |---|---|---|
> | Environment | Local SQLite + Docker services | Real Kubernetes cluster (Minikube in CI, production-like) |
> | Mocking | `IS_E2E=true` stubs (Svix, S3 …) | No mocking — all real services |
> | When it runs | Every push/PR (CI) | Pull requests only (CI), or against production |
> | Parallelism | Default Playwright | 4 workers, `fullyParallel: true` |

### `ios-ci.yml` — iOS CI

Runs on every push. Uses a reusable workflow (`ios-setup.yml`) with self-hosted macOS runners.

```mermaid
flowchart LR
    Push([Push]) --> B[build-ios\niPhone simulator build]
    Push --> BM[build-macos\nmacOS build]
    Push --> T[test\nRun iOS test plan\n3 parallel workers]
```

All three jobs run in parallel on `["self-hosted", "macOS"]` runners. The `test` job starts the backend server before running UI tests.

### `release.yml` — Docker Build & Deploy

Triggered on push/PR to `main` and on GitHub Release creation.

```mermaid
flowchart TD
    Push([Push / PR]) -->|build only + smoke test| BI
    Release([GitHub Release]) -->|build + push + deploy| BI

    subgraph BI["job: build-images (matrix × 4)"]
        I1[linda-frontend\ntarget: runner]
        I2[linda-worker\ntarget: worker]
        I3[linda-mem0\nPython FastAPI]
        I4[linda-celery\nPython Celery]
    end

    BI -->|on release| D[k8s-deploy]

    subgraph D["job: k8s-deploy"]
        D1[Push images to ghcr.io]
        D2["kubectl kustomize k8s/ | kubectl apply"]
        D3[bun drizzle-kit push — run DB migrations]
        D4[kubectl set image — update deployments]
        D5[kubectl rollout status — wait for rollout]
        D1 --> D2 --> D3 --> D4 --> D5
    end
```

On non-release runs each image also runs a health / smoke test:
- **linda-frontend**: PDF generation test with a headless Chrome sidecar.
- **linda-mem0**: FastAPI health check endpoint against a real Qdrant container.
- **linda-celery**: `/health` endpoint check.

---

## Local Development

Full setup instructions are in [`backend/docs/setup.md`](backend/docs/setup.md). Quick start:

```bash
# 1. Start infrastructure (RabbitMQ, Redis, MinIO)
cd backend && docker compose up -d

# 2. Install dependencies
bun install

# 3. Push DB schema
bun run db:push

# 4. Terminal A — API server
bun run dev

# 5. Terminal B — Worker
bun run worker:dev
```

### Scripts

| Script | What it does |
|--------|-------------|
| `./scripts/backend-build.sh` | Build the backend (`bun run build`) |
| `./scripts/backend-e2e.sh` | Kill port 3001, run backend Playwright E2E tests |
| `./scripts/backend-typecheck.sh` | Type-check backend (avoids Turbopack bug) |
| `./scripts/ios-build.sh` | Build iOS app via xcodebuild |
| `./scripts/ios-test-plan.sh` | Run iOS test plan |
| `./scripts/ios-update-openapi.sh` | Sync OpenAPI spec to iOS package |
| `./scripts/format.sh` | Format all code (Biome + SwiftFormat) |

### Further Reading

- [`backend/docs/architecture.md`](backend/docs/architecture.md) — detailed backend architecture
- [`backend/docs/agent-system.md`](backend/docs/agent-system.md) — AI agent loop, tools, confirmation flow, SSE streaming
- [`backend/docs/api-routes.md`](backend/docs/api-routes.md) — all API endpoints with examples
- [`backend/docs/database.md`](backend/docs/database.md) — full database schema reference
- [`backend/docs/setup.md`](backend/docs/setup.md) — environment variables and setup guide
