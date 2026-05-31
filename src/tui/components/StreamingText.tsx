import React from "react";
import { Text } from "ink";

interface StreamingTextProps {
  text: string;
  color?: string;
}

// Splits streaming text into a stable prefix (complete lines) and an
// unstable suffix (current incomplete line). Only the suffix re-renders
// on each token, keeping the stable prefix frozen in <Static>-like fashion.
export function StreamingText({ text, color }: StreamingTextProps) {
  const lastNewline = text.lastIndexOf("\n");
  const stablePrefix = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : "";
  const unstableSuffix = lastNewline >= 0 ? text.slice(lastNewline + 1) : text;

  return (
    <>
      {stablePrefix && <Text color={color}>{stablePrefix}</Text>}
      {unstableSuffix && <Text color={color}>{unstableSuffix}</Text>}
    </>
  );
}
