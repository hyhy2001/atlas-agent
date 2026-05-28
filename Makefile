.PHONY: install build build-all dev test clean check-deps symlink

# Detect OS and arch
OS := $(shell uname -s 2>/dev/null || echo Windows)
ARCH := $(shell uname -m 2>/dev/null || echo x86_64)

ifeq ($(OS),Linux)
  PLATFORM := linux
  BIN_EXT :=
else ifeq ($(OS),Darwin)
  PLATFORM := darwin
  BIN_EXT :=
else
  PLATFORM := windows
  BIN_EXT := .exe
endif

ifeq ($(ARCH),arm64)
  ARCH_NAME := arm64
else ifeq ($(ARCH),aarch64)
  ARCH_NAME := arm64
else
  ARCH_NAME := x64
endif

BUN_TARGET := bun-$(PLATFORM)-$(ARCH_NAME)
BINARY_NAME := atlas-agent-$(PLATFORM)-$(ARCH_NAME)$(BIN_EXT)
BINARY_PATH := release/$(BINARY_NAME)
LOCAL_BIN := $(HOME)/.local/bin
SYMLINK := $(LOCAL_BIN)/atlas-agent

# Default target
all: install

## install: Full install — deps, build, binary, symlink
install: check-deps deps build binary symlink
	@echo ""
	@echo "✓ atlas-agent installed successfully"
	@echo ""
	@echo "Make sure $(LOCAL_BIN) is in your PATH:"
	@echo "  export PATH=\"\$$HOME/.local/bin:\$$PATH\""
	@echo ""
	@echo "Configure:"
	@echo "  export ATLAS_AUTH_TOKEN=\"your-token\""
	@echo "  export ATLAS_BASE_URL=\"http://your-proxy:port/v1\""
	@echo ""
	@echo "Run: atlas-agent"

## check-deps: Verify required tools are installed
check-deps:
	@echo "Checking prerequisites..."
	@command -v node >/dev/null 2>&1 || { echo "✗ Node.js not found. Install from https://nodejs.org (>=20)"; exit 1; }
	@node -e "if(parseInt(process.versions.node)<20)process.exit(1)" || { echo "✗ Node.js >=20 required (found $$(node -v))"; exit 1; }
	@echo "  ✓ Node.js $$(node -v)"
	@command -v bun >/dev/null 2>&1 || { echo "✗ Bun not found. Install from https://bun.sh"; exit 1; }
	@echo "  ✓ Bun $$(bun --version)"
	@command -v npm >/dev/null 2>&1 || { echo "✗ npm not found"; exit 1; }
	@echo "  ✓ npm $$(npm --version)"

## deps: Install npm dependencies
deps:
	@echo "Installing dependencies..."
	@SKIP_BINARY_BUILD=1 npm install --silent

## build: Compile TypeScript
build:
	@echo "Building TypeScript..."
	@npm run build --silent

## binary: Build binary for current OS
binary:
	@echo "Building binary for $(PLATFORM)-$(ARCH_NAME)..."
	@mkdir -p release
	@bun build --compile --minify --target=$(BUN_TARGET) ./src/cli.ts --outfile=$(BINARY_PATH)
	@chmod +x $(BINARY_PATH) 2>/dev/null || true
	@echo "  ✓ $(BINARY_PATH) ($$(du -sh $(BINARY_PATH) | cut -f1))"

## symlink: Symlink binary to ~/.local/bin
symlink:
	@echo "Linking to $(SYMLINK)..."
	@mkdir -p $(LOCAL_BIN)
	@ln -sf "$$(pwd)/$(BINARY_PATH)" $(SYMLINK)
	@echo "  ✓ $(SYMLINK) → $$(pwd)/$(BINARY_PATH)"

## build-all: Build binaries for all platforms
build-all: check-deps deps build
	@echo "Building all platforms..."
	@mkdir -p release
	@node scripts/build-all.mjs

## dev: Run in development mode (no build needed)
dev: check-deps deps
	@npm run dev

## test: Run test suite
test:
	@npm test

## clean: Remove build artifacts
clean:
	@echo "Cleaning..."
	@rm -rf dist/ release/ node_modules/
	@echo "  ✓ Cleaned"

## help: Show available targets
help:
	@echo "atlas-agent Makefile"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^## ' Makefile | sed 's/## /  /'
