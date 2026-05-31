import React from "react";
import type { LocalJSXCommand, SlashCommandContext, LocalJSXOnDone } from "../types.js";
import { ThemePicker } from "./ThemePicker.js";

const THEME_NAMES = ["dark", "light", "monokai", "solarized"] as const;
type ThemeName = typeof THEME_NAMES[number];

export const themeCommand: LocalJSXCommand = {
  kind: "local-jsx",
  name: "theme",
  description: "Change the color theme",
  argumentHint: "[dark|light|monokai|solarized]",
  source: "builtin",
  render(ctx: SlashCommandContext, done: LocalJSXOnDone) {
    const arg = ctx.args.trim().toLowerCase() as ThemeName;
    if (arg && THEME_NAMES.includes(arg)) {
      ctx.setThemeName?.(arg);
      done(`Theme set to ${arg}`);
      return null;
    }
    return React.createElement(ThemePicker, {
      currentTheme: ctx.app?.["themeName"] as string ?? "dark",
      onSelect: (name: string) => ctx.setThemeName?.(name),
      done,
    });
  },
};
