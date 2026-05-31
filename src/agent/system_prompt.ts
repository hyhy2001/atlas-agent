import {
  getRoleSection,
  getToneSection,
  getActionsCareSection,
  getCyberRiskSection,
  getMcpInstructionsSection,
  getDoingTasksSection,
  getUsingToolsSection,
  getEnvSection,
  DYNAMIC_BOUNDARY,
} from "./prompt_sections.js";

export interface BuildLeaderOpts {
  mcpStatus?: Array<{ name: string; status: string; toolCount: number }>;
  model?: string;
  cwd?: string;
}

export interface PromptBlock {
  text: string;
  cacheScope: "static" | "dynamic" | null;
}

export function buildLeaderPromptBlocks(opts: BuildLeaderOpts = {}): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  blocks.push({
    text: [
      getRoleSection("leader"),
      getDoingTasksSection(),
      getUsingToolsSection(),
      getToneSection(),
      getActionsCareSection(),
      getCyberRiskSection(),
    ].join("\n\n"),
    cacheScope: "static",
  });

  const dynamicParts = [
    getEnvSection({ model: opts.model, cwd: opts.cwd }),
    getMcpInstructionsSection(opts.mcpStatus),
  ].filter(Boolean);
  if (dynamicParts.length > 0) {
    blocks.push({
      text: dynamicParts.join("\n\n"),
      cacheScope: "dynamic",
    });
  }
  return blocks;
}

export function buildLeaderPrompt(opts: BuildLeaderOpts = {}): string {
  if (process.env["ATLAS_SIMPLE"] === "1") {
    const cwd = opts.cwd ?? process.cwd();
    const model = opts.model ?? "(unknown)";
    return `You are Atlas, an AI coding assistant.\n\nCWD: ${cwd}\nModel: ${model}\nDate: ${new Date().toISOString().slice(0, 10)}`;
  }
  const blocks = buildLeaderPromptBlocks(opts);
  const parts: string[] = [];
  let inserted = false;
  for (const b of blocks) {
    if (!inserted && b.cacheScope === "dynamic") {
      parts.push(DYNAMIC_BOUNDARY);
      inserted = true;
    }
    parts.push(b.text);
  }
  return parts.join("\n\n");
}

// Backward-compatible default. Prefer `buildLeaderPrompt(opts)` so we can
// inject env / mcpStatus per session. Importers that just want a string still
// get a sensible static default.
export const DEFAULT_SYSTEM_PROMPT = buildLeaderPrompt();
