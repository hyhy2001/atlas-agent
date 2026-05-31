import type { OpenAIProvider } from "../provider/openai.js";
import type { Message } from "../provider/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ExecutionContext } from "../tools/types.js";
import { runAgentLoop } from "./loop.js";
import { PermissionSession } from "../permissions/session.js";
import {
  getRoleSection,
  getToneSection,
  getActionsCareSection,
  getDoingTasksSection,
  getUsingToolsSection,
  getEnvSection,
  DYNAMIC_BOUNDARY,
} from "./prompt_sections.js";

export type AgentProfile = "atlas-swift" | "atlas-forge" | "atlas-deep";

function buildExecutorPrompt(profile: AgentProfile, model?: string): string {
  // atlas-swift is purely mechanical — keep its prompt tight (no doing-tasks /
  // comments / verification discipline; it just applies exact edits).
  if (profile === "atlas-swift") {
    return [
      getRoleSection("atlas-swift"),
      getActionsCareSection(),
      DYNAMIC_BOUNDARY,
      getEnvSection({ model }),
    ].filter(Boolean).join("\n\n");
  }
  // forge + deep get the full coding discipline.
  return [
    getRoleSection(profile),
    getDoingTasksSection(),
    getUsingToolsSection(),
    getToneSection(),
    getActionsCareSection(),
    DYNAMIC_BOUNDARY,
    getEnvSection({ model }),
  ].filter(Boolean).join("\n\n");
}

// Backward-compatible exports — prefer buildExecutorPrompt() for fresh
// per-session env injection.
export const ATLAS_MECH_PROMPT = buildExecutorPrompt("atlas-swift");
export const ATLAS_CODER_PROMPT = buildExecutorPrompt("atlas-forge");
export const ATLAS_RESCUE_PROMPT = buildExecutorPrompt("atlas-deep");

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
        systemPrompt: buildExecutorPrompt("atlas-swift", fastModel ?? provider.getModel()),
        subProvider: fastModel ? provider.withModel(fastModel) : provider,
      };
    case "atlas-forge":
      return {
        systemPrompt: buildExecutorPrompt("atlas-forge", fastModel ?? provider.getModel()),
        subProvider: fastModel ? provider.withModel(fastModel) : provider,
      };
    case "atlas-deep":
      return {
        systemPrompt: buildExecutorPrompt("atlas-deep", reasoningModel ?? provider.getModel()),
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
  // Grant every destructive tool the subagent has access to. Hardcoding a
  // subset left apply_patch, git_commit, memory_* prompting in headless flows.
  for (const tool of subRegistry.getAll()) {
    if (tool.isDestructive) subPermissions.grant(tool.name);
  }

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
