import React from "react";
import { Box, Text } from "ink";

import { formatTokenCount } from "../format.js";
import { useTheme } from "../theme.js";
import type { CommandSuggestion } from "../commands/registry.js";

interface PromptInputProps {
  fullWidth: number;
  gitBranch: string;
  planActive: boolean;
  multiline: { mode: "ticks" | "slash"; lines: string[] } | null;
  input: string;
  slashCmds: CommandSuggestion[];
  slashCmdIndex: number;
  commandArgumentHint?: string | null;
  atSuggestions: { path: string; indices?: number[] }[];
  atSuggestionIndex: number;
  permMode: "ask" | "auto" | "plan";
  permModeLabels: Record<"ask" | "auto" | "plan", string>;
  tokens: { input: number; output: number };
  modelName: string;
  isRunning?: boolean;
  queuedMessage?: string | null;
}

export function PromptInput({
  fullWidth,
  gitBranch,
  planActive,
  multiline,
  input,
  slashCmds,
  slashCmdIndex,
  commandArgumentHint = null,
  atSuggestions,
  atSuggestionIndex,
  permMode,
  permModeLabels,
  tokens,
  modelName,
  isRunning = false,
  queuedMessage = null,
}: PromptInputProps) {
  const theme = useTheme();
  const prefix = planActive ? "[plan] " : multiline ? "[multiline] " : "❯ ";

  return (
    <>
      <Box flexDirection="column">
        <Box>
          {gitBranch ? (
            <>
              <Text color={theme.muted} dimColor>{"╭" + "─".repeat(Math.max(0, fullWidth - gitBranch.length - 5))}</Text>
              <Text color={theme.muted} dimColor>{" " + gitBranch + " ─╮"}</Text>
            </>
          ) : (
            <Text color={theme.muted} dimColor>{"╭" + "─".repeat(Math.max(0, fullWidth - 2)) + "╮"}</Text>
          )}
        </Box>
        <Box paddingX={1}>
          <Text color={theme.muted}>{prefix}</Text>
          <Text>{input}</Text>
          <Text color={theme.muted}>█</Text>
        </Box>
        {queuedMessage && (
          <Box paddingX={1}>
            <Text color={theme.warning} dimColor>{"⏎ queued: "}</Text>
            <Text color={theme.muted} dimColor>{queuedMessage.length > 60 ? queuedMessage.slice(0, 60) + "…" : queuedMessage}</Text>
          </Box>
        )}
        {input.startsWith("/") && input.length >= 1 && (
          <Box flexDirection="column" paddingX={2}>
            {slashCmds.map((s, i) => {
              const isSelected = i === slashCmdIndex;
              const name = s.command.name;
              const desc = s.command.description;
              const indices = new Set(s.indices ?? []);
              return (
                <Box key={name} justifyContent="space-between">
                  <Box>
                    <Text color={isSelected ? theme.suggestion : theme.muted}>
                      {isSelected ? "› " : "  "}
                    </Text>
                    <Text>
                      {name.split("").map((ch, ci) => (
                        <Text
                          key={ci}
                          color={indices.has(ci) ? theme.suggestion : (isSelected ? "white" : theme.muted)}
                          bold={indices.has(ci)}
                          dimColor={!isSelected && !indices.has(ci)}
                        >
                          {ch}
                        </Text>
                      ))}
                    </Text>
                    {isSelected && desc && (
                      <Text color={theme.muted} dimColor>{"  " + desc}</Text>
                    )}
                  </Box>
                </Box>
              );
            })}
            {commandArgumentHint && (
              <Box paddingLeft={2}>
                <Text color={theme.suggestion} dimColor>  {commandArgumentHint}</Text>
              </Box>
            )}
            {slashCmds.length > 0 && (
              <Text color={theme.muted} dimColor>  ↑↓ navigate  Tab · complete  ↵ · run</Text>
            )}
          </Box>
        )}
        {atSuggestions.length > 0 && (
          <Box flexDirection="column" paddingX={2}>
            {atSuggestions.map((item, i) => (
              <Box key={item.path}>
                <Text color={i === atSuggestionIndex ? theme.primary : theme.muted} dimColor={i !== atSuggestionIndex}>
                  {i === atSuggestionIndex ? "› " : "  "}
                </Text>
                {item.indices && item.indices.length > 0 ? (
                  <Text>
                    {item.path.split("").map((ch, ci) => (
                      <Text key={ci} color={item.indices!.includes(ci) ? theme.primary : (i === atSuggestionIndex ? "white" : theme.muted)} bold={item.indices!.includes(ci)}>
                        {ch}
                      </Text>
                    ))}
                  </Text>
                ) : (
                  <Text color={i === atSuggestionIndex ? theme.primary : theme.muted} dimColor={i !== atSuggestionIndex}>
                    {item.path}
                  </Text>
                )}
              </Box>
            ))}
            <Text color={theme.muted} dimColor>  ↑↓ navigate  Tab · complete</Text>
          </Box>
        )}
        <Box>
          <Text color={theme.muted} dimColor>{"╰" + "─".repeat(Math.max(0, fullWidth - 2)) + "╯"}</Text>
        </Box>
        <Box paddingX={2} justifyContent="space-between" width={fullWidth}>
          <Text color={theme.muted} dimColor>{
            isRunning
              ? "↵ · queue message  Ctrl+C · interrupt  Ctrl+O · expand"
              : "Tab · complete  ↵ · send  Ctrl+O · expand  Ctrl+C · exit"
          }</Text>
          {permMode === "auto" ? (
            <Text color={theme.autoAccept}>⏵⏵ accept edits on <Text dimColor>(shift+tab to cycle)</Text></Text>
          ) : permMode === "plan" ? (
            <Text color={theme.planMode}>⏸ plan mode on <Text dimColor>(shift+tab to cycle)</Text></Text>
          ) : (
            <Text color={theme.muted} dimColor>shift+tab · {permModeLabels[permMode]}</Text>
          )}
        </Box>
      </Box>
      <Box paddingX={2}>
        <Text color={theme.muted} dimColor>{(() => {
          const parts: string[] = [];
          if (tokens.input + tokens.output > 0) parts.push(`${formatTokenCount(tokens.input)}↑ ${formatTokenCount(tokens.output)}↓`);
          if (modelName && modelName !== "all" && modelName !== "default") parts.push(modelName);
          return parts.length > 0 ? parts.join("  ·  ") : "";
        })()}</Text>
      </Box>
    </>
  );
}
