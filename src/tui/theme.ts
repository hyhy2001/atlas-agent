import React from "react";

// Semantic theme token system — shape mirrors cc-ref's design.
// Tokens fall into three groups:
//   1. Legacy ANSI tokens (primary, success, ...) — preserved 1:1 so existing
//      call sites keep rendering with the same colors they had before.
//   2. Brand identity tokens (claude, permission, planMode, fastMode) — used
//      by new UI primitives (Pane top-divider, autoAccept indicator, ...).
//   3. Shimmer variants for animated states.
//
// Using `string` for every token keeps Ink's color prop happy for both ANSI
// names ("cyan") and RGB strings ("rgb(215,119,87)").
export interface ThemeColors {
  // -- legacy tokens (kept for backward compatibility) --
  primary: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  diffAdd: string;
  diffRemove: string;
  diffHunk: string;
  user: string;
  reasoning: string;

  // -- brand identity --
  claude: string;            // assistant accent (orange)
  claudeShimmer: string;
  permission: string;        // permission/auth prompts (lavender)
  permissionShimmer: string;
  planMode: string;          // plan-mode indicator (teal)
  autoAccept: string;        // auto-approve indicator (purple)
  fastMode: string;          // fast model indicator (electric orange)
  fastModeShimmer: string;

  // -- structural --
  text: string;
  inverseText: string;
  inactive: string;
  subtle: string;
  suggestion: string;        // /command, @file, #channel hints
  promptBorder: string;
  bashBorder: string;
  remember: string;

  // -- diff word-level --
  diffAddedWord: string;
  diffRemovedWord: string;

  // -- subagent palette (8 distinct) --
  agentRed: string;
  agentBlue: string;
  agentGreen: string;
  agentYellow: string;
  agentPurple: string;
  agentOrange: string;
  agentPink: string;
  agentCyan: string;

  // -- rainbow (ultrathink/ultraplan keyword highlight) --
  rainbow_red: string;
  rainbow_orange: string;
  rainbow_yellow: string;
  rainbow_green: string;
  rainbow_blue: string;
  rainbow_indigo: string;
  rainbow_violet: string;
}

export type ThemeName = "dark" | "light" | "monokai" | "solarized";

// Shared semantic palette — every concrete theme spreads this then overrides
// the bits that vary. Keeps the 4 themes visually consistent for brand colors.
const sharedDark = {
  claude: "rgb(215,119,87)",
  claudeShimmer: "rgb(235,159,127)",
  permission: "rgb(177,185,249)",
  permissionShimmer: "rgb(207,215,255)",
  planMode: "rgb(72,150,140)",
  autoAccept: "rgb(175,135,255)",
  fastMode: "rgb(255,120,20)",
  fastModeShimmer: "rgb(255,165,70)",
  text: "rgb(255,255,255)",
  inverseText: "rgb(0,0,0)",
  inactive: "rgb(153,153,153)",
  subtle: "rgb(80,80,80)",
  suggestion: "rgb(177,185,249)",
  promptBorder: "rgb(136,136,136)",
  bashBorder: "rgb(253,93,177)",
  remember: "rgb(177,185,249)",
  diffAddedWord: "rgb(56,166,96)",
  diffRemovedWord: "rgb(179,89,107)",
  agentRed: "rgb(220,38,38)",
  agentBlue: "rgb(37,99,235)",
  agentGreen: "rgb(22,163,74)",
  agentYellow: "rgb(202,138,4)",
  agentPurple: "rgb(147,51,234)",
  agentOrange: "rgb(234,88,12)",
  agentPink: "rgb(219,39,119)",
  agentCyan: "rgb(8,145,178)",
  rainbow_red: "rgb(235,95,87)",
  rainbow_orange: "rgb(245,139,87)",
  rainbow_yellow: "rgb(250,195,95)",
  rainbow_green: "rgb(145,200,130)",
  rainbow_blue: "rgb(130,170,220)",
  rainbow_indigo: "rgb(155,130,200)",
  rainbow_violet: "rgb(200,130,180)",
} as const;

const sharedLight = {
  ...sharedDark,
  permission: "rgb(87,105,247)",
  permissionShimmer: "rgb(137,155,255)",
  planMode: "rgb(0,102,102)",
  autoAccept: "rgb(135,0,255)",
  text: "rgb(0,0,0)",
  inverseText: "rgb(255,255,255)",
  inactive: "rgb(102,102,102)",
  subtle: "rgb(175,175,175)",
  suggestion: "rgb(87,105,247)",
  promptBorder: "rgb(153,153,153)",
  bashBorder: "rgb(255,0,135)",
  remember: "rgb(0,0,255)",
  fastMode: "rgb(255,106,0)",
  fastModeShimmer: "rgb(255,150,50)",
} as const;

export const THEMES: Record<ThemeName, ThemeColors> = {
  dark: {
    primary: "cyan",
    success: "green",
    warning: "yellow",
    error: "red",
    muted: "gray",
    diffAdd: "green",
    diffRemove: "red",
    diffHunk: "cyan",
    user: "cyan",
    reasoning: "magenta",
    ...sharedDark,
  },
  light: {
    primary: "blue",
    success: "green",
    warning: "yellow",
    error: "red",
    muted: "gray",
    diffAdd: "green",
    diffRemove: "red",
    diffHunk: "blue",
    user: "blue",
    reasoning: "magenta",
    ...sharedLight,
  },
  monokai: {
    primary: "magenta",
    success: "green",
    warning: "yellow",
    error: "red",
    muted: "gray",
    diffAdd: "green",
    diffRemove: "red",
    diffHunk: "magenta",
    user: "magenta",
    reasoning: "yellow",
    ...sharedDark,
    claude: "rgb(249,38,114)",
    claudeShimmer: "rgb(255,98,154)",
    suggestion: "rgb(166,226,46)",
  },
  solarized: {
    primary: "blue",
    success: "green",
    warning: "yellow",
    error: "red",
    muted: "gray",
    diffAdd: "green",
    diffRemove: "red",
    diffHunk: "blue",
    user: "blue",
    reasoning: "cyan",
    ...sharedDark,
    claude: "rgb(203,75,22)",
    claudeShimmer: "rgb(223,115,62)",
    permission: "rgb(38,139,210)",
    permissionShimmer: "rgb(78,179,250)",
    planMode: "rgb(42,161,152)",
    suggestion: "rgb(38,139,210)",
  },
};

export const ThemeContext = React.createContext<ThemeColors>(THEMES.dark);

export function useTheme(): ThemeColors {
  return React.useContext(ThemeContext);
}
