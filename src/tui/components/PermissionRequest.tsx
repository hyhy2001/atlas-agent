import React from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "./Pane.js";
import { useTheme } from "../theme.js";

export type PermissionKind =
  | "bash"
  | "file_write"
  | "file_read"
  | "web_fetch"
  | "generic";

export interface PermissionRequestProps {
  kind: PermissionKind;
  toolName: string;
  description: string;
  detail?: string;
  risk?: "low" | "medium" | "high";
  onAllow: () => void;
  onDeny: () => void;
  onAllowAlways?: () => void;
}

const RISK_COLORS: Record<string, string> = {
  low: "green",
  medium: "yellow",
  high: "red",
};

const KIND_ICONS: Record<PermissionKind, string> = {
  bash: "⚡",
  file_write: "✏️ ",
  file_read: "📖",
  web_fetch: "🌐",
  generic: "❓",
};

export function PermissionRequest({
  kind,
  toolName,
  description,
  detail,
  risk = "medium",
  onAllow,
  onDeny,
  onAllowAlways,
}: PermissionRequestProps) {
  const theme = useTheme();
  const riskColor = RISK_COLORS[risk] ?? "yellow";

  useInput((input, key) => {
    if (input === "y" || key.return) { onAllow(); return; }
    if (input === "n" || key.escape) { onDeny(); return; }
    if (input === "a" && onAllowAlways) { onAllowAlways(); return; }
  });

  return (
    <Pane color="permission">
      <Box marginBottom={1}>
        <Text bold color={theme.permission}>
          {KIND_ICONS[kind]} {toolName}
        </Text>
        <Text color={riskColor} dimColor>{`  [${risk} risk]`}</Text>
      </Box>

      <Box marginBottom={detail ? 1 : 0}>
        <Text>{description}</Text>
      </Box>

      {detail && (
        <Box
          borderStyle="single"
          borderColor={theme.subtle}
          paddingX={1}
          marginBottom={1}
        >
          <Text color={riskColor} dimColor={risk === "low"}>{detail}</Text>
        </Box>
      )}

      <Box gap={2} marginTop={1}>
        <Text color={theme.success} bold>{"y · allow"}</Text>
        <Text color={theme.error}>{"n · deny"}</Text>
        {onAllowAlways && (
          <Text color={theme.autoAccept} dimColor>{"a · allow always"}</Text>
        )}
        <Text color={theme.muted} dimColor>{"Esc · deny"}</Text>
      </Box>
    </Pane>
  );
}
