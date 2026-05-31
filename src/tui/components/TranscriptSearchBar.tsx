import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";

interface TranscriptSearchBarProps {
  onClose: (query: string) => void;
  onCancel: () => void;
}

export function TranscriptSearchBar({ onClose, onCancel }: TranscriptSearchBarProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");

  useInput((input, key) => {
    if (key.return) {
      onClose(query);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery(q => q + input);
    }
  });

  return (
    <Box>
      <Text color={theme.suggestion}>{" / "}</Text>
      <Text>{query}</Text>
      <Text color={theme.muted} dimColor>{"█"}</Text>
      <Text color={theme.muted} dimColor>{"  Enter · search  Esc · cancel"}</Text>
    </Box>
  );
}
