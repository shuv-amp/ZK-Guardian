#!/bin/sh
set -e

# ==========================================
# Configuration
# ==========================================
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="/Users/shuv/Library/Android/sdk"
# Explicitly include /bin and /usr/bin for system tools
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$ANDROID_HOME/platform-tools:$PATH"

echo "=========================================="
echo "ZK-Guardian Environment Restart"
echo "=========================================="
echo "JAVA_HOME: $JAVA_HOME"
echo "ANDROID_HOME: $ANDROID_HOME"
echo "PATH: $PATH"

# ==========================================
# 1. Kill Existing Processes
# ==========================================
echo "\n[1/4] Killing existing processes..."

kill_port() {
  local port=$1
  local pid=$(/usr/sbin/lsof -ti:$port || echo "")
  if [ -n "$pid" ]; then
    echo "Killing process on port $port (PID: $pid)..."
    kill -9 $pid
    # Wait for it to die
    while /usr/sbin/lsof -ti:$port >/dev/null; do
      echo "Waiting for port $port to clear..."
      sleep 1
    done
    echo "Port $port cleared."
  else
    echo "Port $port is free."
  fi
}

kill_port 3000
kill_port 8081

# ==========================================
# 2. Clean Build Artifacts
# ==========================================
echo "\n[2/4] Cleaning build artifacts..."
cd apps/mobile/android
./gradlew clean
cd ../../..

# ==========================================
# 3. Start Gateway
# ==========================================
echo "\n[3/4.1] configuring Gateway Environment..."
ln -sf ../.env gateway/.env

echo "\n[3/4.2] Starting Gateway Server..."
# Run in background, redirect output
nohup pnpm --filter gateway dev > gateway.log 2>&1 &
echo "Gateway started (View logs: gateway.log)"

# Wait for Gateway to be ready (naive check)
echo "Waiting 5 seconds for Gateway to initialize..."
sleep 5

# ==========================================
# 4. Start Mobile App
# ==========================================
echo "\n[4/4] Starting Mobile App..."
# Run in background, redirect output
nohup ./apps/mobile/run_android.sh > mobile.log 2>&1 &
echo "Mobile app build started (View logs: mobile.log)"

echo "\n=========================================="
echo "Restart Sequence Complete"
echo "Check gateway.log and mobile.log for status."
echo "=========================================="
