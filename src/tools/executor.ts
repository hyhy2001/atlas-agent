import ora from "ora";
import type { ToolResult, ExecutionContext } from "./types.js";
import type { ToolRegistry } from "./registry.js";
import { askPermission } from "../permissions/prompt.js";
import type { HooksConfig } from "../hooks.js";
import { matchHooks, buildHookEnv, runHook } from "../hooks.js";
import { isTrustedPath } from "../trust.js";

function getToolSummary(name: string, input: unknown): string {
  const inp = input as Record<string, unknown>;
  switch (name) {
    case "bash":
      return (inp.command as string)?.slice(0, 80) ?? "";
    case "read_file":
    case "write_file":
    case "edit_file":
      return String(inp.path ?? "");
    case "grep":
      return `${inp.pattern ?? ""}${inp.path ? ` in ${inp.path}` : ""}`;
    case "glob":
      return String(inp.pattern ?? "");
    case "git_status":
      return "";
    case "git_diff":
      return inp.path ? String(inp.path) : "";
    case "git_log":
      return "";
    case "git_commit":
      return (inp.message as string)?.slice(0, 60) ?? "";
    case "list_directory":
      return String(inp.path ?? ".");
    case "web_fetch":
      return (inp.url as string)?.slice(0, 60) ?? "";
    case "delegate":
      return String(inp.agent ?? "");
    default: {
      // For MCP tools (e.g. codebase-memory__search_graph), show first meaningful arg
      const firstVal = Object.values(inp).find(v => typeof v === "string" && v.length > 0);
      return firstVal ? String(firstVal).slice(0, 60) : "";
    }
  }
}

export class ToolExecutor {
  private registry: ToolRegistry;
  ctx: ExecutionContext;
  private hooks: HooksConfig;

  constructor(registry: ToolRegistry, ctx: ExecutionContext, hooks?: HooksConfig) {
    this.registry = registry;
    this.ctx = ctx;
    this.hooks = hooks ?? { PreToolUse: [], PostToolUse: [], SessionStart: [], SessionEnd: [], UserPromptSubmit: [], Stop: [] };
  }

  async execute(
    toolUseBlocks: Array<{ id: string; name: string; input: unknown }>
  ): Promise<ToolResult[]> {
    const readOnly: Array<{ id: string; name: string; input: unknown }> = [];
    const destructive: Array<{ id: string; name: string; input: unknown }> = [];

    for (const block of toolUseBlocks) {
      const tool = this.registry.get(block.name);
      if (!tool) {
        readOnly.push(block);
        continue;
      }
      if (tool.isDestructive) {
        destructive.push(block);
      } else {
        readOnly.push(block);
      }
    }

    const results: ToolResult[] = [];

    const readOnlyResults = await Promise.all(
      readOnly.map((block) => this.executeSingle(block))
    );
    results.push(...readOnlyResults);

    for (const block of destructive) {
      const result = await this.executeDestructive(block);
      results.push(result);
    }

    return results;
  }

  private async executeSingle(block: {
    id: string;
    name: string;
    input: unknown;
  }): Promise<ToolResult> {
    const tool = this.registry.get(block.name);
    if (!tool) {
      return { toolUseId: block.id, content: `Unknown tool: ${block.name}`, isError: true };
    }

    const useSpinner = process.stdout.isTTY && !process.env.__ATLAS_INK_MODE;

    try {
      // Run pre-hooks
      const pre = matchHooks(this.hooks.PreToolUse, block.name);
      for (const hook of pre) {
        const env = buildHookEnv(block.name, block.input);
        const hres = await runHook(hook, env);
        if (hres.exitCode !== 0) {
          return { toolUseId: block.id, content: `Blocked by PreToolUse hook: ${hres.stdout}`, isError: true };
        }
      }

      if (useSpinner) {
        const spinnerText = getToolSummary(block.name, block.input);
        const spinner = ora({ text: spinnerText, color: "cyan", spinner: "dots" }).start();
        try {
          const result = await tool.execute(block.input, this.ctx);
          spinner.succeed(block.name);

          // Run post hooks (best-effort)
          const post = matchHooks(this.hooks.PostToolUse, block.name);
          for (const hook of post) {
            const env = buildHookEnv(block.name, block.input);
            // best-effort
            await runHook(hook, env).catch(() => {});
          }

          return { ...result, toolUseId: block.id };
        } catch (err) {
          spinner.fail(block.name);
          const msg = err instanceof Error ? err.message : String(err);
          return { toolUseId: block.id, content: `Error: ${msg}`, isError: true };
        }
      } else {
        const onToolCall = (this as any)._onToolCall;
        if (onToolCall) onToolCall(block.name, getToolSummary(block.name, block.input));

        const result = await tool.execute(block.input, this.ctx);

        // Run post hooks (best-effort)
        const post = matchHooks(this.hooks.PostToolUse, block.name);
        for (const hook of post) {
          const env = buildHookEnv(block.name, block.input);
          // best-effort
          await runHook(hook, env).catch(() => {});
        }

        const onToolResult = (this as any)._onToolResult;
        if (onToolResult) onToolResult(block.name, result.content ?? "", result.isError ?? false);

        return { ...result, toolUseId: block.id };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: block.id, content: `Error: ${msg}`, isError: true };
    }
  }

