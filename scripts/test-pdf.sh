#!/usr/bin/env bash
# Test PDF generation using the built Docker image and headless Chrome.
# Usage: ./scripts/test-pdf.sh [frontend-image] [chrome-image]
#
# This script:
# 1. Creates a Docker network
# 2. Starts headless Chrome container
# 3. Runs the PDF generation test inside the frontend container
# 4. Cleans up all containers and network

set -euo pipefail

FRONTEND_IMAGE="${1:-linda-frontend:test}"
CHROME_IMAGE="${2:-ghcr.io/rxtech-lab/headless-chrome-cjk:latest}"
NETWORK="pdf-test-net"

cleanup() {
  echo "Cleaning up..."
  docker rm -f pdf-chrome pdf-frontend 2>/dev/null || true
  docker network rm "$NETWORK" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== PDF Generation Test ==="

# Create network
docker network create "$NETWORK"

# Start headless Chrome
echo "Starting headless Chrome..."
docker run -d --name pdf-chrome --network "$NETWORK" \
  -p 9222:9222 \
  "$CHROME_IMAGE"

# Wait for Chrome to be ready (health check from host via port mapping)
echo "Waiting for Chrome to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:9222/json/version > /dev/null 2>&1; then
    echo "Chrome is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Chrome failed to start"
    docker logs pdf-chrome
    exit 1
  fi
  sleep 1
done

# Run PDF generation test inside the frontend container
echo "Running PDF generation test..."
docker run --name pdf-frontend --network "$NETWORK" \
  -e CHROME_URL="ws://pdf-chrome:9222" \
  --entrypoint bun \
  "$FRONTEND_IMAGE" \
  run scripts/test-pdf-generate.ts

echo "=== PDF test passed ==="
