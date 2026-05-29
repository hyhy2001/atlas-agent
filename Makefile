.PHONY: install build build-all dev test clean check-deps symlink install-node install-bun install-mcp build-mcp deps binary ensure-node ensure-bun

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

# Prepend deps bin dirs to PATH so subprocesses (tsc shebang #!/usr/bin/env node etc.) find them
export PATH := $(NODE_DIR)/bin:$(BUN_DIR)/bin:$(PATH)

# Default target
all: install

## install: Full install — download deps if needed, build, binary, MCP, symlink
install: ensure-node ensure-bun deps build binary install-mcp symlink
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
	@case "$(PLATFORM)-$(ARCH_NAME)" in \
	  linux-x64)    BUN_ZIP="bun-linux-x64.zip" ;; \
	  linux-arm64)  BUN_ZIP="bun-linux-aarch64.zip" ;; \
	  darwin-x64)   BUN_ZIP="bun-darwin-x64.zip" ;; \
	  darwin-arm64) BUN_ZIP="bun-darwin-aarch64.zip" ;; \
	  windows-x64)  BUN_ZIP="bun-windows-x64.zip" ;; \
	  *) echo "  Error: no Bun binary for $(PLATFORM)-$(ARCH_NAME)"; exit 1 ;; \
	esac; \
	URL="https://github.com/oven-sh/bun/releases/latest/download/$$BUN_ZIP"; \
	echo "  Downloading: $$URL"; \
	curl -fsSL "$$URL" -o $(DEPS_DIR)/bun-download.zip
	@cd $(DEPS_DIR) && unzip -oq bun-download.zip && \
	  mv bun-*/bun $(BUN_BIN) && \
	  rmdir bun-* 2>/dev/null || true; \
	  chmod +x $(BUN_BIN)
	@rm -f $(DEPS_DIR)/bun-download.zip
	@echo "  ✓ Bun $$( $(BUN_BIN) --version) installed at $(BUN_DIR)"
	@echo "  Tip: add $(BUN_DIR)/bin to PATH to use system-wide"

## deps: Install npm dependencies (tries bun first, falls back to npm)
deps:
	@echo "Installing npm dependencies..."
	@echo "  Using: $(BUN) install"
	@if SKIP_BINARY_BUILD=1 $(BUN) install --no-summary 2>&1 && [ -f "$(CURDIR)/node_modules/typescript/bin/tsc" ]; then \
	  echo "  ✓ Installed via bun"; \
	else \
	  echo ""; \
	  echo "  bun install failed or didn't create node_modules. Falling back to npm..."; \
	  echo "  Using: $(NPM) install --include=dev --legacy-peer-deps"; \
	  rm -rf node_modules; \
	  SKIP_BINARY_BUILD=1 NODE_ENV=development $(NPM) install --include=dev --legacy-peer-deps; \
	  if [ ! -f "$(CURDIR)/node_modules/typescript/bin/tsc" ]; then \
	    echo ""; \
	    echo "  ✗ Both bun and npm failed to install typescript."; \
	    echo "    Run manually:  $(NPM) install --include=dev"; \
	    echo "    Then check:    ls node_modules/typescript/bin/"; \
	    exit 1; \
	  fi; \
	  echo "  ✓ Installed via npm"; \
	fi

## build: Compile TypeScript
build:
	@echo "Building TypeScript..."
	@$(NODE) $(CURDIR)/node_modules/typescript/bin/tsc -p tsconfig.json

## binary: Build binary for current OS
binary:
	@echo "Building binary for $(PLATFORM)-$(ARCH_NAME)..."
	@mkdir -p release
	@node scripts/patch-ink.mjs
	@$(BUN) build --compile --minify --target=$(BUN_TARGET) ./src/cli.ts --outfile=$(BINARY_PATH)
	@chmod +x $(BINARY_PATH) 2>/dev/null || true
	@echo "  ✓ $(BINARY_PATH) ($$(du -sh $(BINARY_PATH) | cut -f1))"

