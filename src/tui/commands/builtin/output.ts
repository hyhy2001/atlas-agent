import React from "react";
import type { LocalJSXCommand, SlashCommandContext, LocalJSXOnDone } from "../types.js";
import { OutputPicker } from "./OutputPicker.js";

const OUTPUT_STYLES = ["default", "compact", "verbose"] as const;
type OutputStyle = (typeof OUTPUT_STYLES)[number];

export const outputCommand: LocalJSXCommand = {
  kind: "local-jsx",
  name: "output",
  description: "Set output verbosity style",
  argumentHint: "[default|compact|verbose]",
  source: "builtin",
  render(ctx: SlashCommandContext, done: LocalJSXOnDone) {
    const arg = ctx.args.trim().toLowerCase() as OutputStyle;
    if (arg && OUTPUT_STYLES.includes(arg)) {
      ctx.setOutputStyle?.(arg);
      done(`Output style set to ${arg}`);
      return null;
    }
    return React.createElement(OutputPicker, {
      currentStyle: ctx.app?.["outputStyle"] as OutputStyle ?? "default",
      onSelect: (name: OutputStyle) => ctx.setOutputStyle?.(name),
      done,
    });
  },
};
