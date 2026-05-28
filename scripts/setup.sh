#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
CACHE_DIR="$SCRIPT_DIR/cache"
SESSIONS_DIR="$SCRIPT_DIR/sessions"

echo "=== atlas-agent setup ==="
mkdir -p "$BIN_DIR" "$CACHE_DIR" "$SESSIONS_DIR"

echo "[1/1] Downloading codebase-memory-mcp..."
if [ -f "$BIN_DIR/codebase-memory-mcp" ]; then
  echo "  Already exists. Skipping."
else
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) ARCH_NAME="linux-x86_64" ;;
    aarch64|arm64) ARCH_NAME="linux-aarch64" ;;
    *) echo "Unsupported: $ARCH"; exit 1 ;;
  esac
  URL="https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/codebase-memory-mcp-${ARCH_NAME}.tar.gz"
  if curl -fsSL "$URL" -o /tmp/cbm.tar.gz; then
    tar -xzf /tmp/cbm.tar.gz -C "$BIN_DIR"
    chmod +x "$BIN_DIR/codebase-memory-mcp" 2>/dev/null || true
    rm -f /tmp/cbm.tar.gz
    echo "  Installed."
  else
    echo "  Warning: download failed. Agent will work without code intelligence."
  fi
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Set env vars:"
echo "  export ATLAS_AUTH_TOKEN=\"your-token\""
echo "  export ATLAS_BASE_URL=\"http://your-proxy:port/v1\""
echo ""
echo "Run: $SCRIPT_DIR/atlas-agent"
