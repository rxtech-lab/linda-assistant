#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Configuring git to use .githooks directory..."
cd "$PROJECT_ROOT"
git config core.hooksPath .githooks

echo "Making hooks executable..."
chmod +x .githooks/*

echo "Git hooks installed successfully."
