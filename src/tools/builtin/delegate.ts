import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { OpenAIProvider } from "../../provider/openai.js";
import { ToolRegistry } from "../registry.js";
import { ToolExecutor } from "../executor.js";
import { runAgentLoop } from "../../agent/loop.js";
import type { Message } from "../../provider/types.js";

const ATLAS_MECH_PROMPT = `You are atlas-mech, a mechanical code executor. You ONLY apply exact edits provided to you.

Rules:
- Apply the exact old_string → new_string replacements specified
- Run build/test commands if specified
- Report immediately if old_string doesn't match or build fails
- Do NOT discover code, do NOT expand scope, do NOT reason about alternatives
- If anything is unclear or fails, report and STOP — do not retry`;

const ATLAS_CODER_PROMPT = `You are atlas-coder, a code implementation agent. You implement features, fix bugs, refactor code, and write tests.

Rules:
- Follow the plan provided by the leader exactly
- Use read_file, grep, glob, list_directory to understand code before editing
- Use edit_file and write_file to make changes
- Run build and test commands with bash after changes
- Report: files changed, diff summary, build/test results, blockers
- Do NOT decide architecture or expand scope beyond the plan
- Do NOT skip build/test verification`;

const ATLAS_RESCUE_PROMPT = `You are atlas-rescue, a deep investigation agent. You are called when atlas-coder has failed twice on the same task.

Rules:
- Start fresh — do NOT repeat the same approach that failed
- Investigate root cause thoroughly before attempting a fix
- Use read_file, grep, glob extensively to understand the full picture
- Consider alternative approaches the previous attempts missed
- Report your findings and proposed approach before making changes
- Be thorough but surgical — fix the actual problem, not symptoms`;

interface DelegateInput {
  agent: "atlas-mech" | "atlas-coder" | "atlas-rescue";
  task: string;
  files?: string[];
  build_command?: string;
  test_command?: string;
}

export const delegateTool: ToolDefinition = {
  name: "delegate",
  description: "Delegate a coding task to a subagent. Use atlas-mech for mechanical edits (exact old→new), atlas-coder for features/refactors/tests, atlas-rescue when coder has failed twice.",
  inputSchema: {
    properties: {
      agent: {
        type: "string",
        enum: ["atlas-mech", "atlas-coder", "atlas-rescue"],
        description: "Which executor to use: atlas-mech (mechanical), atlas-coder (logic/features), atlas-rescue (deep investigation)",
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

    const provider = (ctx as any)._provider as OpenAIProvider;
    const registry = (ctx as any)._registry as ToolRegistry;
    const hooks = (ctx as any)._hooks;

    if (!provider || !registry) {
      return { toolUseId: "", content: "Error: delegation not available (provider/registry not set)", isError: true };
    }

    let systemPrompt: string;
    let subProvider: OpenAIProvider;

    const fastModel = (ctx as any)._fastModel || process.env["ATLAS_FAST_MODEL"];
    const reasoningModel = (ctx as any)._reasoningModel || process.env["ATLAS_REASONING_MODEL"];

    switch (agent) {
      case "atlas-mech":
        systemPrompt = ATLAS_MECH_PROMPT;
        subProvider = fastModel ? provider.withModel(fastModel) : provider;
        break;
      case "atlas-coder":
        systemPrompt = ATLAS_CODER_PROMPT;
        subProvider = fastModel ? provider.withModel(fastModel) : provider;
        break;
      case "atlas-rescue":
        systemPrompt = ATLAS_RESCUE_PROMPT;
        subProvider = reasoningModel ? provider.withModel(reasoningModel) : provider;
        break;
    }

    let fullTask = task;
    if (files && files.length > 0) {
      fullTask += `\n\nRelevant files: ${files.join(", ")}`;
    }
    if (build_command) {
      fullTask += `\n\nAfter changes, run build: ${build_command}`;
    }
    if (test_command) {
      fullTask += `\n\nAfter changes, run tests: ${test_command}`;
    }

    const messages: Message[] = [
      { role: "user", content: fullTask },
    ];

    let subRegistry = registry;
    if (agent === "atlas-mech") {
      subRegistry = new ToolRegistry();
      const allowed = ["read_file", "write_file", "edit_file", "bash"];
      for (const tool of registry.getAll()) {
        if (allowed.includes(tool.name)) {
          subRegistry.register(tool);
        }
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

    let output = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    }) as any;

    try {
      await runAgentLoop({
        provider: subProvider,
        messages,
        toolRegistry: subRegistry,
        executor: subExecutor,
        systemPrompt,
        abortSignal: ctx.abortSignal,
      });
    } catch (err) {
      output += `\nError: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      process.stdout.write = originalWrite;
    }

    const result = output.trim() || "(subagent completed with no text output)";
    return { toolUseId: "", content: result.slice(0, 50000), isError: false };
  },
};
