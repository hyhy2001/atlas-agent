.PHONY: install build build-all dev test clean check-deps symlink install-node install-bun

# Detect OS and arch
OS     := $(shell uname -s 2>/dev/null || echo Windows)
ARCH   := $(shell uname -m 2>/dev/null || echo x86_64)

ifeq ($(OS),Linux)
  PLATFORM := linux
  BIN_EXT  :=
  NODE_DIST := node-v22.15.0-linux-x64
  NODE_URL  := https://nodejs.org/dist/v22.15.0/$(NODE_DIST).tar.gz
else ifeq ($(OS),Darwin)
  PLATFORM := darwin
  BIN_EXT  :=
  ifeq ($(ARCH),arm64)
    NODE_DIST := node-v22.15.0-darwin-arm64
  else
    NODE_DIST := node-v22.15.0-darwin-x64
  endif
  NODE_URL := https://nodejs.org/dist/v22.15.0/$(NODE_DIST).tar.gz
else
  PLATFORM := windows
  BIN_EXT  := .exe
  NODE_DIST := node-v22.15.0-win-x64
  NODE_URL  := https://nodejs.org/dist/v22.15.0/$(NODE_DIST).zip
endif

ifeq ($(ARCH),arm64)
  ARCH_NAME := arm64
else ifeq ($(ARCH),aarch64)
  ARCH_NAME := arm64
else
  ARCH_NAME := x64
endif

# Local deps directory (no root needed)
DEPS_DIR    := $(CURDIR)/deps
NODE_DIR    := $(DEPS_DIR)/node
BUN_DIR     := $(DEPS_DIR)/bun
NODE_BIN    := $(NODE_DIR)/bin/node
NPM_BIN     := $(NODE_DIR)/bin/npm
BUN_BIN     := $(BUN_DIR)/bin/bun

# Binary output
BUN_TARGET  := bun-$(PLATFORM)-$(ARCH_NAME)
BINARY_NAME := atlas-agent-$(PLATFORM)-$(ARCH_NAME)$(BIN_EXT)
BINARY_PATH := release/$(BINARY_NAME)

# Symlink target
LOCAL_BIN := $(HOME)/.local/bin
SYMLINK   := $(LOCAL_BIN)/atlas-agent

# Use local node/bun if system ones not available
NODE := $(shell command -v node 2>/dev/null || echo $(NODE_BIN))
NPM  := $(shell command -v npm  2>/dev/null || echo $(NPM_BIN))
BUN  := $(shell command -v bun  2>/dev/null || echo $(BUN_BIN))

# Default target
all: install

## install: Full install — download deps if needed, build, binary, symlink
install: ensure-node ensure-bun deps build binary symlink
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
	@echo "Or run directly: ./$(BINARY_PATH)"

## ensure-node: Install Node.js locally if not found
ensure-node:
	@if command -v node >/dev/null 2>&1 && node -e "if(parseInt(process.versions.node)<20)process.exit(1)" 2>/dev/null; then \
	  echo "  ✓ Node.js $$(node -v) (system)"; \
	elif [ -x "$(NODE_BIN)" ]; then \
	  echo "  ✓ Node.js $$( $(NODE_BIN) -v) (local)"; \
	else \
	  $(MAKE) install-node; \
	fi

## ensure-bun: Install Bun locally if not found
ensure-bun:
	@if command -v bun >/dev/null 2>&1; then \
	  echo "  ✓ Bun $$(bun --version) (system)"; \
	elif [ -x "$(BUN_BIN)" ]; then \
	  echo "  ✓ Bun $$( $(BUN_BIN) --version) (local)"; \
	else \
	  $(MAKE) install-bun; \
	fi

## install-node: Download and install Node.js into ./deps/node/
install-node:
	@echo "Installing Node.js v22 into $(NODE_DIR)..."
	@mkdir -p $(DEPS_DIR)
	@curl -fsSL "$(NODE_URL)" -o $(DEPS_DIR)/node-download.tar.gz
	@mkdir -p $(NODE_DIR)
	@tar -xzf $(DEPS_DIR)/node-download.tar.gz -C $(NODE_DIR) --strip-components=1
	@rm -f $(DEPS_DIR)/node-download.tar.gz
	@echo "  ✓ Node.js $$( $(NODE_BIN) -v) installed at $(NODE_DIR)"
	@echo "  Tip: add $(NODE_DIR)/bin to PATH to use system-wide"

## install-bun: Download and install Bun into ./deps/bun/
install-bun:
	@echo "Installing Bun into $(BUN_DIR)..."
	@mkdir -p $(BUN_DIR)/bin
	@BUN_INSTALL="$(BUN_DIR)" curl -fsSL https://bun.sh/install | bash
	@echo "  ✓ Bun $$( $(BUN_BIN) --version) installed at $(BUN_DIR)"
	@echo "  Tip: add $(BUN_DIR)/bin to PATH to use system-wide"

## deps: Install npm dependencies
deps:
	@echo "Installing npm dependencies..."
	@SKIP_BINARY_BUILD=1 $(NPM) install --silent

## build: Compile TypeScript
build:
	@echo "Building TypeScript..."
	@$(NPM) run build --silent

## binary: Build binary for current OS
binary:
	@echo "Building binary for $(PLATFORM)-$(ARCH_NAME)..."
	@mkdir -p release
	@$(BUN) build --compile --minify --target=$(BUN_TARGET) ./src/cli.ts --outfile=$(BINARY_PATH)
	@chmod +x $(BINARY_PATH) 2>/dev/null || true
	@echo "  ✓ $(BINARY_PATH) ($$(du -sh $(BINARY_PATH) | cut -f1))"

## symlink: Symlink binary to ~/.local/bin
symlink:
	@echo "Linking to $(SYMLINK)..."
	@mkdir -p $(LOCAL_BIN)
	@ln -sf "$(CURDIR)/$(BINARY_PATH)" $(SYMLINK)
	@echo "  ✓ $(SYMLINK) → $(CURDIR)/$(BINARY_PATH)"

## build-all: Build binaries for all platforms
build-all: ensure-node ensure-bun deps build
	@echo "Building all platforms..."
	@mkdir -p release
	@$(NODE) scripts/build-all.mjs

## dev: Run in development mode
dev: ensure-node deps
	@$(NPM) run dev

## test: Run test suite
test: ensure-node
	@$(NPM) test

## clean: Remove build artifacts (keep deps/)
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist/ release/ node_modules/
	@echo "  ✓ Cleaned (deps/ preserved)"

## clean-all: Remove everything including deps/
clean-all:
	@echo "Cleaning everything..."
	@rm -rf dist/ release/ node_modules/ deps/
	@echo "  ✓ Cleaned"

## help: Show available targets
help:
	@echo "atlas-agent Makefile"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^## ' Makefile | sed 's/## /  /'
	@echo ""
	@echo "Local deps installed to: $(DEPS_DIR)"
	@echo "Binary symlinked to:     $(SYMLINK)"
