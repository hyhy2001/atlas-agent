import React from "react";
import { Box, Text } from "ink";
import type { AgentTask } from "../types.js";
import { formatElapsed, formatTokenCount } from "../format.js";
import { useTheme } from "../theme.js";

interface SubagentTreeProps {
  tasks: AgentTask[];
}

export function SubagentTree({ tasks }: SubagentTreeProps) {
  const theme = useTheme();
  const running = tasks.filter(t => t.status === "running");
  const recentDone = tasks
    .filter(t => t.status !== "running")
    .slice(-3);

  if (running.length === 0 && recentDone.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={0}>
      {running.map(task => (
        <Box key={task.id}>
          <Text color={theme.primary}>{"◯ "}</Text>
          <Text color={theme.primary}>{task.agent}</Text>
          <Text color={theme.muted} dimColor>
            {`  ${formatElapsed(Math.floor((Date.now() - task.startedAt) / 1000))}`}
          </Text>
        </Box>
      ))}
      {recentDone.map(task => {
        const icon = task.status === "error" ? "✗ " : "✓ ";
        const iconColor = task.status === "error" ? theme.error : theme.success;
        const dur = task.durationMs !== undefined ? formatElapsed(Math.floor(task.durationMs / 1000)) : "";
        const tools = task.toolUses ?? 0;
        const tokens = task.tokens ?? 0;
        const meta = [dur && `${dur}`, tools > 0 && `${tools} tools`, tokens > 0 && `${formatTokenCount(tokens)} tokens`].filter(Boolean).join(" · ");
        return (
          <Box key={task.id}>
            <Text color={iconColor}>{icon}</Text>
            <Text color={theme.muted} dimColor>{task.agent}</Text>
            {meta && <Text color={theme.muted} dimColor>{`  ${meta}`}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
