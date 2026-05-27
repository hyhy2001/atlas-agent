#!/usr/bin/env bash
set -euo pipefail

# Idempotent installer for atlas-agent Docker image and wrapper
# Usage: ./scripts/install.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH. Please install Docker: https://docs.docker.com/get-docker/"
  exit 1
fi

IMAGE_NAME="atlas-agent:latest"

# Build the image if not present
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Building Docker image $IMAGE_NAME..."
  docker build -t "$IMAGE_NAME" .
else
  echo "Docker image $IMAGE_NAME already exists. Skipping build."
fi

BIN_DIR="$HOME/.local/bin"
WRAPPER="$BIN_DIR/atlas-agent"

mkdir -p "$BIN_DIR"

cat > "$WRAPPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# Run atlas-agent in Docker with current working dir mounted
docker run --rm -it \
  -v "$(pwd)":/workspace \
  -e ANTHROPIC_BASE_URL \
  -e ANTHROPIC_AUTH_TOKEN \
  atlas-agent:latest "$@"
EOF

chmod +x "$WRAPPER"

echo "Created wrapper: $WRAPPER"

echo "To use atlas-agent, ensure the following env vars are set in your shell:\n  export ANTHROPIC_BASE_URL=...\n  export ANTHROPIC_AUTH_TOKEN=...\nYou can add them to your ~/.bashrc or ~/.zshrc."
