#!/usr/bin/env bash
# Convenience wrapper around `npm run android:build` for machines whose default Node/JDK are
# too old: Capacitor CLI 8 needs Node >= 22, Capacitor Android 8 needs JDK >= 21 (Gradle 9.3).
# It only picks newer toolchains if they exist; otherwise the build uses whatever is on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ] && [ -d "$HOME/.nvm/versions/node" ]; then
  candidate=$(ls -d "$HOME"/.nvm/versions/node/v2[2-9]* 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "${candidate:-}" ]; then export PATH="$candidate/bin:$PATH"; fi
fi

java_major() { "$1/bin/java" -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/'; }
if [ -z "${JAVA_HOME:-}" ] || [ "$(java_major "$JAVA_HOME")" -lt 21 ]; then
  for jdk in /usr/lib/jvm/*21* /usr/lib/jvm/*2[2-9]* /snap/android-studio/current/jbr "$HOME"/android-studio/jbr /opt/android-studio/jbr; do
    if [ -x "$jdk/bin/java" ] && [ "$(java_major "$jdk")" -ge 21 ]; then export JAVA_HOME="$jdk"; break; fi
  done
fi

echo "node $(node -v), JAVA_HOME=${JAVA_HOME:-<unset>}"
npm run build
npm run android:build
echo "APK: $(pwd)/android/app/build/outputs/apk/debug/app-debug.apk"
