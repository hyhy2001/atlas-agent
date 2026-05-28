#!/usr/bin/env bash
set -euo pipefail

# Install atlas-agent from pre-built binary
# Usage: ./install-binary.sh [path-to-binary]

BINARY="${1:-atlas-agent-linux-x64}"
INSTALL_DIR="/usr/local/bin"
MCP_INSTALL=true

if [ ! -f "$BINARY" ]; then
  echo "Error: Binary not found: $BINARY"
  echo "Usage: $0 <path-to-atlas-agent-binary>"
  exit 1
fi

echo "=== Installing atlas-agent ==="
echo ""

# Step 1: Install binary
echo "[1/3] Installing atlas-agent binary..."
if [ -w "$INSTALL_DIR" ]; then
  cp "$BINARY" "$INSTALL_DIR/atlas-agent"
  chmod +x "$INSTALL_DIR/atlas-agent"
else
  echo "  Need sudo to write to $INSTALL_DIR"
  sudo cp "$BINARY" "$INSTALL_DIR/atlas-agent"
  sudo chmod +x "$INSTALL_DIR/atlas-agent"
fi
echo "  Installed: $INSTALL_DIR/atlas-agent"
echo ""

# Step 2: Install codebase-memory-mcp (optional but recommended)
echo "[2/3] Installing codebase-memory-mcp (code intelligence...)"
if command -v codebase-memory-mcp >/dev/null 2>&1; then
  echo "  Already installed: $(which codebase-memory-mcp)"
else
  if curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash; then
    echo "  Installed successfully."
  else
    echo "  Warning: Failed to install. atlas-agent will work without it."
    echo "  Code intelligence tools will be unavailable."
  fi
fi
echo ""

# Step 3: Verify
echo "[3/3] Verifying..."
if command -v atlas-agent >/dev/null 2>&1; then
  echo "  atlas-agent: $(which atlas-agent)"
else
  echo "  Warning: atlas-agent not in PATH. Add $INSTALL_DIR to PATH."
fi
if command -v codebase-memory-mcp >/dev/null 2>&1; then
  echo "  codebase-memory-mcp: $(which codebase-memory-mcp)"
fi
echo ""

echo "=== Installation complete ==="
echo ""
echo "Configure your environment (add to ~/.bashrc):"
echo "  export ATLAS_AUTH_TOKEN=\"your-api-token\""
echo "  export ATLAS_BASE_URL=\"https://your-proxy-endpoint\""
echo ""
echo "Optional:"
echo "  export ATLAS_MODEL=\"claude-sonnet-4-20250514\""
echo "  export ATLAS_SUBAGENT_MODEL=\"claude-haiku-4-5-20251001\""
echo ""
echo "Then run:"
echo "  atlas-agent"