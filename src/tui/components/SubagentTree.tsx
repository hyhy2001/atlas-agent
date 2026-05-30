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
  const recentDone = tasks.filter(t => t.status !== "running").slice(-3);

  if (running.length === 0 && recentDone.length === 0) return null;

  const allVisible = [...running, ...recentDone];

  return (
    <Box flexDirection="column" marginTop={0}>
      {allVisible.map((task, idx) => {
        const isLast = idx === allVisible.length - 1;
        const treeChar = isLast ? "└─" : "├─";
        const isRunning = task.status === "running";
        const isError = task.status === "error";

        const statusText = isRunning
          ? "Running…"
          : isError ? "Error" : "Done";

        const dur = task.durationMs !== undefined
          ? formatElapsed(Math.floor(task.durationMs / 1000))
          : "";
        const tools = task.toolUses ?? 0;
        const tokens = task.tokens ?? 0;
        const stats = !isRunning
          ? [
              dur,
              tools > 0 ? `${tools} tool ${tools === 1 ? "use" : "uses"}` : "",
              tokens > 0 ? `${formatTokenCount(tokens)} tokens` : "",
            ].filter(Boolean).join(" \xB7 ")
          : "";

        return (
          <Box key={task.id} flexDirection="column">
            <Box paddingLeft={3}>
              <Text color={theme.muted} dimColor>{treeChar + " "}</Text>
              <Text
                bold
                color={isRunning ? theme.primary : isError ? theme.error : theme.muted}
                dimColor={!isRunning && !isError}
              >
                {task.agent}
              </Text>
              {stats ? (
                <Text color={theme.muted} dimColor>{" \xB7 " + stats}</Text>
              ) : isRunning ? (
                <Text color={theme.muted} dimColor>
                  {"  \xB7 " + formatElapsed(Math.floor((Date.now() - task.startedAt) / 1000))}
                </Text>
              ) : null}
            </Box>
            <Box paddingLeft={3}>
              <Text color={theme.muted} dimColor>
                {isLast ? "   ⎿  " : "│  ⎿  "}
              </Text>
              <Text color={theme.muted} dimColor>{statusText}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
