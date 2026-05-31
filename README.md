# Atlas

Agentic coding CLI with a leader/executor architecture and a rich Ink-based TUI. Connects to any OpenAI-compatible API proxy (9router, Databricks, Azure OpenAI, Together, Groq) and pre-wires `codebase-memory-mcp` for graph-based code intelligence.

## What it does

- **Leader/executor split** — a capable model orchestrates while cheaper/faster models execute. Leader plans + verifies, executors read/edit/run.
- **Token-efficient prompts** — leader at ~850 tokens, executors 350-650 tokens, simple mode at 25 tokens. Block-based with cache-aware static/dynamic boundary.
- **Rich Ink TUI** — slash command registry (33 built-ins), local-jsx pickers, transcript pager (Ctrl+O), permission UI with priority queue, vim mode, semantic theme tokens (4 themes).
- **Code intelligence** — `codebase-memory-mcp` knowledge graph indexes the repo via tree-sitter (155 languages) into SQLite. Use `search_graph`, `trace_path`, `get_code_snippet` instead of grep + cat.
- **Self-contained install** — portable Node.js v22 in `./deps/`, MCP binary in `.atlas/bin/`, graph cache in `.atlas/cache/`. Wrapper script with absolute paths. Zero system dependencies at runtime.
- **Cross-platform** — Linux x64/arm64, macOS x64/arm64, Windows x64.

## Install

```bash
git clone https://github.com/hyhy2001/atlas-agent.git
cd atlas-agent
make install
```

`make install` will:

1. Download portable Node.js v22 into `./deps/node/` if needed
2. Install npm dependencies via local npm
3. Compile TypeScript to `dist/`
4. Download `codebase-memory-mcp` binary into `.atlas/bin/`
5. Write `.atlas/settings.json` with absolute paths
6. Create wrapper script at `~/.local/bin/atlas-agent` (hardcodes absolute paths, no PATH setup needed)

Add `~/.local/bin` to your shell PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Configuration

### First run

Atlas prompts for credentials interactively:

```
╔══════════════════════════════════════╗
║        Welcome to atlas-agent        ║
╚══════════════════════════════════════╝

Base URL: http://your-proxy:port/v1
API Key: sk-...
```

Credentials are saved to `.atlas/settings.json`.

### Environment variables

```bash
export ATLAS_AUTH_TOKEN="your-token"
export ATLAS_BASE_URL="http://your-proxy:port/v1"
```

### Models

Three tiers, configured independently:

```bash
export ATLAS_MODEL="<model-name>"            # Leader (orchestration)
export ATLAS_FAST_MODEL="<model-name>"       # atlas-swift, atlas-forge
export ATLAS_REASONING_MODEL="<model-name>"  # atlas-deep
```

If a tier is unset, the main model is used as fallback.

## Usage

```bash
atlas-agent                          # Interactive TUI (default in TTY)
atlas-agent -p "review src/main.py"  # Headless one-shot (auto simple mode)
atlas-agent --continue               # Resume most recent session
atlas-agent --plan                   # Start in plan mode (read-only)
atlas-agent --resume <session-id>    # Resume a specific session
atlas-agent --json                   # JSON output for scripting
```

## TUI

Ink/React terminal UI with semantic theme tokens, dialog priority queue, virtualized message list, transcript pager.

### Keybindings

| Key | Action |
|-----|--------|
| `Enter` | Submit |
| `Shift+Tab` | Cycle permission mode (ask / auto-approve / plan) |
| `Ctrl+O` | Open transcript pager |
| `Ctrl+Z` | Undo input buffer (50-entry stack) |
| `Ctrl+S` | Stash / unstash prompt |
| `Ctrl+X Ctrl+E` | Open input in `$EDITOR` |
| `Ctrl+R` | History search |
| `Ctrl+C` | Cancel running task / exit on empty input |
| `Tab` | Accept slash command suggestion |
| `↑ / ↓` | Navigate history or suggestions |

### Transcript pager

`Ctrl+O` opens the pager (`q/Esc` exits). Inside:

| Key | Action |
|-----|--------|
| `/` | Open search |
| `n / N` | Next / previous match |
| `[` | Dump full transcript (disable cap) |

### Vim mode

Enable: `/vim`. Esc enters NORMAL mode. Supports `h/j/k/l`, `w/b/e`, `0/^/$`, `gg/G`, `i/I/a/A/o`, `d` operator, `x`, `p/P`, count prefix, `f/F/t/T` find, `r` replace, `u` undo. INSERT mode indicator in footer.

## Slash commands

33 built-in commands registered through `src/tui/commands/builtin/`. Three kinds:

- **prompt** — expands to a model-facing message (custom commands, skills)
- **local** — runs synchronously, returns text or action
- **local-jsx** — renders an interactive Ink panel (theme picker, output picker)