## symlink: Symlink binary to ~/.local/bin
symlink:
	@echo "Linking to $(SYMLINK)..."
	@mkdir -p $(LOCAL_BIN)
	@ln -sf "$(CURDIR)/$(BINARY_PATH)" $(SYMLINK)
	@echo "  ✓ $(SYMLINK) → $(CURDIR)/$(BINARY_PATH)"

## install-mcp: Download codebase-memory-mcp into .atlas/bin/
install-mcp:
	@echo "Installing codebase-memory-mcp..."
	@mkdir -p .atlas/bin
	@if [ -f .atlas/bin/codebase-memory-mcp ] || [ -f .atlas/bin/codebase-memory-mcp.exe ]; then \
	  echo "  ✓ Already installed"; \
	else \
	  case "$(PLATFORM)-$(ARCH_NAME)" in \
	    linux-x64)     ASSET="codebase-memory-mcp-linux-amd64.tar.gz" ;; \
	    linux-arm64)   ASSET="codebase-memory-mcp-linux-arm64.tar.gz" ;; \
	    darwin-arm64)  ASSET="codebase-memory-mcp-darwin-arm64.tar.gz" ;; \
	    darwin-x64)    ASSET="codebase-memory-mcp-darwin-amd64.tar.gz" ;; \
	    windows-x64)   ASSET="codebase-memory-mcp-windows-amd64.zip" ;; \
	    *) echo "  Warning: no MCP binary for $(PLATFORM)-$(ARCH_NAME), skipping"; exit 0 ;; \
	  esac; \
	  URL="https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/$$ASSET"; \
	  echo "  Downloading: $$URL"; \
	  TMPFILE=".atlas/bin/_download.tmp"; \
	  if curl -fsSL "$$URL" -o "$$TMPFILE"; then \
	    case "$$ASSET" in \
	      *.tar.gz) tar -xzf "$$TMPFILE" -C .atlas/bin ;; \
	      *.zip)    unzip -o "$$TMPFILE" -d .atlas/bin >/dev/null ;; \
	    esac; \
	    chmod +x .atlas/bin/codebase-memory-mcp 2>/dev/null || true; \
	    rm -f "$$TMPFILE"; \
	    echo "  ✓ Installed to .atlas/bin/"; \
	  else \
	    rm -f "$$TMPFILE"; \
	    echo "  Warning: download failed. Atlas will work without code intelligence."; \
	  fi; \
	fi

## build-mcp: Build codebase-memory-mcp from source (use when release binary is glibc-incompatible)
build-mcp:
	@echo "Building codebase-memory-mcp from source..."
	@command -v gcc >/dev/null 2>&1 || { echo "  ✗ gcc not found. Install: sudo apt install build-essential zlib1g-dev"; exit 1; }
	@command -v git >/dev/null 2>&1 || { echo "  ✗ git not found"; exit 1; }
	@if [ ! -f /usr/include/zlib.h ] && [ ! -f /usr/local/include/zlib.h ]; then \
	  echo "  ✗ zlib headers not found. Install: sudo apt install zlib1g-dev"; exit 1; \
	fi
	@mkdir -p $(DEPS_DIR)
	@rm -rf $(DEPS_DIR)/cbm-source
	@echo "  Cloning source..."
	@git clone --depth=1 https://github.com/DeusData/codebase-memory-mcp.git $(DEPS_DIR)/cbm-source 2>&1 | tail -3
	@echo "  Building (~2-3 minutes)..."
	@cd $(DEPS_DIR)/cbm-source && bash scripts/build.sh 2>&1 | tail -5
	@if [ ! -f "$(DEPS_DIR)/cbm-source/build/c/codebase-memory-mcp" ]; then \
	  echo "  ✗ Build failed — binary not produced"; exit 1; \
	fi
	@mkdir -p .atlas/bin
	@cp "$(DEPS_DIR)/cbm-source/build/c/codebase-memory-mcp" .atlas/bin/codebase-memory-mcp
	@chmod +x .atlas/bin/codebase-memory-mcp
	@echo "  ✓ Built and installed to .atlas/bin/codebase-memory-mcp"
	@echo "  ✓ Compiled with system glibc — no version mismatch"

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
