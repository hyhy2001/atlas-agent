import React from "react";
import { Box, Static, Text } from "ink";
import type { HistoryEntry } from "../types.js";
import { DiffBlock } from "./DiffBlock.js";
import { formatToolName, formatToolResult, isDiffOutput } from "../format.js";
import { useTheme } from "../theme.js";

interface MessageListProps {
  history: HistoryEntry[];
  outputStyle?: "default" | "compact" | "verbose";
}

// Group ≥3 consecutive tool_call entries with the same toolName into one
// "tool_group" entry. Read 5 files in a row → "● Read × 5" instead of 5
// separate lines. Tool results stay separate so output is still readable.
export function groupConsecutiveToolCalls(history: HistoryEntry[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  let i = 0;
  while (i < history.length) {
    const entry = history[i];
    if (
      entry.type === "tool_call" &&
      entry.toolName !== "more" &&
      entry.toolName &&
      // Only group "noisy" read-only tools — never edits or bash
      ["read_file", "grep", "glob", "list_directory", "read_many_files"].includes(entry.toolName)
    ) {
      // Look ahead: collect consecutive same-tool entries (allowing tool_result between)
      const groupName = entry.toolName;
      const groupNested = entry.nested;
      const callTexts: string[] = [];
      let j = i;
      while (j < history.length) {
        const e = history[j];
        if (e.type === "tool_call" && e.toolName === groupName && e.nested === groupNested) {
          callTexts.push(e.text || "");
          j++;
        } else if (e.type === "tool_result" && j > i) {
          // skip the result that follows a grouped call — keep advancing
          j++;
        } else {
          break;
        }
      }
      if (callTexts.length >= 3) {
        out.push({
          type: "tool_call",
          toolName: groupName,
          text: `${callTexts.length} calls`,
          nested: groupNested,
          fullText: callTexts.join(" | "),
        });
        i = j;
        continue;
      }
    }
    out.push(entry);
    i++;
  }
  return out;
}

export function MessageList({ history, outputStyle = "default" }: MessageListProps) {
  const theme = useTheme();
  const displayed = groupConsecutiveToolCalls(history);
  return (
    <Static items={displayed}>
      {(entry, index) => (
        <Box key={index} flexDirection="column" marginBottom={entry.type === "user" || entry.type === "banner" ? 1 : 0}>
          {entry.type === "banner" && (
            <Text>{entry.text}</Text>
          )}
          {entry.type === "user" && (
            <Box marginTop={1}>
              <Text color={theme.user} bold>{"> "}</Text>
              <Text bold>{entry.text}</Text>
            </Box>
          )}
          {entry.type === "assistant" && (
            <Box paddingLeft={0}>
              <Text>{entry.text}</Text>
            </Box>
          )}
          {entry.type === "tool_call" && entry.toolName === "more" && (
            <Box paddingLeft={entry.nested ? 2 : 0}>
              <Text color={theme.muted} dimColor>{"  … " + (entry.text || "more")}</Text>
            </Box>
          )}
          {entry.type === "tool_call" && entry.toolName !== "more" && (
            <Box paddingLeft={entry.nested ? 2 : 0}>
              <Text color={entry.isError ? theme.error : theme.success}>{"● "}</Text>
              <Text bold>{formatToolName(entry.toolName ?? "tool")}</Text>
              {entry.text && <Text color={theme.muted} dimColor>{"(" + entry.text + ")"}</Text>}
            </Box>
          )}
          {entry.type === "tool_result" && isDiffOutput(entry.text) && (
            <DiffBlock text={entry.text} nested={entry.nested} />
          )}
          {entry.type === "tool_result" && !isDiffOutput(entry.text) && (() => {
            const maxLines = outputStyle === "verbose" ? 999 : outputStyle === "compact" ? 1 : 5;
            const { preview, hidden } = formatToolResult(entry.text, maxLines);
            const lines = preview.split("\n");
            const indent = entry.nested ? 4 : 2;
            return (
              <Box flexDirection="column" paddingLeft={indent}>
                {lines.map((line, i) => (
                  <Box key={i}>
                    <Text color={theme.success}>{i === 0 ? "⎿  " : "   "}</Text>
                    <Text color={entry.isError ? theme.error : theme.muted} dimColor={!entry.isError}>{line}</Text>
                  </Box>
                ))}
                {hidden > 0 && (
                  <Box>
                    <Text color={theme.muted} dimColor>{"   … +" + hidden + " lines (ctrl+o to expand)"}</Text>
                  </Box>
                )}
              </Box>
            );
          })()}
          {entry.type === "tool_result_full" && (
            <Box flexDirection="column" paddingLeft={entry.nested ? 4 : 2}>
              {entry.text.split("\n").map((line, i) => (
                <Box key={i}>
                  <Text color={theme.success}>{i === 0 ? "⎿  " : "   "}</Text>
                  <Text color={entry.isError ? theme.error : theme.muted} dimColor={!entry.isError}>{line}</Text>
                </Box>
              ))}
            </Box>
          )}
          {entry.type === "subagent_done" && (
            <Box paddingLeft={2}>
              <Text color={theme.muted} dimColor>{"  ⎿  " + entry.text}</Text>
            </Box>
          )}
          {entry.type === "compact_boundary" && (
            <Box>
              <Text color={theme.muted} dimColor>{"─── compacted ─── " + entry.text + " ───"}</Text>
            </Box>
          )}
          {entry.type === "system" && (
            <Text color={theme.primary} dimColor>{entry.text}</Text>
          )}
        </Box>
      )}
    </Static>
  );
}