### Built-ins

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/version` | Atlas version |
| `/clear` | Clear conversation (aliases: `reset`, `new`) |
| `/save` | Save current session |
| `/sessions` | List saved sessions |
| `/load <id>` | Load a saved session |
| `/resume` | Picker to resume a saved session |
| `/agent <name> [prompt]` | Invoke a subagent |
| `/agents` | List subagents |
| `/plan` | Enter plan mode (read-only) |
| `/execute` | Exit plan mode (alias: `do`) |
| `/cost` | Token usage + estimated cost |
| `/context` | Context window breakdown |
| `/config` | Full session config |
| `/stats [all\|<id>]` | Session telemetry |
| `/mcp` | MCP server status + tools |
| `/skills` | Loaded skills |
| `/compact` | Summarize history to free context |
| `/model [tier] [name]` | Show or set model |
| `/theme` | Interactive theme picker |
| `/output [default\|compact\|verbose]` | Output verbosity |
| `/diff [path]` | Git diff |
| `/undo` | Revert last file change |
| `/trust [dir]` | Trust a directory |
| `/doctor` | Health checks |
| `/bg [list\|<cmd>\|kill <id>\|log <id>]` | Background bash jobs |
| `/init` | Generate ATLAS.md |
| `/tasks` | Task store |
| `/cron` | Scheduled tasks |
| `/team` | Team coordination |
| `/worktree [list\|create\|enter\|exit\|remove]` | Git worktrees |
| `/vim` | Toggle vim editor mode |
| `/exit` | Exit (alias: `quit`) |

Suggestions support fuzzy match with description display + argument hints.

### Multi-line input

```
\`\`\`
multi-line block here
\`\`\`
```

Or end a line with `\` to continue.

### File mentions

`@src/cli.ts` injects file content. Tab to complete from project files.

## Code intelligence (codebase-memory-mcp)

Pre-wired MCP server. Builds a SQLite knowledge graph: 12 node labels (Function, Class, Method, Route, ...) + 14 edge types (CALLS, IMPORTS, HTTP_CALLS, FILE_CHANGES_WITH, ...).

Cache lives at `<install>/.atlas/cache/<project-slug>.db` — shared across all projects, keyed by absolute path.

### When to use which tool

| Question | Tool |
|----------|------|
| First contact | `get_architecture` then `get_graph_schema` |
| Find a symbol by name | `search_graph(query=..., label=Function)` |
| Find by meaning | `search_graph(semantic_query=["send","publish"])` |
| Read function source | `get_code_snippet(qualified_name=...)` |
| Who calls X? | `trace_path(function_name=X, direction=inbound)` |
| What does X call? | `trace_path(function_name=X, direction=outbound)` |
| Cross-service trace | `trace_path(mode=cross_service)` |
| Custom multi-hop | `query_graph(query=<Cypher>)` |
| Impact of changes | `detect_changes(since=HEAD~5)` |

Full skill at `.atlas/skills/codebase-memory.md`.

## Project context

Atlas auto-loads `ATLAS.md` (or `.atlas/ATLAS.md` / `.atlas/AGENT.md`) into the system prompt at startup. Generate one for your project:

```
> /init
```

## Custom subagents

Create `.atlas/agents/<name>.md`:

```markdown
---
name: rtl-reviewer
description: Reviews Verilog/SystemVerilog for synthesis issues
model: <optional-override>
allowed_tools: read_file, grep, glob
restricted_tools: write_file, edit_file, bash
---

You are an RTL reviewer. Analyze code for missing reset signals,
combinational loops, inferred latches, and synthesis warnings.
```

Invoke: `/agent rtl-reviewer`

## Custom slash commands

Create `.atlas/commands/<name>.md`:

```markdown
---
name: review-rtl
description: Review RTL code for synthesis issues
---

Review Verilog files in $ARGUMENTS for synthesis issues.
```

Use `$ARGUMENTS` to inject the user-typed args. Invoke: `/review-rtl src/top.sv`

## Skills

Skills are markdown files in `.atlas/skills/` matching user intent. Built-in: `codebase-memory.md` for graph intelligence.

```markdown
---
name: my-skill
description: One-line trigger description
---

Skill body — instructions, examples, anti-patterns.
```

Skills surface in `/<skill-name>` and as system prompt context.

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
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "echo done" }] }
    ]
  }
}
```

Events: `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`.

`allowedTools` auto-approves the listed destructive tools without prompting.

## Architecture

```
<install>/
├── deps/node/         portable Node.js v22 (always used, never system)
├── dist/              compiled TypeScript
├── node_modules/      npm deps
├── src/
│   ├── cli.ts         entry point
│   ├── tui/           Ink/React TUI (App, commands, hooks, vim)
│   ├── agent/         loop, plan mode, compaction, subagents, prompts
│   ├── tools/         built-in tools + executor + registry
│   ├── provider/      OpenAI-compatible client
│   ├── mcp/           MCP client (spawns codebase-memory-mcp)
│   └── permissions/   session-level permission rules
├── .atlas/            install-level state
│   ├── settings.json  config + MCP servers (absolute paths)
│   ├── bin/           MCP binaries
│   ├── cache/         codebase-memory-mcp .db files
│   ├── commands/      custom slash commands
│   ├── agents/        custom subagent profiles
│   └── skills/        skill definitions
└── ~/.local/bin/atlas-agent  wrapper script (hardcodes absolute paths)
```

Per-project state lives at `<cwd>/.atlas/`:

```
<cwd>/.atlas/
├── sessions/    saved conversations
├── telemetry/   per-session usage stats
└── memory/      auto-memory entries
```

## Build / Dev

```bash
make build       # tsc only
make dev         # tsx watch
make test        # vitest (210 tests)
make clean       # drop dist/ + node_modules/ (keep deps/)
make clean-all   # drop everything including deps/
make build-mcp   # rebuild codebase-memory-mcp from source (when glibc mismatch)
```

## License

MIT
