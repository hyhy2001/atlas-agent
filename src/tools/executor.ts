import type { ToolResult, ExecutionContext } from "./types.js";
import type { ToolRegistry } from "./registry.js";
import { askPermission } from "../permissions/prompt.js";
import type { HooksConfig } from "../hooks.js";
import { matchHooks, buildHookEnv, runHook } from "../hooks.js";

export class ToolExecutor {
  private registry: ToolRegistry;
  private ctx: ExecutionContext;
  private hooks: HooksConfig;

  constructor(registry: ToolRegistry, ctx: ExecutionContext, hooks?: HooksConfig) {
    this.registry = registry;
    this.ctx = ctx;
    this.hooks = hooks ?? { PreToolUse: [], PostToolUse: [] };
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

      const result = await tool.execute(block.input, this.ctx);

      // Run post hooks (best-effort)
      const post = matchHooks(this.hooks.PostToolUse, block.name);
      for (const hook of post) {
        const env = buildHookEnv(block.name, block.input);
        // best-effort
        await runHook(hook, env).catch(() => {});
      }

      return { ...result, toolUseId: block.id };
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

    if (!this.ctx.permissions.check(block.name)) {
      const details: Record<string, string> = {};
      if (typeof block.input === "object" && block.input !== null) {
        for (const [k, v] of Object.entries(block.input)) {
          details[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
      }

      const decision = await askPermission(block.name, details);
      if (decision === "no") {
        return { toolUseId: block.id, content: "User denied permission", isError: true };
      }
      if (decision === "always") {
        this.ctx.permissions.grant(block.name);
      }
    }

    try {
      // Run pre-hooks (after permission granted)
      const pre = matchHooks(this.hooks.PreToolUse, block.name);
      for (const hook of pre) {
        const env = buildHookEnv(block.name, block.input);
        const hres = await runHook(hook, env);
        if (hres.exitCode !== 0) {
          return { toolUseId: block.id, content: `Blocked by PreToolUse hook: ${hres.stdout}`, isError: true };
        }
      }

      const result = await tool.execute(block.input, this.ctx);

      // Run post hooks (best-effort)
      const post = matchHooks(this.hooks.PostToolUse, block.name);
      for (const hook of post) {
        const env = buildHookEnv(block.name, block.input);
        // best-effort
        await runHook(hook, env).catch(() => {});
      }

      return { ...result, toolUseId: block.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: block.id, content: `Error: ${msg}`, isError: true };
    }
  }
}
