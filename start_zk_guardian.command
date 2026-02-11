#!/bin/bash
cd "$(dirname "$0")"

echo "========================================"
echo "   ZK Guardian: One-Click Dev Start"
echo "========================================"

# --- Configuration ---
# Detect PNPM (try multiple locations or fallback)
if [ -f "/opt/homebrew/bin/pnpm" ]; then
    PNPM_PATH="/opt/homebrew/bin/pnpm"
elif [ -f "$HOME/Library/pnpm/pnpm" ]; then
    PNPM_PATH="$HOME/Library/pnpm/pnpm"
else
    PNPM_PATH="pnpm" # Hope it's in path
fi

ANDROID_HOME="$HOME/Library/Android/sdk"
# ---------------------

echo "🔧 Config:"
echo "   PNPM: $PNPM_PATH"
echo "   ANDROID_HOME: $ANDROID_HOME"

# 1. Kill duplicate processes
echo "🧹 Cleaning up existing processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8081 | xargs kill -9 2>/dev/null
echo "✅ Ports 3000 (Gateway) and 8081 (Metro) verified clear."

# 2. Start Gateway
echo "🚀 Launching Gateway..."
# We wrap in "bash -c" so it runs even if user's default shell is Fish (which hates 'export VAR=val')
osascript -e 'tell application "Terminal" to do script "bash -c \"cd \\\"'"$(pwd)"'\\\" && echo \\\"=== ZK GUARDIAN GATEWAY (Running in bash) ===\\\" && export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH && '$PNPM_PATH' gateway:dev; echo \\\"Process exited.\\\"; exec bash\""'

# 3. Start Emulator
echo "📱 Checking Emulator..."
EMULATOR_BIN="$ANDROID_HOME/emulator/emulator"
ADB_BIN="$ANDROID_HOME/platform-tools/adb"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

if ! "$ADB_BIN" devices 2>/dev/null | grep -q "emulator"; then
    echo "   Starting Pixel_9_Pro..."
    if [ -f "$EMULATOR_BIN" ]; then
         # Launch emulator
         osascript -e 'tell application "Terminal" to do script "bash -c \"'"$EMULATOR_BIN"' @Pixel_9_Pro; echo \\\"Emulator exited.\\\"; exec bash\""'
    else
         echo "⚠️ Emulator binary not found at $EMULATOR_BIN"
         echo "   Attempting to launch via Expo (might require manual start)..."
    fi
else
    echo "   Emulator already running."
fi

# 4. Start Mobile App
echo "📲 Launching Mobile App..."
sleep 5
# Launch mobile app using the robust helper script
osascript -e 'tell application "Terminal" to do script "bash -c \"cd \\\"'"$(pwd)"'\\\" && echo \\\"=== ZK GUARDIAN MOBILE (Running in bash) ===\\\" && ./apps/mobile/run_android.sh; echo \\\"Process exited.\\\"; exec bash\""'

echo "========================================"
echo "✅ All systems initiated!"
echo "   Check the popped-up Terminal windows for status."
echo "========================================"
# Keep this window open
exec bash
