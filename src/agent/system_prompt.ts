import {
  getRoleSection,
  getToneSection,
  getActionsCareSection,
  getCyberRiskSection,
  getNumericLengthAnchorsSection,
  getMcpInstructionsSection,
  getWorkedExampleSection,
  getDoingTasksSection,
  getUsingToolsSection,
  getSystemHygieneSection,
  getCommunicationSection,
  getSkillInvocationSection,
  getResultClearingSection,
  getEnvSection,
  DYNAMIC_BOUNDARY,
} from "./prompt_sections.js";

interface BuildLeaderOpts {
  mcpStatus?: Array<{ name: string; status: string; toolCount: number }>;
  model?: string;
  cwd?: string;
}

export function buildLeaderPrompt(opts: BuildLeaderOpts = {}): string {
  return [
    getRoleSection("leader"),
    getDoingTasksSection(),
    getUsingToolsSection(),
    getToneSection(),
    getCommunicationSection(),
    getActionsCareSection(),
    getCyberRiskSection(),
    getSystemHygieneSection(),
    getResultClearingSection(),
    getNumericLengthAnchorsSection(),
    getSkillInvocationSection(),
    getMcpInstructionsSection(opts.mcpStatus),
    getWorkedExampleSection("leader"),
    DYNAMIC_BOUNDARY,
    getEnvSection({ model: opts.model, cwd: opts.cwd }),
  ].filter(Boolean).join("\n\n");
}

// Backward-compatible default. Prefer `buildLeaderPrompt(opts)` so we can
// inject env / mcpStatus per session. Importers that just want a string still
// get a sensible static default.
export const DEFAULT_SYSTEM_PROMPT = buildLeaderPrompt();
