#!/bin/bash
set -euo pipefail

: "${SPARKLE_KEY:?SPARKLE_KEY is required}"
: "${VERSION:?VERSION is required}"

REPO="${GITHUB_REPOSITORY:-rxtech-lab/linda-assistant}"
BUILD_NUMBER="${BUILD_NUMBER:-}"
RELEASE_NOTE="${RELEASE_NOTE:-}"
RELEASE_TAG="${RELEASE_TAG:-$VERSION}"
GENERATE_APPCAST_BIN="${GENERATE_APPCAST_BIN:-./bin/generate_appcast}"

if [ ! -x "$GENERATE_APPCAST_BIN" ]; then
  echo "Error: generate_appcast binary not found or not executable at $GENERATE_APPCAST_BIN"
  exit 1
fi

printf '%s' "$SPARKLE_KEY" > sparkle.key
chmod 600 sparkle.key

if [ -n "$RELEASE_NOTE" ]; then
  printf '%s\n' "$RELEASE_NOTE" > release_notes.md
else
  printf 'Release %s\n' "$VERSION" > release_notes.md
fi

python3 scripts/convert-markdown.py release_notes.md release_notes.html

"$GENERATE_APPCAST_BIN" ./ \
  --ed-key-file sparkle.key \
  --link "https://github.com/${REPO}/releases" \
  --download-url-prefix "https://github.com/${REPO}/releases/download/${RELEASE_TAG}/"

python3 scripts/update-xml.py appcast.xml release_notes.html "$BUILD_NUMBER"

rm -f sparkle.key release_notes.md

echo "Generated appcast.xml and release_notes.html"
