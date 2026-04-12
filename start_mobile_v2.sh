#!/bin/sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/Users/shuv/Library/Android/sdk
export PATH=$JAVA_HOME/bin:/opt/homebrew/bin:/usr/bin:/bin:$ANDROID_HOME/platform-tools:$PATH
echo "PATH: $PATH"

cd apps/mobile
npx expo run:android
