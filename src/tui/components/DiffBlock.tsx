import React from "react";
import { Box, Text } from "ink";
import { parseDiffOutput, isDiffOutput } from "../format.js";
import { useTheme } from "../theme.js";

interface DiffBlockProps {
  text: string;
  nested?: boolean;
}

export function DiffBlock({ text, nested }: DiffBlockProps) {
  const theme = useTheme();
  if (!isDiffOutput(text)) return null;

  const { header, lines } = parseDiffOutput(text);
  const indent = nested ? 4 : 2;
  const maxLines = 40;
  const visibleLines = lines.slice(0, maxLines);
  const hiddenCount = lines.length - visibleLines.length;
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      <Box>
        <Text color={theme.success}>{"⎿  "}</Text>
        <Text bold>{header}</Text>
      </Box>
      {visibleLines.map((line, i) => {
        const lineNumStr = line.lineNum !== undefined ? String(line.lineNum).padStart(4, " ") : "    ";
        if (line.type === "add") {
          return (
            <Box key={i} paddingLeft={3}>
              <Text color={theme.muted} dimColor>{lineNumStr + " "}</Text>
              <Text color={theme.diffAdd}>+ {line.text}</Text>
            </Box>
          );
        }
        if (line.type === "remove") {
          return (
            <Box key={i} paddingLeft={3}>
              <Text color={theme.muted} dimColor>{lineNumStr + " "}</Text>
              <Text color={theme.diffRemove}>- {line.text}</Text>
            </Box>
          );
        }
        if (line.type === "context") {
          return (
            <Box key={i} paddingLeft={3}>
              <Text color={theme.muted} dimColor>{lineNumStr + "   " + line.text}</Text>
            </Box>
          );
        }
        if (line.type === "hunk") {
          return (
            <Box key={i} paddingLeft={3}>
              <Text color={theme.diffHunk} dimColor>{line.text}</Text>
            </Box>
          );
        }
        return (
          <Box key={i} paddingLeft={3}>
            <Text color={theme.muted} dimColor>{line.text}</Text>
          </Box>
        );
      })}
      {hiddenCount > 0 && (
        <Box paddingLeft={3}>
          <Text color={theme.muted} dimColor>{"  … +" + hiddenCount + " more lines (use /diff for full diff)"}</Text>
        </Box>
      )}
    </Box>
  );
}
