import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface HookDefinition {
  matcher: string;
  command: string;
}

export interface HooksConfig {
  PreToolUse: HookDefinition[];
  PostToolUse: HookDefinition[];
  SessionStart: HookDefinition[];
  SessionEnd: HookDefinition[];
  UserPromptSubmit: HookDefinition[];
  Stop: HookDefinition[];
}

export async function loadHooks(cwd: string): Promise<HooksConfig> {
  const result: HooksConfig = {
    PreToolUse: [],
    PostToolUse: [],
    SessionStart: [],
    SessionEnd: [],
    UserPromptSubmit: [],
    Stop: [],
  };

  const globalPath = join(homedir(), ".atlas", "settings.json");
  const localPath = join(cwd, ".atlas", "settings.json");

  for (const filePath of [globalPath, localPath]) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.hooks) {
        if (Array.isArray(parsed.hooks.PreToolUse)) {
          result.PreToolUse.push(...parsed.hooks.PreToolUse);
        }
        if (Array.isArray(parsed.hooks.PostToolUse)) {
          result.PostToolUse.push(...parsed.hooks.PostToolUse);
        }
        if (Array.isArray(parsed.hooks.SessionStart)) {
          result.SessionStart.push(...parsed.hooks.SessionStart);
        }
        if (Array.isArray(parsed.hooks.SessionEnd)) {
          result.SessionEnd.push(...parsed.hooks.SessionEnd);
        }
        if (Array.isArray(parsed.hooks.UserPromptSubmit)) {
          result.UserPromptSubmit.push(...parsed.hooks.UserPromptSubmit);
        }
        if (Array.isArray(parsed.hooks.Stop)) {
          result.Stop.push(...parsed.hooks.Stop);
        }
      }
    } catch {
      // File doesn't exist or is invalid JSON — skip
    }
  }

  return result;
}

export function matchHooks(hooks: HookDefinition[], toolName: string): HookDefinition[] {
  return hooks.filter((h) => h.matcher === "*" || h.matcher === toolName);
}

export function buildHookEnv(toolName: string, input: unknown): Record<string, string> {
  const env: Record<string, string> = {
    TOOL_NAME: toolName,
    TOOL_INPUT: JSON.stringify(input),
  };

  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    if (toolName === "edit_file" || toolName === "write_file" || toolName === "read_file") {
      if (typeof obj.path === "string") {
        env.TOOL_PATH = obj.path;
      }
    } else if (toolName === "bash") {
      if (typeof obj.command === "string") {
        env.TOOL_COMMAND = obj.command;
      }
    } else if (toolName === "grep") {
      if (typeof obj.pattern === "string") {
        env.TOOL_PATTERN = obj.pattern;
      }
    }
  }

  return env;
}

export async function runHook(
  hook: HookDefinition,
  env: Record<string, string>
): Promise<{ exitCode: number; stdout: string }> {
  try {
    const stdout = execSync(hook.command, {
      env: { ...process.env, ...env },
      timeout: 10_000,
      encoding: "utf-8",
      shell: "/bin/sh",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout: stdout.trim() };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const e = err as { status: number | null; stdout?: string };
      return {
        exitCode: e.status ?? 1,
        stdout: (typeof e.stdout === "string" ? e.stdout : "").trim(),
      };
    }
    return { exitCode: 1, stdout: "" };
  }
}

export async function runLifecycleHooks(hooks: HookDefinition[], env: Record<string, string>): Promise<void> {
  for (const hook of hooks) {
    try {
      await runHook(hook, env);
    } catch {
      // best-effort, never block
    }
  }
}
