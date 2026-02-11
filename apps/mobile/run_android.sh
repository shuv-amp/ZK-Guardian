#!/bin/sh
# Explicitly set Java and Android Home for this session
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="/Users/shuv/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$ANDROID_HOME/platform-tools:$PATH"

echo "Using JAVA_HOME: $JAVA_HOME"
echo "Starting Android build..."

# Ensure we are in the mobile app directory
cd "$(dirname "$0")"

echo "Checking Java version:"
"$JAVA_HOME/bin/java" -version

echo "Checking Gradle wrapper:"
cd android
./gradlew --version
echo "Cleaning previous build..."
./gradlew clean
cd ..

# Run the standard expo android command
pnpm run android
