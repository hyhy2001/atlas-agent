import React from "react";
import { Box, Text, useInput } from "ink";
import type { HistoryEntry } from "../types.js";
import { MessageList } from "./MessageList.js";
import { TranscriptSearchBar } from "./TranscriptSearchBar.js";
import { useTheme } from "../theme.js";

interface TranscriptPagerProps {
  history: HistoryEntry[];
  frozenCount: number | null;
  searchQuery: string;
  searchOpen: boolean;
  dumpMode: boolean;
  outputStyle?: "default" | "compact" | "verbose";
  onClose: () => void;
  onOpenSearch: () => void;
  onCloseSearch: (query: string) => void;
  onDumpMode: () => void;
}

const MAX_TRANSCRIPT_LINES = 200;

export function TranscriptPager({
  history,
  frozenCount,
  searchQuery,
  searchOpen,
  dumpMode,
  outputStyle = "verbose",
  onClose,
  onOpenSearch,
  onCloseSearch,
  onDumpMode,
}: TranscriptPagerProps) {
  const theme = useTheme();

  const messages = frozenCount !== null ? history.slice(0, frozenCount) : history;
  const displayed = dumpMode ? messages : messages.slice(-MAX_TRANSCRIPT_LINES);
  const hidden = messages.length - displayed.length;

  const filtered = searchQuery
    ? displayed.filter(e =>
        e.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.toolName ?? "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : displayed;

  useInput((input, key) => {
    if (searchOpen) return;
    if (key.escape || input === "q") {
      onClose();
      return;
    }
    if (input === "/") {
      onOpenSearch();
      return;
    }
    if (input === "[" && !dumpMode) {
      onDumpMode();
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.claude} bold>{"── Transcript "}</Text>
        <Text color={theme.muted} dimColor>
          {`${filtered.length} messages${searchQuery ? ` matching "${searchQuery}"` : ""}  `}
        </Text>
        <Text color={theme.muted} dimColor>{"q · exit  / · search  [ · dump all"}</Text>
      </Box>
      {hidden > 0 && (
        <Box>
          <Text color={theme.muted} dimColor>{`  … ${hidden} older messages hidden ([ to show all)`}</Text>
        </Box>
      )}
      <MessageList history={filtered} outputStyle={outputStyle} />
      {searchOpen ? (
        <TranscriptSearchBar
          onClose={onCloseSearch}
          onCancel={() => onCloseSearch("")}
        />
      ) : (
        <Box>
          <Text color={theme.muted} dimColor>
            {searchQuery
              ? `  Search: "${searchQuery}"  n · next  N · prev  / · new search  q · exit`
              : "  q · exit  / · search  [ · dump all messages"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
