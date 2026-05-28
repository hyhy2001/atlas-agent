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

# Create a tarball for distribution
echo "Creating release tarball..."
cd "$OUT_DIR"
tar -czf "atlas-agent-v${VERSION}-linux-x64.tar.gz" atlas-agent-linux-x64
echo "  Created: $OUT_DIR/atlas-agent-v${VERSION}-linux-x64.tar.gz"
echo ""

echo "=== Build complete ==="
echo ""
echo "To distribute:"
echo "  1. Copy atlas-agent-v${VERSION}-linux-x64.tar.gz to your internal file server"
echo "  2. Team members download and extract:"
echo "     tar -xzf atlas-agent-v${VERSION}-linux-x64.tar.gz"
echo "     chmod +x atlas-agent-linux-x64"
echo "     sudo mv atlas-agent-linux-x64 /usr/local/bin/atlas-agent"
echo ""
echo "  3. Set environment variables:"
echo "     export ATLAS_AUTH_TOKEN=\"your-token\""
echo "     export ATLAS_BASE_URL=\"https://your-proxy\""
echo ""
echo "  4. Run:"
echo "     atlas-agent"