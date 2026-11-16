#!/usr/bin/env bash
set -euo pipefail

# scripts/build-apk.sh
# Build Apollo Android APK for local development or production release.
#
# Usage:
#   ./scripts/build-apk.sh dev              # Builds dev APK pointing to local LAN IP (port 3000)
#   ./scripts/build-apk.sh dev 192.168.1.50 # Builds dev APK pointing to custom LAN IP
#   ./scripts/build-apk.sh prod             # Builds prod APK pointing to https://apollo.metaspexet.se
#   ./scripts/build-apk.sh prod https://mychoir.com # Builds prod APK pointing to custom domain

MODE="${1:-dev}"
CUSTOM_TARGET="${2:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$MODE" = "prod" ]; then
  SERVER_URL="${CUSTOM_TARGET:-https://apollo.metaspexet.se}"
  echo "============================================="
  echo " Building Production APK"
  echo " Server URL: $SERVER_URL"
  echo "============================================="
elif [ "$MODE" = "dev" ]; then
  if [ -n "$CUSTOM_TARGET" ]; then
    if [[ "$CUSTOM_TARGET" == http* ]]; then
      SERVER_URL="$CUSTOM_TARGET"
    else
      SERVER_URL="https://${CUSTOM_TARGET}:3000"
    fi
  else
    # Auto-detect macOS Wi-Fi / Ethernet LAN IP
    LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "192.168.1.218")
    SERVER_URL="https://${LAN_IP}:3000"
  fi
  echo "============================================="
  echo " Building Local Dev / Test APK"
  echo " Server URL: $SERVER_URL"
  echo "============================================="
else
  echo "Usage: ./scripts/build-apk.sh [dev|prod] [custom_url_or_ip]"
  exit 1
fi

# 1. Update capacitor.config.json server.url
node -e "
const fs = require('fs');
const path = './capacitor.config.json';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.server = config.server || {};
config.server.url = '$SERVER_URL';
fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
"

# 2. Update DEFAULT_SERVER_URL in MainActivity.java
MAIN_ACTIVITY="android/app/src/main/java/com/apollo/choir/MainActivity.java"
if [ -f "$MAIN_ACTIVITY" ]; then
  node -e "
const fs = require('fs');
const file = '$MAIN_ACTIVITY';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /private static final String DEFAULT_SERVER_URL = \".*?\";/,
  'private static final String DEFAULT_SERVER_URL = \"$SERVER_URL\";'
);
fs.writeFileSync(file, content);
"
fi

# 3. Build web bundle and sync with Capacitor
echo "==> Building web assets..."
npm run build

echo "==> Syncing Capacitor Android..."
npx cap sync android

# 4. Assemble Android APK via Gradle
echo "==> Assembling Android APK..."
cd "$ROOT_DIR/android"
./gradlew assembleDebug

APK_SRC="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"

if [ -f "$APK_SRC" ]; then
  cp "$APK_SRC" "$ROOT_DIR/public/apollo.apk"
  cp "$APK_SRC" "$ROOT_DIR/dist/apollo.apk"
  echo "==> APK generated successfully at:"
  echo "    - $ROOT_DIR/public/apollo.apk"
  echo "    - $ROOT_DIR/dist/apollo.apk"

  # If local web container is running, deploy it directly for local testing
  if docker ps --format '{{.Names}}' | grep -q "^apollo-web-1$"; then
    echo "==> Deploying APK to local apollo-web-1 container..."
    docker cp "$ROOT_DIR/dist/apollo.apk" apollo-web-1:/usr/share/nginx/html/apollo.apk 2>/dev/null || true
  fi
else
  echo "Error: Gradle build succeeded but app-debug.apk not found at $APK_SRC" >&2
  exit 1
fi

echo "============================================="
if [ "$MODE" = "prod" ]; then
  echo " Production APK ready!"
  echo " You can attach public/apollo.apk to your GitHub Release at:"
  echo " https://github.com/datasektionen/apollo/releases"
else
  echo " Local Dev APK ready!"
  echo " You can install it on your device connected to the same Wi-Fi."
fi
echo "============================================="
