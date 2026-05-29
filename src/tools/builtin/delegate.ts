import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { OpenAIProvider } from "../../provider/openai.js";
import { ToolRegistry } from "../registry.js";
import { ToolExecutor } from "../executor.js";
import { runAgentLoop } from "../../agent/loop.js";
import type { Message } from "../../provider/types.js";

const ATLAS_MECH_PROMPT = `You are atlas-swift, a mechanical code executor. You ONLY apply exact edits provided to you.

Rules:
- Apply the exact old_string → new_string replacements specified
- Run build/test commands if specified
- Report immediately if old_string doesn't match or build fails
- Do NOT discover code, do NOT expand scope, do NOT reason about alternatives
- If anything is unclear or fails, report and STOP — do not retry`;

const ATLAS_CODER_PROMPT = `You are atlas-forge, a code implementation agent. You implement features, fix bugs, refactor code, and write tests.

Rules:
- Follow the plan provided by the leader exactly
- Use read_file, grep, glob, list_directory to understand code before editing
- Use edit_file and write_file to make changes
- Run build and test commands with bash after changes
- Report: files changed, diff summary, build/test results, blockers
- Do NOT decide architecture or expand scope beyond the plan
- Do NOT skip build/test verification`;

const ATLAS_RESCUE_PROMPT = `You are atlas-deep, a deep investigation agent. You are called when atlas-forge has failed twice on the same task.

Rules:
- Start fresh — do NOT repeat the same approach that failed
- Investigate root cause thoroughly before attempting a fix
- Use read_file, grep, glob extensively to understand the full picture
- Consider alternative approaches the previous attempts missed
- Report your findings and proposed approach before making changes
- Be thorough but surgical — fix the actual problem, not symptoms`;

interface DelegateInput {
  agent: "atlas-swift" | "atlas-forge" | "atlas-deep";
  task: string;
  files?: string[];
  build_command?: string;
  test_command?: string;
}

interface ParallelTask {
  agent: "atlas-swift" | "atlas-forge" | "atlas-deep";
  task: string;
  files?: string[];
  build_command?: string;
  test_command?: string;
}

async function executeSingleDelegate(task: ParallelTask, ctx: ExecutionContext): Promise<string> {
  const provider = (ctx as any)._provider as OpenAIProvider;
  const registry = (ctx as any)._registry as ToolRegistry;
  const hooks = (ctx as any)._hooks;

  if (!provider || !registry) {
    return "Error: delegation not available (provider/registry not set)";
  }

  let systemPrompt: string;
  let subProvider: OpenAIProvider;

  const fastModel = (ctx as any)._fastModel || process.env["ATLAS_FAST_MODEL"];
  const reasoningModel = (ctx as any)._reasoningModel || process.env["ATLAS_REASONING_MODEL"];

  switch (task.agent) {
    case "atlas-swift":
      systemPrompt = ATLAS_MECH_PROMPT;
      subProvider = fastModel ? provider.withModel(fastModel) : provider;
      break;
    case "atlas-forge":
      systemPrompt = ATLAS_CODER_PROMPT;
      subProvider = fastModel ? provider.withModel(fastModel) : provider;
      break;
    case "atlas-deep":
      systemPrompt = ATLAS_RESCUE_PROMPT;
      subProvider = reasoningModel ? provider.withModel(reasoningModel) : provider;
      break;
  }

  let fullTask = task.task;
  if (task.files?.length) fullTask += `\n\nRelevant files: ${task.files.join(", ")}`;
  if (task.build_command) fullTask += `\n\nAfter changes, run build: ${task.build_command}`;
  if (task.test_command) fullTask += `\n\nAfter changes, run tests: ${task.test_command}`;

  const messages: Message[] = [{ role: "user", content: fullTask }];

  let subRegistry = registry;
  if (task.agent === "atlas-swift") {
    subRegistry = new ToolRegistry();
    const allowed = ["read_file", "write_file", "edit_file", "bash"];
    for (const tool of registry.getAll()) {
      if (allowed.includes(tool.name)) subRegistry.register(tool);
    }
  }

  const { PermissionSession } = await import("../../permissions/session.js");
  const subPermissions = new PermissionSession();
  subPermissions.grant("bash");
  subPermissions.grant("write_file");
  subPermissions.grant("edit_file");

  const subCtx: ExecutionContext = {
    workingDir: ctx.workingDir,
    abortSignal: ctx.abortSignal,
    permissions: subPermissions,
  };

  const subExecutor = new ToolExecutor(subRegistry, subCtx, hooks);

  const leaderExecutor = (ctx as any)._executor;
  const leaderOnToolCall = leaderExecutor ? (leaderExecutor as any)._onToolCall : null;
  const leaderOnToolResult = leaderExecutor ? (leaderExecutor as any)._onToolResult : null;
  const leaderOnSubagentDone = leaderExecutor ? (leaderExecutor as any)._onSubagentDone : null;
  const leaderOnDelegateStart = leaderExecutor ? (leaderExecutor as any)._onDelegateStart : null;
  let toolUseCount = 0;
  if (leaderOnToolCall) {
    (subExecutor as any)._onToolCall = (name: string, summary: string) => {
      toolUseCount++;
      leaderOnToolCall(name, summary, true);
    };
  }
  if (leaderOnToolResult) {
    (subExecutor as any)._onToolResult = (name: string, result: string, isError: boolean) => {
      leaderOnToolResult(name, result, isError, true);
    };
  }
  if (leaderOnDelegateStart) {
    leaderOnDelegateStart(task.agent);
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
      abortSignal: ctx.abortSignal,
      onText: () => {},
      onTokens: (deltaTokens: number) => {
        subTokens += deltaTokens;
      },
    });
    if (leaderOnSubagentDone) {
      const duration = Date.now() - startTime;
      leaderOnSubagentDone(task.agent, toolUseCount, subTokens, duration);
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  const result = (lastAssistant && lastAssistant.content) ? lastAssistant.content : "(no response)";
  return result;
}

