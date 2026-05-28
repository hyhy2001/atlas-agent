#!/usr/bin/env bash
set -euo pipefail

VERSION="${ATLAS_VERSION:-latest}"
BASE_URL="${ATLAS_INSTALL_URL:-https://artifacts.company.local/atlas-agent}"
INSTALL_DIR="$HOME/.atlas-agent"

echo "=== Installing atlas-agent ==="
echo ""

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) echo "Error: Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_NAME="x64" ;;
  aarch64|arm64) ARCH_NAME="arm64" ;;
  *) echo "Error: Unsupported architecture: $ARCH"; exit 1 ;;
esac

ASSET="atlas-agent-v${VERSION}-${PLATFORM}-${ARCH_NAME}.tar.gz"
[ "$VERSION" = "latest" ] && ASSET="atlas-agent-latest-${PLATFORM}-${ARCH_NAME}.tar.gz"

echo "Platform: ${PLATFORM}-${ARCH_NAME}"
echo "Source:   ${BASE_URL}/${ASSET}"
echo "Install:  ${INSTALL_DIR}"
echo ""

echo "[1/4] Downloading..."
TMPFILE="$(mktemp)"
if ! curl -fsSL "${BASE_URL}/${ASSET}" -o "$TMPFILE"; then
  echo "Error: Download failed. Check ATLAS_INSTALL_URL or network."
  rm -f "$TMPFILE"
  exit 1
fi

echo "[2/4] Installing to ${INSTALL_DIR}..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMPFILE" -C "$INSTALL_DIR"
rm -f "$TMPFILE"
chmod +x "$INSTALL_DIR/atlas-agent" 2>/dev/null || true

echo "[3/4] Running setup (downloading code intelligence)..."
[ -f "$INSTALL_DIR/setup.sh" ] && bash "$INSTALL_DIR/setup.sh"

echo "[4/4] Adding to PATH..."
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/atlas-agent" "$BIN_DIR/atlas-agent"

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  case "${SHELL:-}" in
    */zsh)  RC="$HOME/.zshrc" ;;
    */bash) RC="$HOME/.bashrc" ;;
    *)      RC="$HOME/.profile" ;;
  esac
  if [ -n "$RC" ] && ! grep -q "\.local/bin" "$RC" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$RC"
    echo "  Added ~/.local/bin to PATH in $RC"
  fi
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "atlas-agent installed to: $INSTALL_DIR"
echo "Symlink:                  $BIN_DIR/atlas-agent"
echo ""
echo "Configure (add to your shell profile):"
echo "  export ATLAS_AUTH_TOKEN=\"your-token\""
echo "  export ATLAS_BASE_URL=\"http://your-proxy:port/v1\""
echo ""
echo "Then run: atlas-agent"
