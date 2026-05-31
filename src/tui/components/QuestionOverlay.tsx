import React from "react";
import { Box, Text } from "ink";
import type { DialogRequest } from "../hooks/useDialogQueue.js";
import { useTheme } from "../theme.js";
import { Pane } from "./Pane.js";

interface QuestionOverlayProps {
  overlay: DialogRequest | null;
  width: number;
}

export function QuestionOverlay({ overlay, width }: QuestionOverlayProps) {
  const theme = useTheme();
  if (!overlay) return null;

  return (
    <Pane color="permission" width={width}>
      <Box marginBottom={1}>
        <Text bold color={theme.permission}>{"? "}</Text>
        <Text bold>{overlay.question}</Text>
      </Box>
      {overlay.items.map((item, i) => (
        <Box key={i} flexDirection="column">
          <Box>
            <Text color={i === overlay.selectedIndex ? theme.permission : theme.muted}>
              {i === overlay.selectedIndex ? "❯ " : "  "}
            </Text>
            <Text color={i === overlay.selectedIndex ? theme.permission : theme.muted} bold={i === overlay.selectedIndex}>
              {item.label}
            </Text>
          </Box>
          {item.sublabel && (
            <Box paddingLeft={2}>
              <Text color={theme.muted} dimColor>{item.sublabel}</Text>
            </Box>
          )}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>↑↓ navigate  ↵ select{overlay.items.length <= 4 ? "  1-4 quick pick" : ""}  Esc cancel</Text>
      </Box>
    </Pane>
  );
}
