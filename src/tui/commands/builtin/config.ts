import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const configCommand: LocalCommand = {
  kind: "local",
  name: "config",
  description: "Show Atlas configuration and session settings",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const app = ctx.app ?? {};
    const mainModel = (app["mainModel"] as string) ?? "";
    const fastModel = (app["fastModel"] as string) ?? "(uses main)";
    const reasoningModel = (app["reasoningModel"] as string) ?? "(uses main)";
    const themeName = (app["themeName"] as string) ?? "dark";
    const outputStyle = (app["outputStyle"] as string) ?? "default";
    const permModeLabel = (app["permModeLabel"] as string) ?? "ask";
    const planActive = (app["planActive"] as boolean) ?? false;
    const mcpCount = (app["mcpCount"] as number) ?? 0;
    const leaderToolCount = (app["leaderToolCount"] as number) ?? 0;
    const totalToolCount = (app["totalToolCount"] as number) ?? leaderToolCount;
    const skillCount = (app["skillCount"] as number) ?? 0;
    const subagentCount = (app["subagentCount"] as number) ?? 0;

    const lines = [
      `Atlas configuration:`,
      ``,
      `Models:`,
      `  leader:    ${mainModel}`,
      `  fast:      ${fastModel}`,
      `  reasoning: ${reasoningModel}`,
      ``,
      `Session:`,
      `  theme:        ${themeName}`,
      `  output style: ${outputStyle}`,
      `  permission:   ${permModeLabel}`,
      `  plan mode:    ${planActive ? "on" : "off"}`,
      ``,
      `Tools & extensions:`,
      `  leader tools: ${leaderToolCount}`,
      `  total tools:  ${totalToolCount}`,
      `  MCP servers:  ${mcpCount} connected`,
      `  skills:       ${skillCount}`,
      `  subagents:    ${subagentCount}`,
      ``,
      `Change: /model · /theme · /output · shift+tab (permission)`,
    ];

    return { type: "text", value: lines.join("\n") };
  },
};
