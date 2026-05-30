import type { OpenAIProvider } from "../provider/openai.js";
import type { Message } from "../provider/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ExecutionContext } from "../tools/types.js";
import { runAgentLoop } from "./loop.js";
import { PermissionSession } from "../permissions/session.js";

export type AgentProfile = "atlas-swift" | "atlas-forge" | "atlas-deep";

export const ATLAS_MECH_PROMPT = `You are atlas-swift, a mechanical code executor. You ONLY apply exact edits provided to you.

Rules:
- Apply the exact old_string → new_string replacements specified
- Run build/test commands if specified
- Report immediately if old_string doesn't match or build fails
- Do NOT discover code, do NOT expand scope, do NOT reason about alternatives
- If anything is unclear or fails, report and STOP — do not retry`;

export const ATLAS_CODER_PROMPT = `You are atlas-forge, a code implementation agent. You implement features, fix bugs, refactor code, and write tests.

Rules:
- Follow the plan provided by the leader exactly
- For code discovery, PREFER MCP tools when available:
  - codebase-memory__search_graph: find functions/classes/routes by name or query
  - codebase-memory__get_code_snippet: read source of a specific symbol
  - codebase-memory__trace_path: find callers/callees, data flow
  - codebase-memory__search_code: text search with graph ranking
  - Fall back to read_file, grep, glob only when MCP tools are unavailable
- Use edit_file and write_file to make changes
- Run build and test commands with bash after changes
- Report: files changed, diff summary, build/test results, blockers
- Do NOT decide architecture or expand scope beyond the plan
- Do NOT skip build/test verification`;

export const ATLAS_RESCUE_PROMPT = `You are atlas-deep, a deep investigation agent. You are called when atlas-forge has failed twice on the same task.

Rules:
- Start fresh — do NOT repeat the same approach that failed
- Investigate root cause thoroughly before attempting a fix
- PREFER MCP tools for deep investigation:
  - codebase-memory__search_graph: find symbols, understand structure
  - codebase-memory__trace_path: trace call chains and data flow
  - codebase-memory__query_graph: complex multi-hop Cypher queries
  - codebase-memory__get_architecture: understand project structure
  - Fall back to read_file, grep, glob when MCP unavailable
- Consider alternative approaches the previous attempts missed
- Report your findings and proposed approach before making changes
- Be thorough but surgical — fix the actual problem, not symptoms`;

export interface RunSubagentOptions {
  profile: AgentProfile;
  task: string;
  files?: string[];
  buildCommand?: string;
  testCommand?: string;
  abortSignal?: AbortSignal;
  onToolCall?: (name: string, summary: string) => void;
}

export interface RunSubagentResult {
  output: string;
  toolUseCount: number;
  durationMs: number;
  tokens: number;
  error?: string;
}

function selectProfile(profile: AgentProfile, provider: OpenAIProvider, fastModel?: string, reasoningModel?: string): { systemPrompt: string; subProvider: OpenAIProvider } {
  switch (profile) {
    case "atlas-swift":
      return {
        systemPrompt: ATLAS_MECH_PROMPT,
        subProvider: fastModel ? provider.withModel(fastModel) : provider,
      };
    case "atlas-forge":
      return {
        systemPrompt: ATLAS_CODER_PROMPT,
        subProvider: fastModel ? provider.withModel(fastModel) : provider,
      };
    case "atlas-deep":
      return {
        systemPrompt: ATLAS_RESCUE_PROMPT,
        subProvider: reasoningModel ? provider.withModel(reasoningModel) : provider,
      };
  }
}

function buildTaskPrompt(opts: RunSubagentOptions): string {
  let full = opts.task;
  if (opts.files?.length) full += `\n\nRelevant files: ${opts.files.join(", ")}`;
  if (opts.buildCommand) full += `\n\nAfter changes, run build: ${opts.buildCommand}`;
  if (opts.testCommand) full += `\n\nAfter changes, run tests: ${opts.testCommand}`;
  return full;
}

function buildSubRegistry(profile: AgentProfile, registry: ToolRegistry): ToolRegistry {
  if (profile !== "atlas-swift") return registry;
  const sub = new ToolRegistry();
  const allowed = ["read_file", "write_file", "edit_file", "bash"];
  for (const tool of registry.getAll()) {
    if (allowed.includes(tool.name)) sub.register(tool);
  }
  return sub;
}

export async function runSubagent(opts: RunSubagentOptions, ctx: ExecutionContext): Promise<RunSubagentResult> {
  const provider = ctx.provider;
  const registry = ctx.registry;
  const hooks = ctx.hooks;

  if (!provider || !registry) {
    return { output: "Error: subagent runner not available (provider/registry not set)", toolUseCount: 0, durationMs: 0, tokens: 0, error: "missing_runtime" };
  }

  const fastModel = ctx.fastModel || process.env["ATLAS_FAST_MODEL"];
  const reasoningModel = ctx.reasoningModel || process.env["ATLAS_REASONING_MODEL"];
  const { systemPrompt, subProvider } = selectProfile(opts.profile, provider, fastModel, reasoningModel);

  const messages: Message[] = [{ role: "user", content: buildTaskPrompt(opts) }];
  const subRegistry = buildSubRegistry(opts.profile, registry);

  const subPermissions = new PermissionSession();
  subPermissions.grant("bash");
  subPermissions.grant("write_file");
  subPermissions.grant("edit_file");

  const abortSignal = opts.abortSignal ?? ctx.abortSignal;
  const subCtx: ExecutionContext = {
    workingDir: ctx.workingDir,
    abortSignal,
    permissions: subPermissions,
  };

  const subExecutor = new ToolExecutor(subRegistry, subCtx, hooks);

  let toolUseCount = 0;
  if (opts.onToolCall) {
    (subExecutor as unknown as { _onToolCall?: (n: string, s: string) => void })._onToolCall = (name, summary) => {
      toolUseCount++;
      opts.onToolCall!(name, summary);
    };
  }

  const startTime = Date.now();
  let subTokens = 0;

  try {
    await runAgentLoop({
      provider: subProvider,
      messages,
      toolRegistry: subRegistry,
      executor: subExecutor,
      systemPrompt,
      abortSignal,
      onText: () => {},
      onTokens: (delta: number) => { subTokens += delta; },
    });
  } catch (err) {
    return {
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      toolUseCount,
      durationMs: Date.now() - startTime,
      tokens: subTokens,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const lastAssistant = messages.filter(m => m.role === "assistant").pop();
  const raw = (lastAssistant && lastAssistant.content) ? lastAssistant.content : "(no response)";
  const result = typeof raw === "string" ? raw : String(raw);
  const output = result.length > 2000 ? result.slice(0, 2000) + `\n… (${result.length - 2000} more chars)` : result;

  return {
    output,
    toolUseCount,
    durationMs: Date.now() - startTime,
    tokens: subTokens,
  };
}
