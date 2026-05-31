import { formatTokenCount } from "../../format.js";
import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const doctorCommand: LocalCommand = {
  kind: "local",
  name: "doctor",
  description: "Run basic config and MCP health checks",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const app = ctx.app ?? {};
    const providerGetModel = app["providerGetModel"] as (() => string) | undefined;
    const providerBaseUrl = app["providerBaseUrl"] as string | undefined;
    const mcpStatus = (app["mcpStatus"] as Array<{ name: string; status: string; toolCount: number; error?: string }>) ?? [];
    const totalToolCount = (app["totalToolCount"] as number | undefined) ?? 0;
    const sessionId = (app["sessionId"] as string | undefined) ?? "";
    const messageCount = (app["messageCount"] as number | undefined) ?? 0;
    const tokens = (app["tokens"] as { input: number; output: number }) ?? { input: 0, output: 0 };

    const checks: string[] = [];
    const baseUrl = process.env["ATLAS_BASE_URL"] ?? providerBaseUrl ?? "(not exposed)";
    const authToken = process.env["ATLAS_AUTH_TOKEN"] ?? "";
    checks.push(`Config:`);
    checks.push(`  ATLAS_BASE_URL:    ${baseUrl ? "✓ set" : "✗ missing"}`);
    checks.push(`  ATLAS_AUTH_TOKEN:  ${authToken ? "✓ set" : "✗ missing"}`);
    checks.push(`  Model:             ${providerGetModel?.() || "✗ not set"}`);
    checks.push("");
    checks.push(`MCP servers (${mcpStatus.length}):`);

    if (mcpStatus.length === 0) {
      checks.push(`  (none configured)`);
    } else {
      for (const s of mcpStatus) {
        const icon = s.status === "connected" ? "✓" : "✗";
        const detail = s.status === "connected" ? `${s.toolCount} tools` : (s.error ?? "failed");
        checks.push(`  ${icon} ${s.name}  — ${detail}`);
      }
    }

    checks.push("");
    checks.push(`Tools: ${totalToolCount} registered`);
    checks.push("");
    checks.push(`Session: ${sessionId}`);
    checks.push(`  Messages: ${messageCount}`);
    checks.push(`  Tokens:   ${formatTokenCount(tokens.input + tokens.output)}`);

    return { type: "text", value: checks.join("\n") };
  },
};
