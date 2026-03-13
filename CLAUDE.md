# Linda Assistant

## Commands

All commands should be run via the `scripts/` folder from the project root.

- `./scripts/backend-build.sh` — build the backend (runs `bun run build` in `backend/`)
- `./scripts/backend-e2e.sh` — run backend E2E tests (kills port 3001 first, then runs Playwright)
- `./scripts/ios-build.sh` — build the iOS app via xcodebuild (auto-detects simulator)
- `./scripts/ios-test-plan.sh` — run iOS test plan
- `./scripts/ios-update-openapi.sh` — sync OpenAPI spec to iOS package
- `./scripts/format.sh` — format all code (backend with Biome, iOS with SwiftFormat)
  - `--check` — check only, don't write
  - `--backend` / `--ios` — format only one target
- `./scripts/setup-hooks.sh` — install git pre-commit hook for auto-formatting

## Type Checking

- Backend: `./scripts/backend-typecheck.sh` (don't use `bun run build` for type checking — it hits a Turbopack bug)

## iOS Event-Driven Updates

The iOS app uses `EventManager` (in `AssistantCore`) with `AppEvent` enum for cross-view reactivity. When any view performs CRUD on a resource, it must:

1. **Emit** the event via `eventManager.emit(.resourceCreated/Updated/Deleted(...))`
2. **Subscribe** in every view that displays that resource, using `subscribeToEvents()` in a `.task` modifier

Existing event types: `assigneeCreated/Updated/Deleted`, `taskCreated/Updated/Deleted`, `emailUpdated/Deleted`, `chatSessionCreated/Deleted`, `confirmationResolved`, `error`.

# iOS SwiftUI Test with viewinspector

Always use view inspector to inspect view and interact with view when user wants to write unit test on views. Do not create a new view for the test or just do some basic expect text tests. Need to use sut for real test and always use original view to test! Do not verify the state directly, use UI to verify! Use UI to verify! Just like a regular user who cannot see the states directly!
