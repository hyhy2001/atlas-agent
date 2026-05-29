import React from "react";
import { Box, Text } from "ink";
import type { AgentTask } from "../types.js";
import { formatElapsed } from "../format.js";
import { useTheme } from "../theme.js";

interface SubagentTreeProps {
  tasks: AgentTask[];
}

export function SubagentTree({ tasks }: SubagentTreeProps) {
  const theme = useTheme();
  const runningTasks = tasks.filter(t => t.status === "running");
  if (runningTasks.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={0}>
      {runningTasks.map(task => (
        <Box key={task.id}>
          <Text color={theme.primary}>{"◯ "}</Text>
          <Text color={theme.primary}>{task.agent}</Text>
          <Text color={theme.muted} dimColor>
            {`  ${formatElapsed(Math.floor((Date.now() - task.startedAt) / 1000))}`}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
