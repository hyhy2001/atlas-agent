import React from "react";
import { Box, Text, useInput } from "ink";
import type { AgentTask } from "../types.js";
import { formatElapsed, formatTokenCount } from "../format.js";
import { useTheme } from "../theme.js";

interface AgentPanelProps {
  tasks: AgentTask[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  width: number;
}

export function AgentPanel({ tasks, selectedId, onSelect, onClose, width }: AgentPanelProps) {
  const theme = useTheme();
  const selectedIdx = Math.max(0, tasks.findIndex(t => t.id === selectedId) + 1);
  const [idx, setIdx] = React.useState(selectedIdx);

  const items = [
    { id: null, label: "● Leader", sublabel: "Main conversation" },
    ...tasks.map(t => ({
      id: t.id,
      label: `${t.status === "running" ? "⟳" : t.status === "error" ? "✗" : "✓"} ${t.agent}`,
      sublabel: t.status === "running"
        ? `running · ${t.toolUses ?? 0} tools`
        : `${t.durationMs ? formatElapsed(Math.floor(t.durationMs / 1000)) : ""} · ${t.toolUses ?? 0} tools · ${formatTokenCount(t.tokens ?? 0)} tokens`,
    })),
  ];

  useInput((input, key) => {
    if (key.upArrow || input === "k") setIdx(i => Math.max(0, i - 1));
    if (key.downArrow || input === "j") setIdx(i => Math.min(items.length - 1, i + 1));
    if (key.return) {
      const item = items[idx];
      if (item) onSelect(item.id);
      onClose();
    }
    if (key.escape || input === "q") onClose();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.claude} paddingX={1} width={width}>
      <Box marginBottom={1}>
        <Text bold color={theme.claude}>Agents</Text>
        <Text color={theme.muted} dimColor>  ↑↓ navigate  ↵ view  Esc close</Text>
      </Box>
      {items.map((item, i) => (
        <Box key={item.id ?? "leader"}>
          <Text color={i === idx ? theme.claude : theme.muted}>
            {i === idx ? "❯ " : "  "}
          </Text>
          <Text color={i === idx ? "white" : theme.muted} bold={i === idx}>
            {item.label}
          </Text>
          {item.sublabel && (
            <Text color={theme.muted} dimColor>{"  " + item.sublabel}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
