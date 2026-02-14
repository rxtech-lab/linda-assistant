# Linda Assistant

## Commands

All commands should be run via the `scripts/` folder from the project root.

- `./scripts/backend-build.sh` — build the backend (runs `bun run build` in `backend/`)
- `./scripts/backend-e2e.sh` — run backend E2E tests (kills port 3001 first, then runs Playwright)
- `./scripts/backend-typecheck.sh` — type check backend (don't use `bun run build` — it hits a Turbopack bug)
- `./scripts/ios-build.sh` — build the iOS app via xcodebuild (auto-detects simulator)
- `./scripts/ios-test-plan.sh` — run iOS test plan
- `./scripts/ios-update-openapi.sh` — sync OpenAPI spec to iOS package
- `./scripts/format.sh` — format all code (backend with Biome, iOS with SwiftFormat)
  - `--check` — check only, don't write
  - `--backend` / `--ios` — format only one target
- `./scripts/setup-hooks.sh` — install git pre-commit hook for auto-formatting

## Backend

### Tech Stack

- **Runtime**: Next.js 16 App Router, **Bun** (always use `bun` not npm/yarn)
- **Database**: Turso (libSQL) + Drizzle ORM (`lib/db/schema.ts`)
- **Cache**: Upstash Redis (transient stream state only)
- **AI**: Vercel AI SDK v6 + Anthropic Claude (`lib/ai/agent.ts`)
- **Email**: Resend (send + inbound webhook)
- **Storage**: AWS S3 (presigned uploads)
- **Push**: APNs (iOS only)
- **API Docs**: next-openapi-gen + Scalar UI at `/api-docs`

### Key Commands

- `bun run dev` — start dev server
- `bun run db:push` — push schema to Turso
- `bun run db:generate` — generate Drizzle migrations
- `bun run openapi:generate` — regenerate `public/openapi.json`
- `bun run test:e2e` — Playwright E2E tests

### Architecture Conventions

- All routes require Bearer token auth validated against RxLab OIDC userinfo (`lib/auth/middleware.ts`)
- Every DB query is scoped by `userId` — never return data across users
- Chat messages stored as `ModelMessage[]` JSON in `chat_sessions.messages` column (not a separate table)
- Agent uses manual `streamText` loop (not `maxSteps`) to support mid-loop pause for tool confirmations
- Redis stores only ephemeral data (stream chunks, active flags, triggers) — DB is source of truth

### CRUD API Route Pattern

All CRUD routes follow the same pattern:
1. `authenticate(request)` → get `userId` or return 401
2. Zod-parse request body
3. Query/mutate DB scoped by `userId`
4. Return via `successJson()`, `errorJson()`, or `paginatedJson()`
5. Export Zod schemas + JSDoc `@openapi` tags for OpenAPI generation

### AI SDK v6 Conventions

- Tool definitions use `inputSchema` (NOT `parameters`)
- `text-delta` stream part property is `.text` (NOT `.textDelta`)
- Tool call property is `.input` (NOT `.args`)
- Tool result property is `.output` (NOT `.result`)
- Tools without `execute` function require `outputSchema` to compile
- Import `ModelMessage` type from `ai` package

### Known Issues

- `bun run build` crashes with Turbopack bug — use `./scripts/backend-typecheck.sh` or `npx tsc --noEmit` for type checking
- `next-openapi-gen` `schemaDir` must NOT include `node_modules` or it OOMs

## iOS

### Event-Driven Updates

The iOS app uses `EventManager` (in `AssistantCore`) with `AppEvent` enum for cross-view reactivity. When any view performs CRUD on a resource, it must:

1. **Emit** the event via `eventManager.emit(.resourceCreated/Updated/Deleted(...))`
2. **Subscribe** in every view that displays that resource, using `subscribeToEvents()` in a `.task` modifier

Existing event types: `assigneeCreated/Updated/Deleted`, `taskCreated/Updated/Deleted`, `emailUpdated/Deleted`, `chatSessionCreated/Deleted`, `confirmationResolved`, `error`.

### UI Conventions

- Sheet components follow naming convention `*Sheet.swift` and use closure callbacks for actions (e.g., `onSelectAssignee`, `onClearMessages`)
- Date dividers in chat messages use `shouldShowDateDivider()` to check `Calendar.isDate(_:inSameDayAs:)` between consecutive messages
- iOS app uses MarkdownUI library for markdown rendering and Highlightr for syntax highlighting in chat messages

## Project Structure

- `backend/` — Next.js 16 API server (Bun runtime)
  - `app/api/` — API route handlers
  - `lib/` — shared libraries (db, ai, auth, etc.)
  - `e2e/` — Playwright E2E tests
  - `docs/` — detailed documentation
- `ios/` — iOS app (SwiftUI)
  - `ios/` — main iOS app target
  - `packages/AssistantCore/` — shared Swift package (API client, models, event manager)
- `scripts/` — build and test scripts for both platforms
- `mem0/` — FastAPI memory service

## Documentation

See `backend/docs/` for detailed backend documentation:
- `docs/architecture.md` — system overview and directory structure
- `docs/database.md` — full schema reference
- `docs/api-routes.md` — all endpoints with examples
- `docs/agent-system.md` — agent loop, tools, confirmation flow, SSE streaming
- `docs/setup.md` — environment variables and setup guide
