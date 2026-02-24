#!/bin/bash

# Xcode Cloud post-clone hook
# - Stamps app version from git tag (CI_TAG -> MARKETING_VERSION)
# - Sets build number from CI_BUILD_NUMBER
# - Decodes CI secrets into local config files (optional)
# - Starts backend + regenerates OpenAPI client for iOS builds/tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_PROJECT_DIR="$REPO_ROOT/ios"
IOS_PROJECT_FILE="$IOS_PROJECT_DIR/ios.xcodeproj/project.pbxproj"

echo "== Xcode Cloud: ci_post_clone =="
echo "Repo root: $REPO_ROOT"

# Xcode plugin/macro validation often blocks CI for generated code plugins.
defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES || true
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES || true

if [[ -n "${CI_TAG:-}" ]]; then
  VERSION="${CI_TAG#v}"
  if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?$ ]]; then
    echo "Stamping MARKETING_VERSION from CI_TAG: $CI_TAG -> $VERSION"
    sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/g" "$IOS_PROJECT_FILE"

    if [[ -n "${CI_BUILD_NUMBER:-}" ]]; then
      echo "Stamping CURRENT_PROJECT_VERSION from CI_BUILD_NUMBER: $CI_BUILD_NUMBER"
      (
        cd "$IOS_PROJECT_DIR"
        xcrun agvtool new-version -all "$CI_BUILD_NUMBER"
      )
    else
      echo "CI_BUILD_NUMBER not set; skipping CURRENT_PROJECT_VERSION update"
    fi
  else
    echo "CI_TAG '$CI_TAG' is not a semver tag; skipping version stamping"
  fi
else
  echo "CI_TAG not set; skipping version stamping"
fi

if [[ -x "$REPO_ROOT/scripts/decode-env-secrets.sh" ]]; then
  "$REPO_ROOT/scripts/decode-env-secrets.sh"
else
  echo "scripts/decode-env-secrets.sh not found; skipping optional secret decoding"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
fi

if [[ -d "$REPO_ROOT/backend" ]]; then
  echo "Starting backend in background for OpenAPI generation..."
  (
    cd "$REPO_ROOT/backend"
    bun install
    bun dev > "$REPO_ROOT/backend-xcode-cloud.log" 2>&1
  ) &
  BACKEND_PID=$!

  cleanup() {
    if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill "$BACKEND_PID" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT

  echo "Waiting for backend (http://localhost:3000)..."
  for _ in {1..60}; do
    if curl -fsS http://localhost:3000 >/dev/null 2>&1; then
      echo "Backend is ready"
      break
    fi
    sleep 1
  done

  if ! curl -fsS http://localhost:3000 >/dev/null 2>&1; then
    echo "Backend did not become ready in time"
    exit 1
  fi
fi

echo "Generating iOS OpenAPI client assets..."
(cd "$REPO_ROOT" && ./scripts/ios-update-openapi.sh)

echo "ci_post_clone completed"
