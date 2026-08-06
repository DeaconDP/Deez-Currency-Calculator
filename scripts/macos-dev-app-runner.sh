#!/bin/bash
# Cargo runner: execute deez-currency-calculator from inside a thin .app so
# macOS Dock / Cmd-Tab / quit use icon.icns instead of the generic "exec" icon.
# The bundle executable is a wrapper: cold Dock launches start tauri:dev when
# Vite is not already on the sticky port (avoids a blank WebView).
set -euo pipefail

BIN="${1:-}"
if [ -z "$BIN" ]; then
  echo "macos-dev-app-runner: missing binary path" >&2
  exit 1
fi
shift

BASE="$(basename "$BIN")"
if [ "$BASE" != "deez-currency-calculator" ]; then
  exec "$BIN" "$@"
fi

# Cargo invokes this with CWD = src-tauri (package root).
# Prefer walking up from the binary: target/debug/deez-currency-calculator
BIN_DIR="$(cd "$(dirname "$BIN")" && pwd)"
BIN_ABS="$BIN_DIR/$BASE"
SRC_TAURI="$(cd "$BIN_DIR/../.." && pwd)"
ROOT="$(cd "$SRC_TAURI/.." && pwd)"

ICNS="$SRC_TAURI/icons/icon.icns"
if [ ! -f "$ICNS" ]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  SRC_TAURI="$ROOT/src-tauri"
  ICNS="$SRC_TAURI/icons/icon.icns"
fi

APP="$BIN_DIR/Deez Currency Calculator.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
APP_WRAPPER="$MACOS/deez-currency-calculator"
APP_REAL="$MACOS/deez-currency-calculator-bin"
STICKY_PORT=5181
WIN="deez-currency-calculator"

mkdir -p "$MACOS" "$RESOURCES"

if [ ! -f "$CONTENTS/Info.plist" ]; then
  cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Deez Currency Calculator</string>
  <key>CFBundleExecutable</key>
  <string>deez-currency-calculator</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundleIdentifier</key>
  <string>online.deac.currency-calculator</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Deez Currency Calculator</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST
fi

cp -f "$ICNS" "$RESOURCES/icon.icns"
# Real binary under a different name; wrapper is CFBundleExecutable.
cp -f "$BIN_ABS" "$APP_REAL"
chmod +x "$APP_REAL"

# Bake ROOT / port into the Dock-launchable wrapper (not a symlink — Launch Services).
cat > "$APP_WRAPPER" <<WRAPPER
#!/bin/bash
set -euo pipefail
ROOT=$(printf '%q' "$ROOT")
STICKY_PORT=$STICKY_PORT
WIN=$(printf '%q' "$WIN")
REAL="\$(cd "\$(dirname "\$0")" && pwd)/deez-currency-calculator-bin"
export PATH="/opt/homebrew/bin:/usr/local/bin:\$HOME/.local/bin:\$HOME/.cargo/bin:\$PATH"

if lsof -nP -iTCP:"\$STICKY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  exec "\$REAL" "\$@"
fi

if command -v dale-tmux-window >/dev/null 2>&1; then
  if dale-tmux-window -n "\$WIN" -c "\$ROOT" -- pnpm tauri:dev; then
    exit 0
  fi
fi

open "\$ROOT/run.command"
WRAPPER
chmod +x "$APP_WRAPPER"

# Refresh Launch Services icon registration for this bundle (best-effort).
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true

exec "$APP_WRAPPER" "$@"
