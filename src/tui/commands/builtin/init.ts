import { promises as fs } from "node:fs";
import path from "node:path";
import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const initCommand: LocalCommand = {
  kind: "local",
  name: "init",
  description: "Generate ATLAS.md project context file",
  argumentHint: "[--force]",
  source: "builtin",
  async call(ctx: SlashCommandContext): Promise<LocalCommandResult> {
    const force = ctx.args.includes("--force");
    const runPrompt = ctx.app?.["runPrompt"] as ((text: string) => Promise<void>) | undefined;

    if (!runPrompt) return { type: "text", value: "Error: runPrompt not available in context." };

    try {
      await fs.access(path.join(ctx.cwd, "ATLAS.md"));
      if (!force) return { type: "text", value: "ATLAS.md already exists. Use /init --force to regenerate." };
    } catch {}

    ctx.addSystem("Scanning project structure...");

    let projectInfo = "";
    try {
      const { execSync } = await import("node:child_process");
      const tree = execSync(
        "find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/deps/*' -not -path '*/.atlas/sessions/*' -not -path '*/.atlas/cache/*' -not -path '*/.atlas/telemetry/*' | sort 2>/dev/null",
        { encoding: "utf8", cwd: ctx.cwd }
      ).slice(0, 3000);
      projectInfo += `\nProject file tree:\n${tree}`;
    } catch {}

    try {
      const pkg = await fs.readFile(path.join(ctx.cwd, "package.json"), "utf-8");
      const parsed = JSON.parse(pkg);
      projectInfo += `\n\npackage.json: name=${parsed.name}, version=${parsed.version}`;
      if (parsed.scripts) projectInfo += `\nScripts: ${Object.keys(parsed.scripts).join(", ")}`;
      if (parsed.dependencies) projectInfo += `\nDependencies: ${Object.keys(parsed.dependencies).slice(0, 15).join(", ")}`;
    } catch {}

    await runPrompt(`Generate an ATLAS.md file for this project. Here is the scanned project context:
${projectInfo}

Create a concise ATLAS.md (under 150 lines) with these sections:
1. **Project overview** — what this project does (1-2 sentences)
2. **Key directories** — what each important directory contains
3. **Build/run/test commands** — exact commands to build, run, test
4. **Architecture** — main components and how they connect
5. **Common tasks** — how to add features, run tests, debug
6. **Conventions** — important patterns, constraints, or rules

Write the file using write_file tool to ATLAS.md in the current directory.`);

    return { type: "skip" };
  },
};