  private async executeDestructive(block: {
    id: string;
    name: string;
    input: unknown;
  }): Promise<ToolResult> {
    const tool = this.registry.get(block.name);
    if (!tool) {
      return { toolUseId: block.id, content: `Unknown tool: ${block.name}`, isError: true };
    }

    if ((this as any)._autoApprove) {
      this.ctx.permissions.grant(block.name);
    }
    if (!this.ctx.permissions.check(block.name)) {
      const details: Record<string, string> = {};
      if (typeof block.input === "object" && block.input !== null) {
        for (const [k, v] of Object.entries(block.input)) {
          details[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
      }

      // Check trusted directories to skip permission prompt
      const trustedDirs = this.ctx.trustedDirs ?? [];
      const toolPath = (block.input as any)?.path;
      if (toolPath && isTrustedPath(toolPath, trustedDirs, this.ctx.workingDir)) {
        // Skip permission prompt — trusted directory
      } else {
        const decision = await askPermission(block.name, details);
        if (decision === "no") {
          return { toolUseId: block.id, content: "User denied permission", isError: true };
        }
        if (decision === "always") {
          this.ctx.permissions.grant(block.name);
        }
      }
    }

    const useSpinner = process.stdout.isTTY && !process.env.__ATLAS_INK_MODE;

    try {
      // Run pre-hooks (after permission granted)
      const pre = matchHooks(this.hooks.PreToolUse, block.name);

      if (useSpinner) {
        const spinnerText = getToolSummary(block.name, block.input);
        const spinner = ora({ text: spinnerText, color: "yellow", spinner: "dots" }).start();
        try {
          for (const hook of pre) {
            const env = buildHookEnv(block.name, block.input);
            const hres = await runHook(hook, env);
            if (hres.exitCode !== 0) {
              spinner.fail(block.name);
              return { toolUseId: block.id, content: `Blocked by PreToolUse hook: ${hres.stdout}`, isError: true };
            }
          }

          const result = await tool.execute(block.input, this.ctx);
          spinner.succeed(block.name);

          // Run post hooks (best-effort)
          const post = matchHooks(this.hooks.PostToolUse, block.name);
          for (const hook of post) {
            const env = buildHookEnv(block.name, block.input);
            // best-effort
            await runHook(hook, env).catch(() => {});
          }

          return { ...result, toolUseId: block.id };
        } catch (err) {
          spinner.fail(block.name);
          const msg = err instanceof Error ? err.message : String(err);
          return { toolUseId: block.id, content: `Error: ${msg}`, isError: true };
        }
      } else {
        for (const hook of pre) {
          const env = buildHookEnv(block.name, block.input);
          const hres = await runHook(hook, env);
          if (hres.exitCode !== 0) {
            return { toolUseId: block.id, content: `Blocked by PreToolUse hook: ${hres.stdout}`, isError: true };
          }
        }

        const onToolCall = (this as any)._onToolCall;
        if (onToolCall) onToolCall(block.name, getToolSummary(block.name, block.input));

        const result = await tool.execute(block.input, this.ctx);

        // Run post hooks (best-effort)
        const post = matchHooks(this.hooks.PostToolUse, block.name);
        for (const hook of post) {
          const env = buildHookEnv(block.name, block.input);
          // best-effort
          await runHook(hook, env).catch(() => {});
        }

        const onToolResult = (this as any)._onToolResult;
        if (onToolResult) onToolResult(block.name, result.content ?? "", result.isError ?? false);

        return { ...result, toolUseId: block.id };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: block.id, content: `Error: ${msg}`, isError: true };
    }
  }
}
