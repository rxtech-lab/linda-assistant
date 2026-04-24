#!/bin/bash
# Temporarily patches the Xcode project to use manual code signing for CI.
# Usage:
#   ./scripts/ci-set-manual-signing.sh <signing_identity> <app_profile_name> [share_profile_name]
#
# The project.pbxproj is modified in-place. In CI, the repo is a fresh checkout
# so no revert is needed. For local testing, use git checkout to restore.
set -e

SIGNING_IDENTITY="${1:?Usage: $0 <signing_identity> <app_profile_name> [share_profile_name]}"
PROFILE_NAME="${2:?Usage: $0 <signing_identity> <app_profile_name> [share_profile_name]}"
SHARE_PROFILE_NAME="${3:-}"

PBXPROJ="$(dirname "$0")/../ios/ios.xcodeproj/project.pbxproj"

if [ ! -f "$PBXPROJ" ]; then
  echo "Error: project.pbxproj not found at $PBXPROJ"
  exit 1
fi

# Replace Automatic signing with Manual and update identity/profile in the
# LindaAssistant app target's Release build configuration.
# UUID DF7E2A162F378F47006A4C0A is the Release config for LindaAssistant target.
sed -i '' \
  "/DF7E2A162F378F47006A4C0A.*Release/,/};/ {
    s/CODE_SIGN_STYLE = Automatic/CODE_SIGN_STYLE = Manual/
    s/CODE_SIGN_IDENTITY = \"[^\"]*\"/CODE_SIGN_IDENTITY = \"${SIGNING_IDENTITY}\"/
    s/PROVISIONING_PROFILE_SPECIFIER = \"[^\"]*\"/PROVISIONING_PROFILE_SPECIFIER = \"${PROFILE_NAME}\"/
  }" "$PBXPROJ"

echo "Patched project.pbxproj for manual signing (identity: $SIGNING_IDENTITY, profile: $PROFILE_NAME)"

# Patch the ShareLinda app extension Release build configuration.
# UUID DFECD8192F9BB41F00B62399 is the Release config for the ShareLinda target.
# That block does not currently contain a PROVISIONING_PROFILE_SPECIFIER line,
# so we both replace CODE_SIGN_STYLE and append the specifier on the next line.
if [ -n "$SHARE_PROFILE_NAME" ]; then
  sed -i '' \
    "/DFECD8192F9BB41F00B62399.*Release/,/};/ {
      s/CODE_SIGN_STYLE = Automatic/CODE_SIGN_STYLE = Manual/
      s/CODE_SIGN_IDENTITY = \"[^\"]*\"/CODE_SIGN_IDENTITY = \"${SIGNING_IDENTITY}\"/
      s|CODE_SIGN_STYLE = Manual;|CODE_SIGN_STYLE = Manual;\\
				PROVISIONING_PROFILE_SPECIFIER = \"${SHARE_PROFILE_NAME}\";|
    }" "$PBXPROJ"

  echo "Patched project.pbxproj for ShareLinda manual signing (profile: $SHARE_PROFILE_NAME)"
fi
