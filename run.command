#!/bin/bash
# Deez Currency Calculator — one-click Tauri desktop launch (macOS).
# Long-lived tauri:dev runs in dale tmux when available; Finder Terminal closes after handoff.
cd "$(dirname "$0")"
ROOT="$(pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

WIN="deez-currency-calculator"
STICKY_PORT=5181

command -v node >/dev/null || { echo "Node.js required."; read -r; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm required (npm i -g pnpm)."; read -r; exit 1; }
command -v rustc >/dev/null || { echo "Rust required (https://rustup.rs)."; read -r; exit 1; }
command -v cargo >/dev/null || { echo "Cargo required (https://rustup.rs)."; read -r; exit 1; }

if [ ! -d node_modules ]; then
  echo "Installing JavaScript dependencies..."
  pnpm install || { echo "pnpm install failed."; read -r; exit 1; }
fi

# Tauri beforeDevCommand starts Vite on the sticky port. Free it if this
# project's leftover Vite (e.g. prior dale-tmux pnpm dev) still holds it.
free_sticky_port() {
  local pid cwd
  pid=$(lsof -nP -iTCP:"$STICKY_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n1 || true)
  if [ -z "$pid" ]; then
    return 0
  fi
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1)
  if [ "$cwd" != "$ROOT" ]; then
    echo "Port $STICKY_PORT is in use by another process (PID $pid)."
    echo "Stop that process, then try again."
    return 1
  fi
  echo "Freeing sticky port $STICKY_PORT (PID $pid — this project's Vite)..."
  kill "$pid" 2>/dev/null || true
  local i=0
  while [ "$i" -lt 20 ]; do
    if ! lsof -nP -iTCP:"$STICKY_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.1
  done
  echo "Port $STICKY_PORT still busy after stopping PID $pid."
  return 1
}

free_sticky_port || { read -r; exit 1; }

start_in_terminal() {
  echo "Starting Deez Currency Calculator (Tauri)..."
  pnpm tauri:dev
  status=$?
  echo
  if [ $status -ne 0 ]; then
    echo "App failed to start (exit $status)."
  else
    echo "App stopped."
  fi
  echo "Press Enter to close."
  read -r
  exit $status
}

if command -v dale-tmux-window >/dev/null 2>&1; then
  if dale-tmux-window -n "$WIN" -c "$ROOT" -- pnpm tauri:dev; then
    command -v dale-tmux-close-launcher >/dev/null 2>&1 && dale-tmux-close-launcher
    exit 0
  fi
fi

echo "tmux unavailable; running in this Terminal."
start_in_terminal
