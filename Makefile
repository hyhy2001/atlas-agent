.PHONY: install build dev test clean clean-all help symlink ensure-node install-node deps install-mcp build-mcp _write-settings

# Detect OS and arch
OS     := $(shell uname -s 2>/dev/null || echo Windows)
ARCH   := $(shell uname -m 2>/dev/null || echo x86_64)

ifeq ($(OS),Linux)
  PLATFORM := linux
  NODE_DIST := node-v22.15.0-linux-x64
  NODE_URL  := https://nodejs.org/dist/v22.15.0/$(NODE_DIST).tar.gz
else ifeq ($(OS),Darwin)
  PLATFORM := darwin
  ifeq ($(ARCH),arm64)
    NODE_DIST := node-v22.15.0-darwin-arm64
  else
    NODE_DIST := node-v22.15.0-darwin-x64
  endif
  NODE_URL := https://nodejs.org/dist/v22.15.0/$(NODE_DIST).tar.gz
else
  PLATFORM := windows
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

# Self-contained install — everything lives under $(CURDIR), no system deps.
DEPS_DIR := $(CURDIR)/deps
NODE_DIR := $(DEPS_DIR)/node
NODE_BIN := $(NODE_DIR)/bin/node
NPM_BIN  := $(NODE_DIR)/bin/npm

# Always use the locally-installed Node and npm. No fallback to system —
# this keeps the install fully reproducible and isolated from whatever
# the user has in their environment.
NODE := $(NODE_BIN)
NPM  := $(NPM_BIN)

# Symlink target — the only thing that lives outside the project dir.
LOCAL_BIN := $(HOME)/.local/bin
SYMLINK   := $(LOCAL_BIN)/atlas-agent

# Prepend $(NODE_DIR)/bin to PATH so subprocesses (npm shebangs etc.) find
# the local Node, but absolute paths in $(NODE)/$(NPM) remain authoritative.
export PATH := $(NODE_DIR)/bin:$(PATH)

# Default target
all: install

## install: Self-contained install — Node + deps + build + MCP + symlink
install: ensure-node deps build install-mcp symlink
	@echo ""
	@echo "✓ atlas-agent installed (fully self-contained)"
	@echo ""
	@echo "Make sure $(LOCAL_BIN) is in your PATH:"
	@echo "  export PATH=\"\$$HOME/.local/bin:\$$PATH\""
	@echo ""
	@echo "Configure:"
	@echo "  export ATLAS_AUTH_TOKEN=\"your-token\""
	@echo "  export ATLAS_BASE_URL=\"http://your-proxy:port/v1\""
	@echo ""
	@echo "Run: atlas-agent"

## ensure-node: Install Node.js into ./deps/node/ if missing
ensure-node:
	@if [ -x "$(NODE_BIN)" ]; then \
	  echo "  ✓ Node.js $$( $(NODE_BIN) -v) (./deps/node)"; \
	else \
	  $(MAKE) install-node; \
	fi

## install-node: Download portable Node.js into ./deps/node/
install-node:
	@echo "Installing Node.js v22 into $(NODE_DIR)..."
	@mkdir -p $(DEPS_DIR)
	@curl -fsSL "$(NODE_URL)" -o $(DEPS_DIR)/node-download.tar.gz
	@mkdir -p $(NODE_DIR)
	@tar -xzf $(DEPS_DIR)/node-download.tar.gz -C $(NODE_DIR) --strip-components=1
	@rm -f $(DEPS_DIR)/node-download.tar.gz
	@echo "  ✓ Node.js $$( $(NODE_BIN) -v) installed at $(NODE_DIR)"

## deps: Install npm dependencies via local npm
deps:
	@echo "Installing npm dependencies..."
	@NODE_ENV=development $(NPM) install --include=dev --legacy-peer-deps
	@if [ ! -f "$(CURDIR)/node_modules/typescript/bin/tsc" ]; then \
	  echo "  ✗ npm install completed but typescript missing."; \
	  echo "    Try: $(NPM) install --include=dev --legacy-peer-deps"; \
	  exit 1; \
	fi
	@echo "  ✓ Installed"

## build: Compile TypeScript via local tsc
build:
	@echo "Building TypeScript..."
	@$(NODE) $(CURDIR)/node_modules/typescript/bin/tsc -p tsconfig.json
	@echo "  ✓ Built dist/"

