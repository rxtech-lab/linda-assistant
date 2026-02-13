#!/bin/bash

# macOS Build Script for Linda Assistant

set -e
set -o pipefail

echo "======================================"
echo "Linda Assistant macOS Build Script"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_PATH="$PROJECT_ROOT/ios/ios.xcodeproj"
SCHEME="${SCHEME:-LindaAssistant}"
CONFIGURATION="${CONFIGURATION:-Debug}"
BUILD_DIR="${BUILD_DIR:-.build}"

# Use generic macOS destination - let Xcode pick the architecture
DESTINATION="platform=macOS"
ARCH=$(uname -m)
echo -e "${BLUE}🖥️  Runner Architecture:${NC} $ARCH"

echo -e "${BLUE}📦 Project:${NC} $PROJECT_PATH"
echo -e "${BLUE}🎯 Scheme:${NC} $SCHEME"
echo -e "${BLUE}⚙️  Configuration:${NC} $CONFIGURATION"
echo -e "${BLUE}🖥️  Destination:${NC} $DESTINATION"
echo ""

# Clean build folder
echo "🧹 Cleaning build folder..."
xcodebuild clean \
    -project "$PROJECT_PATH" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    > /dev/null 2>&1 || true

echo ""
echo "🔨 Building Linda Assistant for macOS..."
echo ""

set +e  # Temporarily disable exit on error to capture the exit code

if command -v xcbeautify &> /dev/null; then
    xcodebuild build \
        -project "$PROJECT_PATH" \
        -scheme "$SCHEME" \
        -configuration "$CONFIGURATION" \
        -destination "$DESTINATION" \
        -derivedDataPath "$BUILD_DIR" \
        -skipPackagePluginValidation \
        -skipMacroValidation \
        CODE_SIGN_IDENTITY="-" \
        CODE_SIGNING_REQUIRED=NO \
        CODE_SIGNING_ALLOWED=NO \
        CODE_SIGN_ENTITLEMENTS="" \
        ENABLE_HARDENED_RUNTIME=NO \
        ONLY_ACTIVE_ARCH=YES \
        SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD=NO \
        ENABLE_APP_THINNING=NO \
        2>&1 | tee build-macos.log | xcbeautify
    BUILD_EXIT_CODE=${PIPESTATUS[0]}
else
    xcodebuild build \
        -project "$PROJECT_PATH" \
        -scheme "$SCHEME" \
        -configuration "$CONFIGURATION" \
        -destination "$DESTINATION" \
        -derivedDataPath "$BUILD_DIR" \
        -skipPackagePluginValidation \
        -skipMacroValidation \
        CODE_SIGN_IDENTITY="-" \
        CODE_SIGNING_REQUIRED=NO \
        CODE_SIGNING_ALLOWED=NO \
        CODE_SIGN_ENTITLEMENTS="" \
        ENABLE_HARDENED_RUNTIME=NO \
        ONLY_ACTIVE_ARCH=YES \
        SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD=NO \
        ENABLE_APP_THINNING=NO \
        2>&1 | tee build-macos.log
    BUILD_EXIT_CODE=${PIPESTATUS[0]}
fi

set -e  # Re-enable exit on error

echo ""
echo "======================================"

if [ $BUILD_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ macOS build succeeded!${NC}"
    echo ""
    echo "Build log saved to: build-macos.log"
    exit 0
else
    echo -e "${RED}❌ macOS build failed!${NC}"
    echo ""
    echo "Build log saved to: build-macos.log"
    echo ""
    echo "======================================"
    echo "Error details from build log:"
    echo "======================================"
    # Extract errors and warnings from the build log
    grep -E "error:|fatal:|failed|BUILD FAILED" build-macos.log | tail -50 || true
    echo ""
    echo "======================================"
    echo "Last 30 lines of build log:"
    echo "======================================"
    tail -30 build-macos.log || true
    exit 1
fi
