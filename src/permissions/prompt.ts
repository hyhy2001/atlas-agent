import { createInterface } from "node:readline";
import chalk from "chalk";
import { createPatch } from "diff";
import type { PermissionDecision } from "./types.js";

export async function askPermission(
  toolName: string,
  details: Record<string, string>
): Promise<PermissionDecision> {
  process.stdout.write("\n");
  process.stdout.write(chalk.yellow("Permission required") + "\n");
  process.stdout.write(chalk.white(`Tool: ${toolName}`) + "\n");

  for (const [key, value] of Object.entries(details)) {
    if (toolName === "edit_file" && key === "old_string" && details["new_string"]) {
      const patch = createPatch("file", value, details["new_string"], "old", "new");
      process.stdout.write(chalk.gray(patch) + "\n");
    } else if (key === "new_string" && toolName === "edit_file") {
      continue;
    } else {
      process.stdout.write(chalk.gray(`  ${key}: ${value}`) + "\n");
    }
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<PermissionDecision>((resolve) => {
    rl.question(chalk.cyan("[y/N/always] "), (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === "y" || normalized === "yes") {
        resolve("yes");
      } else if (normalized === "always" || normalized === "a") {
        resolve("always");
      } else {
        resolve("no");
      }
    });
  });
}
