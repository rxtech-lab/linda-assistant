#!/bin/bash
set -euo pipefail

if [ "${SKIP_NOTARIZE:-false}" != "true" ]; then
  : "${APPLE_ID:?APPLE_ID is required}"
  : "${APPLE_ID_PWD:?APPLE_ID_PWD is required}"
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
fi

ARCHIVE_PATH="${ARCHIVE_PATH:-output/output.xcarchive}"
APP_NAME="${APP_NAME:-LindaAssistant.app}"
DMG_NAME="${DMG_NAME:-${APP_NAME%.app}.dmg}"
APP_PATH="$ARCHIVE_PATH/Products/Applications/$APP_NAME"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: app not found at $APP_PATH"
  exit 1
fi

rm -f ./*.dmg "$DMG_NAME"
create-dmg --overwrite "$APP_PATH"

CREATED_DMG=$(ls -1 ./*.dmg | head -1)
if [ -z "$CREATED_DMG" ]; then
  echo "Error: no DMG generated"
  exit 1
fi

mv "$CREATED_DMG" "$DMG_NAME"

if [ "${SKIP_NOTARIZE:-false}" = "true" ]; then
  echo "Skipping notarization (SKIP_NOTARIZE=true)"
else
  xcrun notarytool submit "$DMG_NAME" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_ID_PWD" \
    --wait

  xcrun stapler staple "$DMG_NAME"
  xcrun stapler validate "$DMG_NAME"

  echo "Notarization and stapling complete: $DMG_NAME"
fi
