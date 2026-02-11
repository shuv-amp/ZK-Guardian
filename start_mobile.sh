#!/usr/bin/env fish

set -x ANDROID_HOME /Users/shuv/Library/Android/sdk
set -x PATH $PATH $ANDROID_HOME/platform-tools

echo "ANDROID_HOME: $ANDROID_HOME"
echo "PATH: $PATH"

pnpm mobile:android
