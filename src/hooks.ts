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
}

export async function loadHooks(cwd: string): Promise<HooksConfig> {
  const result: HooksConfig = { PreToolUse: [], PostToolUse: [] };

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
