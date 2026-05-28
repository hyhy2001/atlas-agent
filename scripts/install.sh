#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$HOME/.local/bin"
MODE=""

# Parse args
for arg in "$@"; do
  case "$arg" in
    --docker) MODE="docker" ;;
    --native) MODE="native" ;;
    --help|-h)
      echo "Usage: ./scripts/install.sh [--docker|--native]"
      echo ""
      echo "  --docker  Build Docker image + create wrapper (default if Docker available)"
      echo "  --native  Install via npm + create symlink (requires Node.js >= 20)"
      echo ""
      echo "Both modes install codebase-memory-mcp for code intelligence."
      exit 0
      ;;
  esac
done

# Auto-detect mode if not specified
if [ -z "$MODE" ]; then
  if command -v docker >/dev/null 2>&1; then
    MODE="docker"
  elif command -v node >/dev/null 2>&1; then
    MODE="native"
  else
    echo "Error: Neither Docker nor Node.js found. Install one of them first."
    exit 1
  fi
fi

echo "=== atlas-agent installer (mode: $MODE) ==="
echo ""

# --- Step 1: Install codebase-memory-mcp ---
echo "[1/3] Installing codebase-memory-mcp..."
if command -v codebase-memory-mcp >/dev/null 2>&1; then
  echo "  Already installed: $(which codebase-memory-mcp)"
else
  if curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash; then
    echo "  Installed successfully."
  else
    echo "  Warning: Failed to install codebase-memory-mcp. atlas-agent will work without it but code intelligence tools will be unavailable."
  fi
fi
echo ""

# --- Step 2: Install atlas-agent ---
echo "[2/3] Installing atlas-agent..."

if [ "$MODE" = "docker" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: Docker not found. Use --native or install Docker."
    exit 1
  fi

  IMAGE_NAME="atlas-agent:latest"
  if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "  Building Docker image..."
    docker build -t "$IMAGE_NAME" "$PROJECT_DIR"
  else
    echo "  Docker image already exists."
  fi

  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/atlas-agent" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
docker run --rm -it \
  -v "$(pwd)":/workspace \
  -e ATLAS_BASE_URL \
  -e ATLAS_AUTH_TOKEN \
  -e ATLAS_API_KEY \
  -e ATLAS_MODEL \
  -e ATLAS_SUBAGENT_MODEL \
  -e ATLAS_SYSTEM_PROMPT \
  atlas-agent:latest "$@"
WRAPPER
  chmod +x "$BIN_DIR/atlas-agent"
  echo "  Created Docker wrapper: $BIN_DIR/atlas-agent"

elif [ "$MODE" = "native" ]; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Error: Node.js >= 20 required (found v$NODE_VERSION). Upgrade Node.js or use --docker."
    exit 1
  fi

  echo "  Installing dependencies..."
  cd "$PROJECT_DIR"
  npm ci --silent
  echo "  Building..."
  npm run build --silent
  echo "  Linking globally..."
  npm link --silent 2>/dev/null || {
    # npm link may fail without sudo; create manual symlink instead
    mkdir -p "$BIN_DIR"
    ln -sf "$PROJECT_DIR/bin/atlas-agent.js" "$BIN_DIR/atlas-agent"
    echo "  Created symlink: $BIN_DIR/atlas-agent -> $PROJECT_DIR/bin/atlas-agent.js"
  }
fi
echo ""

# --- Step 3: Verify ---
echo "[3/3] Verifying installation..."
if command -v atlas-agent >/dev/null 2>&1; then
  echo "  atlas-agent: $(which atlas-agent)"
else
  echo "  atlas-agent installed at: $BIN_DIR/atlas-agent"
  echo "  Make sure $BIN_DIR is in your PATH:"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

if command -v codebase-memory-mcp >/dev/null 2>&1; then
  echo "  codebase-memory-mcp: $(which codebase-memory-mcp)"
else
  echo "  codebase-memory-mcp: not in PATH (optional, code intelligence disabled)"
fi
echo ""

# --- Done ---
echo "=== Installation complete ==="
echo ""
echo "Setup your environment:"
echo "  export ATLAS_AUTH_TOKEN=\"your-api-token\""
echo "  export ATLAS_BASE_URL=\"https://your-proxy-endpoint\""
echo ""
echo "Then run:"
echo "  atlas-agent"
echo ""
