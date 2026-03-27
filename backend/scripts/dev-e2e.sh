#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/.."

# Kill leftover MCP mock from previous run
lsof -ti:8098 | xargs kill 2>/dev/null || true

# Start MCP mock server in background
bun "$BACKEND_DIR/e2e/helpers/mcp-mock-server.ts" &
MCP_PID=$!

cleanup() {
  kill "$MCP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for MCP mock to be ready
for i in $(seq 1 20); do
  if curl -s -o /dev/null -w '' "http://localhost:8098" 2>/dev/null; then
    echo "MCP mock server ready on :8098"
    break
  fi
  sleep 0.25
done

# Setup DB and start Next.js dev server
bun "$BACKEND_DIR/scripts/setup-e2e-db.ts"
cd "$BACKEND_DIR"
exec bun --env-file=.env.e2e next dev