## symlink: Create wrapper script in ~/.local/bin pointing to local node + dist/cli.js
symlink:
	@echo "Linking to $(SYMLINK)..."
	@mkdir -p $(LOCAL_BIN)
	@printf '#!/bin/sh\nexec "$(NODE)" "$(CURDIR)/dist/cli.js" "$$@"\n' > $(SYMLINK)
	@chmod +x $(SYMLINK)
	@echo "  ✓ $(SYMLINK)"
	@echo "    → $(NODE) $(CURDIR)/dist/cli.js"

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
	@$(MAKE) --no-print-directory _write-settings

## _write-settings: Write .atlas/settings.json with absolute MCP path
_write-settings:
	@mkdir -p .atlas
	@MCP_BIN="$(CURDIR)/.atlas/bin/codebase-memory-mcp"; \
	if [ ! -f .atlas/settings.json ]; then \
	  echo "  Writing .atlas/settings.json with absolute MCP path..."; \
	  printf '{\n  "model": "all",\n  "mcpServers": [\n    {\n      "name": "codebase-memory",\n      "command": "%s",\n      "args": [],\n      "autoApprove": true\n    }\n  ]\n}\n' "$$MCP_BIN" > .atlas/settings.json; \
	  echo "  ✓ .atlas/settings.json created"; \
	else \
	  echo "  ✓ .atlas/settings.json already exists (not overwritten)"; \
	fi

## build-mcp: Build codebase-memory-mcp from source (when release binary is glibc-incompatible)
build-mcp:
	@echo "Building codebase-memory-mcp from source..."
	@command -v gcc >/dev/null 2>&1 || { echo "  ✗ gcc not found (system requirement for build-mcp)"; exit 1; }
	@command -v git >/dev/null 2>&1 || { echo "  ✗ git not found (system requirement for build-mcp)"; exit 1; }
	@echo '#include <zlib.h>' | gcc -E -x c - >/dev/null 2>&1 || { \
	  echo "  ✗ zlib headers not found by gcc."; \
	  echo "    Install: zlib1g-dev (Debian/Ubuntu) or zlib-devel (Fedora/RHEL)"; \
	  exit 1; \
	}
	@mkdir -p $(DEPS_DIR)
	@rm -rf $(DEPS_DIR)/cbm-source
	@echo "  Cloning source..."
	@git clone --depth=1 https://github.com/DeusData/codebase-memory-mcp.git $(DEPS_DIR)/cbm-source 2>&1 | tail -3
	@echo "  Patching linker flags (+ -ldl for older glibc)..."
	@sed -i 's/^LDFLAGS = -lm -lstdc++ -lpthread -lz/LDFLAGS = -lm -lstdc++ -lpthread -lz -ldl/' $(DEPS_DIR)/cbm-source/Makefile.cbm
	@echo "  Building (~3-5 minutes — compiling 155 tree-sitter grammars)..."
	@cd $(DEPS_DIR)/cbm-source && bash scripts/build.sh 2>&1 | tail -5
	@if [ ! -f "$(DEPS_DIR)/cbm-source/build/c/codebase-memory-mcp" ]; then \
	  echo "  ✗ Build failed — check $(DEPS_DIR)/cbm-source/build.log"; \
	  exit 1; \
	fi
	@mkdir -p .atlas/bin
	@cp "$(DEPS_DIR)/cbm-source/build/c/codebase-memory-mcp" .atlas/bin/codebase-memory-mcp
	@chmod +x .atlas/bin/codebase-memory-mcp
	@echo "  ✓ Built and installed to .atlas/bin/codebase-memory-mcp"

## dev: Run in development mode (uses local node + tsx)
dev: ensure-node deps
	@$(NPM) run dev

## test: Run test suite (uses local node)
test: ensure-node
	@$(NPM) test

## clean: Remove build artifacts (keep deps/)
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist/ node_modules/
	@echo "  ✓ Cleaned (deps/ preserved)"

## clean-all: Remove everything including deps/
clean-all:
	@echo "Cleaning everything..."
	@rm -rf dist/ node_modules/ deps/
	@echo "  ✓ Cleaned"

## help: Show available targets
help:
	@echo "atlas-agent Makefile (self-contained install)"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^## ' Makefile | sed 's/## /  /'
	@echo ""
	@echo "Local deps installed to: $(DEPS_DIR)"
	@echo "Symlink created at:      $(SYMLINK)"
