#!/bin/bash

# Backend Build Script
# Builds the Linda Assistant Next.js backend

set -e
set -o pipefail

echo "======================================"
echo "Linda Assistant Backend Build Script"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"

if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${RED}Error: backend directory not found at $BACKEND_DIR${NC}"
    exit 1
fi

cd "$BACKEND_DIR"

if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: bun is not installed${NC}"
    echo "Install it: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo -e "${BLUE}Directory:${NC} $BACKEND_DIR"
echo -e "${BLUE}Bun:${NC} $(bun --version)"
echo ""

echo "Building backend..."
bun run build

echo ""
echo "======================================"
echo -e "${GREEN}Build succeeded!${NC}"
