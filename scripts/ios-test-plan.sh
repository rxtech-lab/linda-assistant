#!/bin/bash

# iOS Test Plan Script
# Runs the Linda Assistant iOS test plan (iosTests + AssistantCoreTests)

set -e  # Exit on error
set -o pipefail  # Catch errors in pipes

echo "======================================"
echo "Linda Assistant iOS Test Plan"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_PATH="$PROJECT_ROOT/ios/ios.xcodeproj"
SCHEME="${SCHEME:-LindaAssistant}"
TEST_PLAN="${TEST_PLAN:-TestPlan}"
CONFIGURATION="${CONFIGURATION:-Debug}"
SDK="${SDK:-iphonesimulator}"
BUILD_DIR="${BUILD_DIR:-$PROJECT_ROOT/.build}"

# Find an available iOS simulator if DESTINATION is not set
if [ -z "$DESTINATION" ]; then
    echo "🔍 Finding available iOS simulator..."
    SIMULATOR_NAME=$(xcrun simctl list devices available --json | jq -r '.devices | to_entries | .[] | select(.key | contains("iOS")) | .value[] | select(.isAvailable == true) | .name' | head -1)

    if [ -z "$SIMULATOR_NAME" ]; then
        echo -e "${RED}❌ Error: No available iOS simulator found${NC}"
        echo "Please install an iOS simulator via Xcode > Settings > Platforms"
        exit 1
    fi

    DESTINATION="platform=iOS Simulator,name=$SIMULATOR_NAME,OS=latest"
    echo "📱 Auto-detected simulator: $SIMULATOR_NAME"
fi

# Check if project exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo -e "${RED}❌ Error: $PROJECT_PATH not found${NC}"
    exit 1
fi

echo -e "${BLUE}📦 Project:${NC} $PROJECT_PATH"
echo -e "${BLUE}🎯 Scheme:${NC} $SCHEME"
echo -e "${BLUE}📋 Test Plan:${NC} $TEST_PLAN"
echo -e "${BLUE}⚙️  Configuration:${NC} $CONFIGURATION"
echo -e "${BLUE}📱 SDK:${NC} $SDK"
echo -e "${BLUE}🎯 Destination:${NC} $DESTINATION"
echo -e "${BLUE}📂 Build Directory:${NC} $BUILD_DIR"
echo ""

# Run tests
echo "🧪 Running test plan..."
echo ""

set +e  # Temporarily disable exit on error to capture the exit code

if command -v xcbeautify &> /dev/null; then
    xcodebuild test \
        -project "$PROJECT_PATH" \
        -scheme "$SCHEME" \
        -testPlan "$TEST_PLAN" \
        -configuration "$CONFIGURATION" \
        -destination "$DESTINATION" \
        -derivedDataPath "$BUILD_DIR" \
        -skipPackagePluginValidation \
        -skipMacroValidation \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGNING_REQUIRED=NO \
        CODE_SIGNING_ALLOWED=NO \
        2>&1 | xcbeautify
    TEST_EXIT_CODE=${PIPESTATUS[0]}
else
    xcodebuild test \
        -project "$PROJECT_PATH" \
        -scheme "$SCHEME" \
        -testPlan "$TEST_PLAN" \
        -configuration "$CONFIGURATION" \
        -destination "$DESTINATION" \
        -derivedDataPath "$BUILD_DIR" \
        -skipPackagePluginValidation \
        -skipMacroValidation \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGNING_REQUIRED=NO \
        CODE_SIGNING_ALLOWED=NO \
        2>&1
    TEST_EXIT_CODE=$?
fi

set -e  # Re-enable exit on error

echo ""
echo "======================================"

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Tests failed!${NC}"
    exit 1
fi
