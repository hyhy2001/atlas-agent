# Atlas — Project Instructions

## Project Overview

Atlas is an agentic coding CLI with a strict leader/executor architecture. The leader (main model) plans, delegates, and verifies — it never reads or edits code directly. All code work is delegated to executor subagents that run on cheaper/faster models.

The CLI connects to any OpenAI-compatible API proxy (9router, Databricks, Azure OpenAI, Together, Groq) and pre-wires `codebase-memory-mcp` for graph-based code intelligence.

## Architecture

| Component | Role |
|-----------|------|
| Leader | Plans, delegates, verifies. 8 orchestration tools only. |
| `atlas-swift` | Mechanical edits (exact old → new replacements). Fast model. |
| `atlas-forge` | Default executor for features, refactors, tests. Fast model. |
| `atlas-deep` | Deep investigation when other tiers fail. Reasoning model. |

The leader uses `delegate` (single task) or `delegate_parallel` (multiple independent tasks).

## Tech Stack

- TypeScript on Node.js >= 20, ESM (`"type": "module"`)
- `openai` SDK — connects to any OpenAI-compatible proxy
- `@modelcontextprotocol/sdk` — stdio client for MCP servers
- `zod` — config and tool schema validation
- `vitest` — test framework
- `bun` — single-binary compilation
- `marked` + `marked-terminal` + `cli-highlight` — markdown rendering
- `ora` — spinner during tool execution
- `chalk` — terminal colors
- `diff` — unified diffs in permission prompts

## Key Directories

- `src/agent/` — agent loop, plan mode, compaction, subagents, system prompt
- `src/provider/` — OpenAI provider wrapper with streaming
- `src/tools/builtin/` — built-in tools (read_file, write_file, edit_file, bash, grep, glob, list_directory, web_fetch, todo, memory, git, delegate)
- `src/mcp/` — MCP client + server management
- `src/permissions/` — permission prompts, session memory, syntax highlighting
- `src/hooks.ts` — lifecycle hooks (Pre/PostToolUse, SessionStart/End, UserPromptSubmit, Stop)
- `src/sessions.ts`, `src/memory.ts`, `src/telemetry.ts` — persistence layers
- `src/headless.ts` — headless one-shot mode (`-p` flag)
- `src/login.ts` — interactive login screen
- `src/paths.ts` — centralized path resolution (portable-aware)
- `src/repl.ts` — interactive REPL loop
- `src/cli.ts` — CLI entry point

## Build & Run

```bash
make install        # First-time setup: deps + build + binary + symlink
make build          # TypeScript compile only
make build-all      # All 5 platform binaries
make dev            # Run with tsx (no build)
make test           # vitest
make clean          # Remove build artifacts
```

## Environment Variables

- `ATLAS_BASE_URL` — LLM proxy endpoint (required if not in settings.json)
- `ATLAS_AUTH_TOKEN` — API token (required if not in settings.json)
- `ATLAS_MODEL` — main / leader model
- `ATLAS_FAST_MODEL` — fast model for atlas-swift and atlas-forge
- `ATLAS_REASONING_MODEL` — reasoning model for atlas-deep
- `ATLAS_MODEL_ENDPOINTS` — JSON map of model → {baseURL, authToken} for per-model endpoints
  Example: '{"claude-opus-4.7":{"baseURL":"https://api.anthropic.com/v1","authToken":"sk-ant-..."}}'
- `ATLAS_SYSTEM_PROMPT` — override the default system prompt

If a tier-specific model is unset, the main model is used as fallback.

## Per-Model Endpoints

`settings.json` supports a `modelEndpoints` map to route specific models to different base URLs and auth tokens. When a model is switched via `withModel`, Atlas uses the matching endpoint override if present, otherwise it falls back to the default `baseURL` / `authToken`.

```json
{
  "model": "claude-opus-4.7",
  "fastModel": "gpt-5.5",
  "modelEndpoints": {
    "claude-opus-4.7": { "baseURL": "https://api.anthropic.com/v1", "authToken": "sk-ant-..." },
    "gpt-5.5": { "baseURL": "https://api.openai.com/v1", "authToken": "sk-openai-..." }
  }
}
```

The same map can be supplied via the `ATLAS_MODEL_ENDPOINTS` env var as a JSON string.

## Conventions

- All TypeScript imports use the `.js` extension (NodeNext ESM resolution)
- Named exports only — no default exports
- Tools with `isDestructive: true` require user permission unless allowlisted in `.atlas/settings.json`
- Tests in `test/*.test.js` (plain JavaScript, not TypeScript)
- Never commit secrets, API keys, or session data

## Adding a New Tool

1. Create `src/tools/builtin/<name>.ts` implementing the `ToolDefinition` interface
2. Export from `src/tools/builtin/index.ts` and add it to the `builtinTools` array
3. If the tool should be available to the leader, add its name to `filterForLeader()` in `src/tools/registry.ts`
4. Add a test under `test/`
5. Run `npm run build && npm test`

## Adding a Custom Subagent

Create a markdown file at `.atlas/agents/<name>.md`:

```markdown
---
name: rtl-reviewer
description: Reviews Verilog/SystemVerilog for synthesis issues
model: <optional-model-override>
allowed_tools: read_file, grep, glob
restricted_tools: write_file, edit_file, bash
---

You are an RTL reviewer. Analyze the code for:
- Missing reset signals
- Combinational loops
- ...
```

Invoke from the REPL: `/agent rtl-reviewer`.
