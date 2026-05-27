import { createInterface } from "node:readline";
import chalk from "chalk";
import { createPatch } from "diff";
import type { PermissionDecision } from "./types.js";
import { highlightDiff, highlightFileContent } from "./highlight.js";

export async function askPermission(
  toolName: string,
  details: Record<string, string>
): Promise<PermissionDecision> {
  process.stdout.write("\n");
  process.stdout.write(chalk.yellow("Permission required") + "\n");
  process.stdout.write(chalk.white(`Tool: ${toolName}`) + "\n");

  for (const [key, value] of Object.entries(details)) {
    if (toolName === "edit_file" && key === "old_string" && details["new_string"]) {
      const filePath = details["path"] ?? "file";
      const patch = createPatch(filePath, value, details["new_string"], "old", "new");
      process.stdout.write(highlightDiff(patch, filePath) + "\n");
    } else if (key === "new_string" && toolName === "edit_file") {
      continue;
    } else if (toolName === "write_file" && key === "content" && details["path"]) {
      const lines = value.split("\n");
      const preview = highlightFileContent(lines.slice(0, 20).join("\n"), details["path"]);
      process.stdout.write(chalk.gray("  content (first 20 lines):") + "\n");
      process.stdout.write(preview + "\n");
      if (lines.length > 20) {
        process.stdout.write(chalk.gray(`  ... (${lines.length - 20} more lines)`) + "\n");
      }
    } else if (toolName === "bash" && key === "command") {
      process.stdout.write(chalk.gray("  $ ") + chalk.white(value) + "\n");
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
