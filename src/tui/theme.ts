import React from "react";

export interface ThemeColors {
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
}

export type ThemeName = "dark" | "light" | "monokai" | "solarized";

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
  },
};

export const ThemeContext = React.createContext<ThemeColors>(THEMES.dark);

export function useTheme(): ThemeColors {
  return React.useContext(ThemeContext);
}
