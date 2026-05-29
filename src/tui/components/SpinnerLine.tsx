import React from "react";
import { Box, Text } from "ink";
import { formatElapsed, formatTokenCount, formatToolName } from "../format.js";
import { useTheme } from "../theme.js";

interface SpinnerLineProps {
  spinFrame: number;
  spinFrames: string[];
  statusVerb: string;
  elapsedSecs: number;
  liveTokens: number;
  currentToolName: string;
  reasoningPreview: string;
  tip: string | null;
}

export function SpinnerLine({
  spinFrame,
  spinFrames,
  statusVerb,
  elapsedSecs,
  liveTokens,
  currentToolName,
  reasoningPreview,
  tip,
}: SpinnerLineProps) {
  const theme = useTheme();
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.primary}>{spinFrames[spinFrame]}</Text>
        <Text color={theme.muted}> {statusVerb} · {formatElapsed(elapsedSecs)}{liveTokens > 0 ? ` · ↓ ${formatTokenCount(liveTokens)} tokens` : ""}{currentToolName ? ` · ${formatToolName(currentToolName)}` : ""} · esc to interrupt</Text>
      </Box>
      {reasoningPreview && (
        <Box paddingLeft={2}>
          <Text color={theme.reasoning} dimColor>{"💭 " + reasoningPreview}</Text>
        </Box>
      )}
      {tip && (
        <Box>
          <Text color={theme.muted} dimColor>  Tip: {tip}</Text>
        </Box>
      )}
    </Box>
  );
}
