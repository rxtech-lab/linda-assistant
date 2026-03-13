#!/bin/bash
# Update OpenAPI spec for AssistantCore iOS package
# Generates the OpenAPI spec from backend Zod schemas and copies it to the iOS package.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND_DIR="$REPO_ROOT/backend"
SOURCE_FILE="$BACKEND_DIR/public/openapi.json"
TARGET_FILE="$REPO_ROOT/ios/packages/AssistantCore/Sources/AssistantCore/openapi.json"

echo "Generating OpenAPI spec..."
(cd "$BACKEND_DIR" && bun run openapi:generate)

if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "Error: Generated OpenAPI spec not found at $SOURCE_FILE"
    exit 1
fi

mkdir -p "$(dirname "$TARGET_FILE")"
cp "$SOURCE_FILE" "$TARGET_FILE"

# Validate that the file is valid JSON
echo "Validating JSON..."
if ! python3 -m json.tool "$TARGET_FILE" > /dev/null 2>&1; then
    echo "Error: Generated file is not valid JSON"
    exit 1
fi

echo "OpenAPI spec updated at: $TARGET_FILE"
