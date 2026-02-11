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
