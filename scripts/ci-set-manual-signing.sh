#!/bin/bash
# Temporarily patches the Xcode project to use manual code signing for CI.
# Usage:
#   ./scripts/ci-set-manual-signing.sh <signing_identity> <provisioning_profile_name>
#
# The project.pbxproj is modified in-place. In CI, the repo is a fresh checkout
# so no revert is needed. For local testing, use git checkout to restore.
set -e

SIGNING_IDENTITY="${1:?Usage: $0 <signing_identity> <provisioning_profile_name>}"
PROFILE_NAME="${2:?Usage: $0 <signing_identity> <provisioning_profile_name>}"

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
