import { readFileSync, existsSync } from "node:fs";
import { paths } from "./paths.js";

export interface ExecPolicy {
  allowPatterns: string[];
  denyPatterns: string[];
  denyMessages: Record<string, string>;
}

export function loadExecPolicy(): ExecPolicy {
  const configPath = paths.config();
  const defaults: ExecPolicy = {
    allowPatterns: ["*"],
    denyPatterns: [
      "rm -rf /",
      "rm -rf /*",
      "mkfs.*",
      "dd if=*of=/dev/*",
      ":(){:|:&};:",
      "chmod -R 777 /",
      "curl*|*sh",
      "wget*|*sh",
    ],
    denyMessages: {
      "rm -rf /": "Blocked: recursive delete of root filesystem",
      "rm -rf /*": "Blocked: recursive delete of root filesystem",
    },
  };

  if (!existsSync(configPath)) return defaults;

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    if (raw.execPolicy) {
      return {
        allowPatterns: raw.execPolicy.allow ?? defaults.allowPatterns,
        denyPatterns: [...defaults.denyPatterns, ...(raw.execPolicy.deny ?? [])],
        denyMessages: { ...defaults.denyMessages, ...(raw.execPolicy.denyMessages ?? {}) },
      };
    }
  } catch {}

  return defaults;
}

export function checkCommand(command: string, policy: ExecPolicy): { allowed: boolean; reason?: string } {
  const trimmed = command.trim();

  for (const pattern of policy.denyPatterns) {
    if (matchPattern(trimmed, pattern)) {
      return { allowed: false, reason: policy.denyMessages[pattern] ?? `Blocked by execpolicy: matches "${pattern}"` };
    }
  }

  if (policy.allowPatterns.includes("*")) return { allowed: true };

  for (const pattern of policy.allowPatterns) {
    if (matchPattern(trimmed, pattern)) return { allowed: true };
  }

  return { allowed: false, reason: "Command not in allowlist" };
}

function matchPattern(command: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const regex = new RegExp("^" + pattern.replace(/[.+^${}()|[\\]\\\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return regex.test(command);
}
