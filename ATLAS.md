# atlas-agent Project Instructions

## Project Overview
atlas-agent is an agentic coding CLI built in TypeScript. It uses an OpenAI-compatible API (9router proxy) and pre-wires codebase-memory-mcp for code intelligence.

atlas-agent uses a strict leader/executor architecture: the leader (main model) only orchestrates via delegate; all code reading/editing happens in executor subagents (atlas-swift, atlas-forge, atlas-deep).

## Tech Stack
- TypeScript + Node.js >= 20, ESM (`"type": "module"`)
- OpenAI SDK (`openai` package) — connects to any OpenAI-compatible proxy
- MCP SDK (`@modelcontextprotocol/sdk`) — stdio client for codebase-memory-mcp
- Zod v3 for config/tool schema validation
- Vitest for testing
- Bun for single-binary compilation

## Key Directories
- `src/agent/` — agent loop, plan mode, compaction, subagents, system prompt
- `src/provider/` — OpenAI provider wrapper
- `src/tools/builtin/` — built-in tools (read_file, write_file, edit_file, bash, grep, glob, web_fetch, todo_read, todo_write, list_directory)
- `src/mcp/` — MCP client (spawns codebase-memory-mcp)
- `src/permissions/` — permission prompt, session, syntax highlighting
- `src/hooks.ts` — lifecycle hooks (PreToolUse, PostToolUse, SessionStart, SessionEnd, UserPromptSubmit, Stop)
- `src/sessions.ts` — conversation persistence
- `src/headless.ts` — headless/one-shot mode (-p flag)
- `scripts/` — build-binary.sh, setup.sh

## Build & Run
```bash
npm install          # install deps
npm run build        # TypeScript compile → dist/
npm run dev          # run without building (tsx)
npm test             # run tests (vitest)
npm run build:binary # compile to single Bun binary → release/
```

## Environment Variables
- `ATLAS_BASE_URL` — LLM proxy endpoint (required)
- `ATLAS_AUTH_TOKEN` — API token (required)
- `ATLAS_MODEL` — model name (default: "all")
- `ATLAS_FAST_MODEL` — fast/cheap model for executors (atlas-swift, atlas-forge)
- `ATLAS_REASONING_MODEL` — most capable model for deep investigation (atlas-deep)
- `ATLAS_SYSTEM_PROMPT` — override system prompt

## Conventions
- All imports use `.js` extension (NodeNext ESM resolution)
- No default exports — named exports only
- Tool definitions: `isDestructive: true` requires user permission
- Tests in `test/*.test.js` (plain JS, not TS)
- Never commit secrets or API keys

## Adding a New Tool
1. Create `src/tools/builtin/<name>.ts` implementing `ToolDefinition`
2. Export from `src/tools/builtin/index.ts`
3. Add test in `test/`
4. Run `npm run build && npm test`
