# Atlas

AI Coding Assistant CLI with a leader/executor architecture, designed for internal teams using OpenAI-compatible API proxies (9router, Databricks, Azure OpenAI, etc.).

## Features

- **Leader/executor architecture**: A capable model orchestrates while cheaper/faster models execute. Saves cost and improves throughput.
- **24 built-in tools**: file I/O, shell, git, web, code intelligence (MCP), memory, todos
- **Three executor tiers**:
  - `atlas-swift` — mechanical edits (exact old → new replacements)
  - `atlas-forge` — default executor for features, refactors, tests
  - `atlas-deep` — deep investigation when other tiers fail
- **Parallel delegation**: leader can dispatch independent tasks concurrently
- **Session persistence, memory, telemetry** — all stored locally
- **Portable**: no root access, no home directory writes — everything stays in the working directory
- **Cross-platform**: Linux, macOS, Windows (x64 and arm64)
- **Single binary distribution** via Bun compile

## Installation

### Prerequisites

- Git
- Node.js >= 20 — https://nodejs.org
- Bun — https://bun.sh (`curl -fsSL https://bun.sh/install | bash`)

If either Node.js or Bun is missing, `make install` will download a portable copy into `./deps/` automatically.

### Install

```bash
git clone https://github.com/hyhy2001/atlas-agent.git
cd atlas-agent
make install
```

This will:
1. Verify or install Node.js and Bun (locally to `./deps/` if needed)
2. Install npm dependencies
3. Build TypeScript to `dist/`
4. Compile a native binary for your OS to `release/`
5. Create a symlink at `~/.local/bin/atlas-agent`

Make sure `~/.local/bin` is in your `PATH`:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Configuration

### First run

The first time you launch `atlas-agent`, you'll see a login screen:

```
╔══════════════════════════════════════╗
║           Welcome to Atlas           ║
╚══════════════════════════════════════╝

How would you like to connect?

  1. API Key + Base URL
  2. [Coming soon] OAuth
  3. [Coming soon] Enterprise SSO

Select [1]: 1
Base URL: http://your-proxy:port/v1
API Key: sk-...
Save to config/settings.json? [Y/n]: y
```

Credentials are stored in `config/settings.json`. You won't be prompted again.

### Environment variables

Alternatively, set credentials via env vars:

```bash
export ATLAS_AUTH_TOKEN="your-token"
export ATLAS_BASE_URL="http://your-proxy:port/v1"
```

### Model configuration

Atlas uses three model tiers. You can configure each independently:

```bash
export ATLAS_MODEL="<model-name>"           # Main / leader model
export ATLAS_FAST_MODEL="<model-name>"      # atlas-swift, atlas-forge
export ATLAS_REASONING_MODEL="<model-name>" # atlas-deep
```

If a tier-specific model is not set, the main model is used as fallback.

## Usage

```bash
atlas-agent                          # Interactive REPL
atlas-agent -p "review src/main.py"  # Headless one-shot
atlas-agent --continue               # Resume the most recent session
atlas-agent --plan                   # Start in plan mode (read-only)
atlas-agent --resume <session-id>    # Resume a specific session
```

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/plan` | Enter plan mode (read-only — analysis only) |
| `/execute` | Exit plan mode |
| `/agent <name>` | Invoke a specific subagent |
| `/agents` | List available subagents |
| `/model [tier] [name]` | Show or change models (main, fast, reasoning) |
| `/diff [path]` | Show git diff |
| `/undo` | Revert the last file change made by the agent |
| `/cost` | Show token usage and estimated cost |
| `/stats [all\|<id>]` | Show session telemetry |
| `/doctor` | Run diagnostics on your setup |
| `/init` | Generate `ATLAS.md` from the current project |
| `/compact` | Compress conversation history |
| `/save` | Save the current session |
| `/sessions` | List saved sessions |
| `/load <id>` | Load a saved session |
| `/clear` | Clear current history |
| `/context` | Show the loaded project context path |
| `/worktree` | Manage git worktrees (list/create/enter/exit/remove) |

Multi-line input: type ``` ``` ``` to start/end a block, or end a line with `\` to continue.
File mention: type `@src/cli.ts` to inject file content into your prompt.

## Custom Commands

Create a file at `.atlas/commands/<name>.md`:

```markdown
---
name: review-rtl
description: Review RTL code for synthesis issues
---

Review Verilog/SystemVerilog files in the project for:
- Missing reset signals
- Combinational loops
- Inferred latches
- Synthesis warnings
```

Use it with `/review-rtl src/top.sv`. The argument is appended to the prompt automatically.

## Project Context

Place an `ATLAS.md` file at the project root. Atlas loads it automatically into the system prompt at startup.

To generate one based on your project:
```bash
atlas-agent
> /init
```

## Hooks

Configure shell hooks in `.atlas/settings.json`:

```json
{
  "allowedTools": ["bash", "edit_file", "write_file"],
  "hooks": {
    "PreToolUse": [
      { "matcher": "bash", "command": "echo 'Running: $TOOL_COMMAND' >&2" }
    ],
    "PostToolUse": [
      { "matcher": "edit_file", "command": "npx prettier --write $TOOL_PATH" }
    ]
  }
}
```

Supported events: `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`.

`allowedTools` auto-approves the listed destructive tools without prompting.

## Build & Test

```bash
make build          # Compile TypeScript only
make build-all      # Build binaries for all 5 platforms
make test           # Run the test suite
make dev            # Run in dev mode (no build)
make clean          # Remove build artifacts
make clean-all      # Remove everything including deps/
```

## Directory Layout (portable mode)

```
atlas-agent/
├── atlas-agent         Native binary
├── config/
│   └── settings.json   Configuration
├── sessions/           Conversation history
├── telemetry/          Per-session usage stats
├── cache/              MCP knowledge graph database
├── bin/                Bundled MCP binaries
└── .atlas/
    ├── memory/         Persistent memory across sessions
    ├── commands/       Custom slash commands
    ├── agents/         Custom subagent profiles
    └── settings.json   Hooks and permission allowlist
```

All paths stay inside the working directory. No writes to `~/.config`, `~/.atlas`, or `/tmp`.

## License

MIT
