#!/bin/bash

# Backend Type Check Script
# Runs TypeScript type checking for the Linda Assistant backend
# Note: Don't use `bun run build` for type checking — it hits a Turbopack bug

set -e
set -o pipefail

echo "======================================"
echo "Linda Assistant Backend Type Check"
echo "======================================"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"

echo -e "${BLUE}Directory:${NC} $BACKEND_DIR"
echo ""

echo "Running type check..."
cd "$BACKEND_DIR" && ./node_modules/.bin/tsc --noEmit

echo ""
echo "======================================"
echo -e "${GREEN}Type check passed!${NC}"