export const delegateTool: ToolDefinition = {
  name: "delegate",
  description: "Delegate a coding task to a subagent. Use atlas-swift for mechanical edits (exact old→new), atlas-forge for features/refactors/tests, atlas-deep when coder has failed twice.",
  inputSchema: {
    properties: {
      agent: {
        type: "string",
        enum: ["atlas-swift", "atlas-forge", "atlas-deep"],
        description: "Which executor to use: atlas-swift (mechanical), atlas-forge (logic/features), atlas-deep (deep investigation)",
      },
      task: {
        type: "string",
        description: "Self-contained task description. Include: file paths, current code, target code, build/test commands. The subagent has NO context from this conversation.",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Key file paths relevant to the task (optional, helps subagent focus)",
      },
      build_command: {
        type: "string",
        description: "Build command to run after changes (optional)",
      },
      test_command: {
        type: "string",
        description: "Test command to run after changes (optional)",
      },
    },
    required: ["agent", "task"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { agent, task, files, build_command, test_command } = input as DelegateInput;

    const result = await executeSingleDelegate({ agent, task, files, build_command, test_command }, ctx);
    return { toolUseId: "", content: result.slice(0, 50000), isError: false };
  },
};

export const delegateParallelTool: ToolDefinition = {
  name: "delegate_parallel",
  description: "Run multiple subagent tasks in parallel. Use when tasks are independent (different files/modules). Results are collected and returned together.",
  inputSchema: {
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            agent: { type: "string", enum: ["atlas-swift", "atlas-forge", "atlas-deep"] },
            task: { type: "string", description: "Self-contained task description" },
            files: { type: "array", items: { type: "string" } },
            build_command: { type: "string" },
            test_command: { type: "string" },
          },
          required: ["agent", "task"],
        },
        description: "Array of independent tasks to run in parallel",
      },
    },
    required: ["tasks"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { tasks } = input as { tasks: ParallelTask[] };

    if (!tasks || tasks.length === 0) {
      return { toolUseId: "", content: "Error: no tasks provided", isError: true };
    }

    const results = await Promise.all(
      tasks.map(async (t, i) => {
        try {
          const result = await executeSingleDelegate(t, ctx);
          return `## Task ${i + 1}: ${t.agent} — ${t.task.slice(0, 60)}\n\n${result}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `## Task ${i + 1}: ${t.agent} — ERROR\n\n${msg}`;
        }
      })
    );

    return {
      toolUseId: "",
      content: results.join("\n\n---\n\n"),
      isError: false,
    };
  },
};
