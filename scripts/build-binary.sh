#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$PROJECT_DIR/release"

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")

echo "=== Building atlas-agent v${VERSION} binary ==="
echo ""

# Check bun is installed
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

echo "Using Bun: $(bun --version)"
echo ""

mkdir -p "$OUT_DIR"

# Build for Linux x64 (RHEL8 compatible — glibc >= 2.27)
echo "[1/3] Compiling for linux-x64..."
cd "$PROJECT_DIR"
bun build --compile --minify \
  --target=bun-linux-x64 \
  ./src/cli.ts \
  --outfile "$OUT_DIR/atlas-agent-linux-x64"

echo ""
echo "[2/3] Setting permissions..."
chmod +x "$OUT_DIR/atlas-agent-linux-x64"

echo ""
echo "[3/3] Build info:"
ls -lh "$OUT_DIR/atlas-agent-linux-x64"
echo ""

# Create portable distribution directory
echo "Creating portable distribution..."
DIST_DIR="$OUT_DIR/dist"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/bin" "$DIST_DIR/config" "$DIST_DIR/cache" "$DIST_DIR/sessions"

cp "$OUT_DIR/atlas-agent-linux-x64" "$DIST_DIR/atlas-agent"
chmod +x "$DIST_DIR/atlas-agent"
cp "$PROJECT_DIR/scripts/setup.sh" "$DIST_DIR/setup.sh"
chmod +x "$DIST_DIR/setup.sh"

cat > "$DIST_DIR/config/config.json" <<'JSON'
{
  "model": "all",
  "mcpServers": [
    {
      "name": "codebase-memory",
      "command": "./bin/codebase-memory-mcp",
      "args": [],
      "autoApprove": true
    }
  ]
}
JSON

cat > "$DIST_DIR/README.txt" <<'README'
atlas-agent — AI Coding Assistant (Portable)
=============================================

Quick Start:
  1. Run setup (one-time, downloads code intelligence binary):
     ./setup.sh

  2. Set credentials (add to ~/.bashrc or set before running):
     export ATLAS_AUTH_TOKEN="your-token"
     export ATLAS_BASE_URL="http://your-proxy:port/v1"

  3. Run:
     ./atlas-agent

Everything is contained in this directory — no root, no home dir writes.
  atlas-agent       Main binary
  bin/              Code intelligence binary (after setup.sh)
  config/           Config file
  cache/            Code knowledge graph database
  sessions/         Saved conversations

Environment variables:
  ATLAS_BASE_URL          Required. Your LLM proxy endpoint.
  ATLAS_AUTH_TOKEN        Required. Your API token.
  ATLAS_MODEL             Optional. Model name (default: "all").
  ATLAS_SUBAGENT_MODEL    Optional. Cheaper model for subagents.

In-agent commands: type /help inside the REPL.
README

# Pack contents directly (no subdirectory wrapper)
tar -czf "$OUT_DIR/atlas-agent-v${VERSION}-linux-x64.tar.gz" -C "$DIST_DIR" .
rm -rf "$DIST_DIR"
echo "  Created: $OUT_DIR/atlas-agent-v${VERSION}-linux-x64.tar.gz"
echo ""

echo "=== Build complete ==="
echo ""
echo "To distribute:"
echo "  1. Copy atlas-agent-v${VERSION}-linux-x64.tar.gz to your file server"
echo "  2. Team members:"
echo "     mkdir atlas-agent && cd atlas-agent"
echo "     tar -xzf atlas-agent-v${VERSION}-linux-x64.tar.gz"
echo "     ./setup.sh"
echo "     export ATLAS_AUTH_TOKEN=\"your-token\""
echo "     export ATLAS_BASE_URL=\"http://your-proxy:port/v1\""
echo "     ./atlas-agent"