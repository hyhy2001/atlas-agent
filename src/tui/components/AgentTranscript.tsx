import React from "react";
import { Box, Text } from "ink";
import type { AgentTask } from "../types.js";
import { MessageList } from "./MessageList.js";
import { useTheme } from "../theme.js";
import { formatElapsed, formatTokenCount } from "../format.js";

interface AgentTranscriptProps {
  task: AgentTask;
  outputStyle?: "default" | "compact" | "verbose";
}

export function AgentTranscript({ task, outputStyle = "default" }: AgentTranscriptProps) {
  const theme = useTheme();
  const isRunning = task.status === "running";
  const dur = task.durationMs ? formatElapsed(Math.floor(task.durationMs / 1000)) : "";
  const stats = [
    isRunning ? "running" : task.status,
    dur,
    task.toolUses ? `${task.toolUses} tools` : "",
    task.tokens ? formatTokenCount(task.tokens) + " tokens" : "",
  ].filter(Boolean).join(" · ");

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={theme.claude}>{task.agent}</Text>
        <Text color={theme.muted} dimColor>{"  " + stats}</Text>
        <Text color={theme.muted} dimColor>{"  ← to return"}</Text>
      </Box>
      {task.messages && task.messages.length > 0
        ? <MessageList history={task.messages} outputStyle={outputStyle} />
        : <Text color={theme.muted} dimColor>  No transcript available.</Text>
      }
    </Box>
  );
}
