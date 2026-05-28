#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
CACHE_DIR="$SCRIPT_DIR/cache"
SESSIONS_DIR="$SCRIPT_DIR/sessions"

echo "=== atlas-agent setup ==="
mkdir -p "$BIN_DIR" "$CACHE_DIR" "$SESSIONS_DIR"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  OS_NAME="linux" ;;
  Darwin) OS_NAME="macos" ;;
  MINGW*|MSYS*|CYGWIN*) OS_NAME="windows" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_NAME="x86_64" ;;
  aarch64|arm64) ARCH_NAME="aarch64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo "Detected: ${OS_NAME} ${ARCH_NAME}"
echo ""

BINARY_NAME="codebase-memory-mcp"
[ "$OS_NAME" = "windows" ] && BINARY_NAME="codebase-memory-mcp.exe"

echo "[1/1] Installing codebase-memory-mcp..."
if [ -f "$BIN_DIR/$BINARY_NAME" ]; then
  echo "  Already exists. Skipping."
else
  case "${OS_NAME}-${ARCH_NAME}" in
    linux-x86_64)   ASSET="codebase-memory-mcp-linux-x86_64.tar.gz" ;;
    linux-aarch64)  ASSET="codebase-memory-mcp-linux-aarch64.tar.gz" ;;
    macos-aarch64)  ASSET="codebase-memory-mcp-macos-aarch64.tar.gz" ;;
    macos-x86_64)   ASSET="codebase-memory-mcp-macos-x86_64.tar.gz" ;;
    windows-x86_64) ASSET="codebase-memory-mcp-windows-x86_64.zip" ;;
    *) echo "  No pre-built binary for ${OS_NAME}-${ARCH_NAME}. Skipping MCP."; exit 0 ;;
  esac

  URL="https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/${ASSET}"
  echo "  Downloading: $URL"
  TMPFILE="/tmp/cbm-download.$$"
  if curl -fsSL "$URL" -o "$TMPFILE"; then
    case "$ASSET" in
      *.tar.gz) tar -xzf "$TMPFILE" -C "$BIN_DIR" ;;
      *.zip)    unzip -o "$TMPFILE" -d "$BIN_DIR" >/dev/null ;;
    esac
    chmod +x "$BIN_DIR/$BINARY_NAME" 2>/dev/null || true
    rm -f "$TMPFILE"
    echo "  Installed: $BIN_DIR/$BINARY_NAME"
  else
    rm -f "$TMPFILE"
    echo "  Warning: download failed. atlas-agent will work without code intelligence."
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
