#!/bin/bash
set -euo pipefail

: "${SIGNING_CERTIFICATE_NAME:?SIGNING_CERTIFICATE_NAME is required}"

ARCHIVE_PATH="${ARCHIVE_PATH:-output/output.xcarchive}"
APP_NAME="${APP_NAME:-LindaAssistant.app}"
APP_PATH="$ARCHIVE_PATH/Products/Applications/$APP_NAME"
SPARKLE_FRAMEWORK="$APP_PATH/Contents/Frameworks/Sparkle.framework"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: app not found at $APP_PATH"
  exit 1
fi

if [ ! -d "$SPARKLE_FRAMEWORK" ]; then
  echo "Error: Sparkle framework not found at $SPARKLE_FRAMEWORK"
  exit 1
fi

SPARKLE_VERSION_DIR=$(find "$SPARKLE_FRAMEWORK/Versions" -mindepth 1 -maxdepth 1 -type d ! -name Current | head -1)
if [ -z "$SPARKLE_VERSION_DIR" ]; then
  echo "Error: could not locate Sparkle framework version directory"
  exit 1
fi

sign_if_exists() {
  local path="$1"
  if [ -e "$path" ]; then
    codesign --force --options runtime --timestamp --sign "$SIGNING_CERTIFICATE_NAME" "$path"
  fi
}

sign_if_exists "$SPARKLE_VERSION_DIR/Sparkle"
sign_if_exists "$SPARKLE_VERSION_DIR/Updater.app"
sign_if_exists "$SPARKLE_VERSION_DIR/Autoupdate"
sign_if_exists "$SPARKLE_VERSION_DIR/XPCServices/Downloader.xpc"
sign_if_exists "$SPARKLE_VERSION_DIR/XPCServices/Installer.xpc"

codesign --force --options runtime --timestamp --sign "$SIGNING_CERTIFICATE_NAME" "$SPARKLE_FRAMEWORK"

MAIN_EXECUTABLE="$APP_PATH/Contents/MacOS/${APP_NAME%.app}"
sign_if_exists "$MAIN_EXECUTABLE"
codesign --force --options runtime --timestamp --sign "$SIGNING_CERTIFICATE_NAME" "$APP_PATH"

echo "Sparkle signing complete"
