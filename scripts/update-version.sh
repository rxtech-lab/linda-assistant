#!/bin/bash
set -euo pipefail

VERSION="${1:-}"
BUILD_NUMBER="${2:-}"
PROJECT_FILE="ios/ios.xcodeproj/project.pbxproj"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [build_number]"
  echo "Example: $0 1.2.3 42"
  exit 1
fi

if [ ! -f "$PROJECT_FILE" ]; then
  echo "Error: $PROJECT_FILE not found"
  exit 1
fi

echo "Updating MARKETING_VERSION to $VERSION"
sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = $VERSION;/g" "$PROJECT_FILE"

if [ -n "$BUILD_NUMBER" ]; then
  echo "Updating CURRENT_PROJECT_VERSION to $BUILD_NUMBER"
  sed -i '' -E "s/CURRENT_PROJECT_VERSION = [^;]+;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" "$PROJECT_FILE"
fi

echo "Version update complete"
