#!/bin/bash

# Backend E2E Test Script
# Runs Playwright E2E tests for the Linda Assistant backend

set -e
set -o pipefail

echo "======================================"
echo "Linda Assistant Backend E2E Tests"
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

# Kill any existing process on port 3001 to avoid conflicts
if lsof -ti:3001 > /dev/null 2>&1; then
    echo -e "${BLUE}Killing existing process on port 3001...${NC}"
    kill $(lsof -ti:3001) 2>/dev/null || true
    sleep 1
fi

echo "Running E2E tests..."
cd "$BACKEND_DIR" && bun run test:e2e

echo ""
echo "======================================"
echo -e "${GREEN}E2E tests completed!${NC}"
