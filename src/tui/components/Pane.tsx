import React from "react";
import { Box, Text } from "ink";
import { useTheme, type ThemeColors } from "../theme.js";

// Modal context — when Pane is rendered inside a modal slot, the slot itself
// already provides the frame. Pane skips its top divider and tightens padding
// so we don't double-frame. Mirrors cc-ref's `useIsInsideModal` pattern.
const ModalContext = React.createContext<boolean>(false);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  return <ModalContext.Provider value={true}>{children}</ModalContext.Provider>;
}

export function useIsInsideModal(): boolean {
  return React.useContext(ModalContext);
}

interface PaneProps {
  children: React.ReactNode;
  // Theme color key for the top divider. Must be a string token on ThemeColors.
  color?: keyof ThemeColors;
  // Override divider char (default: "─").
  dividerChar?: string;
  // Force the divider width (default: terminal columns - 2).
  width?: number;
}

// Top-divider panel for slash command UIs and floating panels. Visual idiom:
//
//   ──────────────────────────────────  ← divider in `color`
//     <children>                        ← paddingX=2 content
//
// Inside a modal slot the divider is suppressed and padding tightens to 1.
export function Pane({ children, color = "primary", dividerChar = "─", width }: PaneProps) {
  const theme = useTheme();
  const insideModal = useIsInsideModal();

  if (insideModal) {
    // flexShrink=0 prevents Yoga from collapsing this Box's height to 0 when
    // the modal slot's parent Box has no resolved height. cc-ref hit this with
    // /permissions blanking on Down arrow.
    return (
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {children}
      </Box>
    );
  }

  const cols = width ?? Math.max(20, (process.stdout.columns ?? 80) - 2);
  const colorValue = theme[color];

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text color={colorValue}>{dividerChar.repeat(cols)}</Text>
      <Box flexDirection="column" paddingX={2}>
        {children}
      </Box>
    </Box>
  );
}
