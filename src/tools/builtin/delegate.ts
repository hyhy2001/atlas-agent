import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { runSubagent, type AgentProfile } from "../../agent/runner.js";

interface DelegateInput {
  agent: AgentProfile;
  task: string;
  files?: string[];
  build_command?: string;
  test_command?: string;
}

interface ParallelTask {
  agent: AgentProfile;
  task: string;
  files?: string[];
  build_command?: string;
  test_command?: string;
}

interface LeaderCallbacks {
  _onToolCall?: (name: string, summary: string, nested: boolean) => void;
  _onSubagentDone?: (agent: string, toolUses: number, tokens: number, durationMs: number) => void;
  _onDelegateStart?: (agent: string) => void;
}

async function executeSingleDelegate(task: ParallelTask, ctx: ExecutionContext): Promise<string> {
  if (!ctx.provider || !ctx.registry) {
    return "Error: delegation not available (provider/registry not set)";
  }

  const leader = ctx.executor as unknown as LeaderCallbacks | undefined;
  const onDelegateStart = leader?._onDelegateStart;
  const onSubagentDone = leader?._onSubagentDone;
  const onLeaderToolCall = leader?._onToolCall;

  if (onDelegateStart) onDelegateStart(task.agent);

  const result = await runSubagent(
    {
      profile: task.agent,
      task: task.task,
      files: task.files,
      buildCommand: task.build_command,
      testCommand: task.test_command,
      abortSignal: ctx.abortSignal,
      // Forward subagent tool calls with nested=true so the leader TUI shows
      // them indented. Skipping tool results keeps leader scrollback clean.
      onToolCall: onLeaderToolCall ? (name, summary) => onLeaderToolCall(name, summary, true) : undefined,
    },
    ctx,
  );

  if (onSubagentDone) {
    onSubagentDone(task.agent, result.toolUseCount, result.tokens, result.durationMs);
  }

  return result.output;
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
    return { toolUseId: "", content: typeof result === "string" ? result : String(result), isError: false };
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
