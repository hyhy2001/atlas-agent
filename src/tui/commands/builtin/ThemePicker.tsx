import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../../components/Pane.js";
import { useTheme } from "../../theme.js";
import type { LocalJSXOnDone } from "../types.js";

const THEMES = [
  { name: "dark", desc: "Cyan accents (default)" },
  { name: "light", desc: "Blue accents" },
  { name: "monokai", desc: "Magenta + yellow" },
  { name: "solarized", desc: "Muted blue + cyan" },
];

interface ThemePickerProps {
  currentTheme: string;
  onSelect: (name: string) => void;
  done: LocalJSXOnDone;
}

export function ThemePicker({ currentTheme, onSelect, done }: ThemePickerProps) {
  const theme = useTheme();
  const [idx, setIdx] = useState(Math.max(0, THEMES.findIndex(t => t.name === currentTheme)));

  useInput((input, key) => {
    if (key.upArrow) setIdx(i => Math.max(0, i - 1));
    if (key.downArrow) setIdx(i => Math.min(THEMES.length - 1, i + 1));
    if (key.return) {
      const chosen = THEMES[idx]!;
      onSelect(chosen.name);
      done(`Theme set to ${chosen.name}`);
    }
    if (key.escape) done();
  });

  return (
    <Pane color="permission">
      <Box marginBottom={1}>
        <Text bold color={theme.permission}>Theme</Text>
      </Box>
      {THEMES.map((t, i) => (
        <Box key={t.name}>
          <Text color={i === idx ? theme.permission : theme.muted}>
            {i === idx ? "❯ " : "  "}
          </Text>
          <Text color={i === idx ? theme.permission : theme.muted} bold={i === idx}>
            {t.name}
          </Text>
          <Text color={theme.muted} dimColor>{"  " + t.desc}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>↑↓ navigate  ↵ select  Esc cancel</Text>
      </Box>
    </Pane>
  );
}
