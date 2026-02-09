#!/bin/bash
# Update OpenAPI spec for AssistantCore iOS package
# Default: http://localhost:3000/api/openapi
# Override: Set OPENAPI_DOCUMENTATION_ENDPOINT environment variable
# Example: OPENAPI_DOCUMENTATION_ENDPOINT=https://linda.rxlab.app/api/openapi ./scripts/ios-update-openapi.sh

set -e

cd "$(dirname "$0")/.."

cd ./backend
bun run openapi:generate

cd ..

TARGET_FILE="./ios/packages/AssistantCore/Sources/AssistantCore/openapi.json"

mkdir -p "$(dirname "$TARGET_FILE")"

ENDPOINT="${OPENAPI_DOCUMENTATION_ENDPOINT:-http://localhost:3000/openapi.json}"

echo "Downloading OpenAPI spec from: $ENDPOINT"
curl -sS -o "$TARGET_FILE" "$ENDPOINT"

# Validate that the downloaded file is valid JSON
echo "Validating JSON..."
if ! python3 -m json.tool "$TARGET_FILE" > /dev/null 2>&1; then
    echo "Error: Downloaded file is not valid JSON"
    echo "Contents of $TARGET_FILE:"
    head -20 "$TARGET_FILE"
    exit 1
fi

echo "OpenAPI spec updated at: $TARGET_FILE"
