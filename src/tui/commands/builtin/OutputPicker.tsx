import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../../components/Pane.js";
import { useTheme } from "../../theme.js";
import type { LocalJSXOnDone } from "../types.js";

const OUTPUT_STYLES = [
  { name: "default", desc: "5 lines preview per tool result" },
  { name: "compact", desc: "1-line summary per tool result" },
  { name: "verbose", desc: "Full output, no truncation" },
] as const;

interface OutputPickerProps {
  currentStyle: "default" | "compact" | "verbose";
  onSelect: (name: "default" | "compact" | "verbose") => void;
  done: LocalJSXOnDone;
}

export function OutputPicker({ currentStyle, onSelect, done }: OutputPickerProps) {
  const theme = useTheme();
  const [idx, setIdx] = useState(Math.max(0, OUTPUT_STYLES.findIndex(s => s.name === currentStyle)));

  useInput((input, key) => {
    if (key.upArrow) setIdx(i => Math.max(0, i - 1));
    if (key.downArrow) setIdx(i => Math.min(OUTPUT_STYLES.length - 1, i + 1));
    if (key.return) {
      const chosen = OUTPUT_STYLES[idx]!;
      onSelect(chosen.name);
      done(`Output style set to ${chosen.name}`);
    }
    if (key.escape) done();
  });

  return (
    <Pane color="permission">
      <Box marginBottom={1}>
        <Text bold color={theme.permission}>Output style</Text>
      </Box>
      {OUTPUT_STYLES.map((s, i) => (
        <Box key={s.name}>
          <Text color={i === idx ? theme.permission : theme.muted}>
            {i === idx ? "❯ " : "  "}
          </Text>
          <Text color={i === idx ? theme.permission : theme.muted} bold={i === idx}>
            {s.name}
          </Text>
          <Text color={theme.muted} dimColor>{"  " + s.desc}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>↑↓ navigate  ↵ select  Esc cancel</Text>
      </Box>
    </Pane>
  );
}
