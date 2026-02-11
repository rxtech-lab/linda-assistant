#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND_DIR="$PROJECT_ROOT/backend"
IOS_DIR="$PROJECT_ROOT/ios"

CHECK_ONLY=false
TARGET="all" # all, backend, ios

for arg in "$@"; do
  case $arg in
    --check)
      CHECK_ONLY=true
      ;;
    --backend)
      TARGET="backend"
      ;;
    --ios)
      TARGET="ios"
      ;;
  esac
done

format_backend() {
  echo "==> Formatting backend (Biome)..."
  cd "$BACKEND_DIR"

  if ! command -v bunx &> /dev/null; then
    echo "Error: bun is not installed"
    exit 1
  fi

  if [ "$CHECK_ONLY" = true ]; then
    bunx biome format .
  else
    bunx biome format --write .
  fi

  echo "==> Backend formatting done."
}

format_ios() {
  echo "==> Formatting iOS (SwiftFormat)..."

  if ! command -v swiftformat &> /dev/null; then
    echo "Error: swiftformat is not installed. Install with: brew install swiftformat"
    exit 1
  fi

  if [ "$CHECK_ONLY" = true ]; then
    swiftformat --lint "$IOS_DIR"
  else
    swiftformat "$IOS_DIR"
  fi

  echo "==> iOS formatting done."
}

case $TARGET in
  backend)
    format_backend
    ;;
  ios)
    format_ios
    ;;
  all)
    format_backend
    format_ios
    ;;
esac

echo "==> All done."
