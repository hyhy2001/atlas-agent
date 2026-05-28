#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$PROJECT_DIR/release"
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")

echo "=== Building atlas-agent v${VERSION} for all platforms ==="
echo ""

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

echo "Using Bun: $(bun --version)"
echo ""

mkdir -p "$OUT_DIR"
cd "$PROJECT_DIR"

PLATFORMS=("linux-x64" "linux-arm64" "darwin-arm64" "darwin-x64" "windows-x64")
BUN_TARGETS=("bun-linux-x64" "bun-linux-arm64" "bun-darwin-arm64" "bun-darwin-x64" "bun-windows-x64")

for i in "${!PLATFORMS[@]}"; do
  platform="${PLATFORMS[$i]}"
  target="${BUN_TARGETS[$i]}"
  ext=""
  [[ "$platform" == "windows-x64" ]] && ext=".exe"

  echo "[Building] ${platform}..."
  if ! bun build --compile --minify --target="${target}" ./src/cli.ts --outfile "$OUT_DIR/atlas-agent-${platform}${ext}" 2>/dev/null; then
    echo "  Skipped (cross-compile not available for ${platform})"
    continue
  fi

  echo "  Binary: $OUT_DIR/atlas-agent-${platform}${ext}"

  # Create dist package
  DIST_DIR="$OUT_DIR/dist-${platform}"
  rm -rf "$DIST_DIR"
  mkdir -p "$DIST_DIR/bin" "$DIST_DIR/config" "$DIST_DIR/cache" "$DIST_DIR/sessions"

  cp "$OUT_DIR/atlas-agent-${platform}${ext}" "$DIST_DIR/atlas-agent${ext}"
  chmod +x "$DIST_DIR/atlas-agent${ext}" 2>/dev/null || true
  cp "$PROJECT_DIR/scripts/setup.sh" "$DIST_DIR/setup.sh"
  chmod +x "$DIST_DIR/setup.sh" 2>/dev/null || true

  # Windows setup.bat
  if [[ "$platform" == "windows-x64" ]]; then
    cat > "$DIST_DIR/setup.bat" <<'BAT'
@echo off
echo === atlas-agent setup ===
if exist bin\codebase-memory-mcp.exe (
  echo Already installed. Skipping.
  goto done
)
mkdir bin 2>nul
echo Downloading codebase-memory-mcp...
curl -fsSL -o bin\codebase-memory-mcp.exe https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/codebase-memory-mcp-windows-x86_64.exe
if %errorlevel% neq 0 (
  echo Warning: download failed. Agent will work without code intelligence.
)
:done
echo.
echo Setup complete. Set env vars:
echo   set ATLAS_AUTH_TOKEN=your-token
echo   set ATLAS_BASE_URL=http://your-proxy:port/v1
echo Then run: atlas-agent.exe
BAT
  fi

  cat > "$DIST_DIR/config/settings.json" <<'JSON'
{
  "model": "all",
  "fastModel": "all",
  "reasoningModel": "all",
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

  cat > "$DIST_DIR/README.txt" <<README
atlas-agent v${VERSION} — AI Coding Assistant (Portable)
=========================================================

Quick Start:
  1. Run setup (one-time):
     ./setup.sh        (Linux/macOS)
     setup.bat         (Windows)

  2. Set credentials:
     export ATLAS_AUTH_TOKEN="your-token"
     export ATLAS_BASE_URL="http://your-proxy:port/v1"

  3. Run:
     ./atlas-agent     (Linux/macOS)
     atlas-agent.exe   (Windows)

Fully portable — no root/admin, no home dir writes.

Environment variables:
  ATLAS_BASE_URL          Required. LLM proxy endpoint.
  ATLAS_AUTH_TOKEN        Required. API token.
  ATLAS_MODEL             Optional. Main model (default: "all").
  ATLAS_FAST_MODEL        Optional. Fast model for executors.
  ATLAS_REASONING_MODEL   Optional. Reasoning model for rescue.

Commands: type /help inside the REPL.
README

  # Package
  if [[ "$platform" == "windows-x64" ]] && command -v zip >/dev/null 2>&1; then
    (cd "$DIST_DIR" && zip -qr "$OUT_DIR/atlas-agent-v${VERSION}-${platform}.zip" .)
    echo "  Package: atlas-agent-v${VERSION}-${platform}.zip"
  else
    tar -czf "$OUT_DIR/atlas-agent-v${VERSION}-${platform}.tar.gz" -C "$DIST_DIR" .
    echo "  Package: atlas-agent-v${VERSION}-${platform}.tar.gz"
  fi

  rm -rf "$DIST_DIR"
  echo ""
done

echo "=== Build complete ==="
echo ""
echo "Release artifacts:"
ls -lh "$OUT_DIR"/atlas-agent-v${VERSION}-*.{tar.gz,zip} 2>/dev/null || true
