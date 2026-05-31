import { SlashCommandRegistry } from "../registry.js";
import { helpCommand } from "./help.js";
import { versionCommand } from "./version.js";
import { clearCommand } from "./clear.js";
import { themeCommand } from "./theme.js";
import { outputCommand } from "./output.js";
import { exitCommand } from "./exit.js";
import { sessionsCommand } from "./sessions.js";
import { agentsCommand } from "./agents.js";
import { planCommand } from "./plan.js";
import { executeCommand } from "./execute.js";
import { costCommand } from "./cost.js";
import { contextCommand } from "./context.js";
import { configCommand } from "./config.js";
import { statsCommand } from "./stats.js";
import { mcpCommand } from "./mcp.js";
import { skillsCommand } from "./skills.js";
import { modelCommand } from "./model.js";
import { bgCommand } from "./bg.js";
import { diffCommand } from "./diff.js";
import { undoCommand } from "./undo.js";
import { trustCommand } from "./trust.js";
import { doctorCommand } from "./doctor.js";
import { tasksCommand } from "./tasks.js";
import { cronCommand } from "./cron.js";
import { teamCommand } from "./team.js";
import { worktreeCommand } from "./worktree.js";
import { initCommand } from "./init.js";
import { saveCommand } from "./save.js";
import { loadCommand } from "./load.js";
import { resumeCommand } from "./resume.js";
import { compactCommand } from "./compact.js";
import { agentCommand } from "./agent.js";
import type { CustomCommand } from "../../../commands.js";
import { customCommandToSlashCommand } from "../types.js";

// Build a registry pre-loaded with all built-in commands.
// Pass customCommands (from .atlas/commands/*.md) to also register those.
export function buildRegistry(customCommands: CustomCommand[] = []): SlashCommandRegistry {
  const registry = new SlashCommandRegistry();

  // Built-ins registered first — custom commands override by name if they clash.
  registry.registerAll([
    helpCommand,
    versionCommand,
    clearCommand,
    themeCommand,
    outputCommand,
    exitCommand,
    sessionsCommand,
    agentsCommand,
    planCommand,
    executeCommand,
    costCommand,
    contextCommand,
    configCommand,
    statsCommand,
    mcpCommand,
    skillsCommand,
    modelCommand,
    bgCommand,
    diffCommand,
    undoCommand,
    trustCommand,
    doctorCommand,
    tasksCommand,
    cronCommand,
    teamCommand,
    worktreeCommand,
    initCommand,
    saveCommand,
    loadCommand,
    resumeCommand,
    compactCommand,
    agentCommand,
  ]);

  // Wrap and register custom/skill commands.
  for (const cmd of customCommands) {
    registry.register(customCommandToSlashCommand(cmd));
  }

  return registry;
}

export { SlashCommandRegistry } from "../registry.js";
export * from "../types.js";
