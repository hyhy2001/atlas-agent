import type React from "react";
import type { CustomCommand } from "../../commands.js";

// Discriminated union mirroring cc-ref's command shape, scoped to atlas.
//
//   prompt    — expands into a model-facing prompt string. Used for skills
//               and markdown-defined custom commands.
//   local     — runs synchronously, returns text/action. No UI rendered.
//               (vd /clear, /version, /cost.)
//   local-jsx — renders an interactive Ink UI inside the REPL via onDone
//               callback. (vd /theme picker, /model picker.)
export type SlashCommandKind = "prompt" | "local" | "local-jsx";

// Source/origin label — used by suggestion UI to show where a command came
// from (built-in vs user-defined vs plugin).
export type SlashCommandSource = "builtin" | "user" | "project" | "skill" | "plugin";

// Context passed to local/local-jsx commands. Intentionally narrow to keep
// commands testable without spinning up the whole App. Add fields as needed
// when migrating commands that reach into App state.
export interface SlashCommandContext {
  // Append a system message to the transcript history.
  addSystem: (text: string) => void;
  // Read raw user-typed args (everything after `/cmd `).
  args: string;
  // Current working directory.
  cwd: string;
  // Theme setter for /theme picker. Optional — only commands that need it use it.
  setThemeName?: (name: string) => void;
  // Output style setter for /output. Optional.
  setOutputStyle?: (style: "default" | "compact" | "verbose") => void;
  // Generic escape hatch for migration: commands can grab anything we haven't
  // formalized yet from this bag. New commands should prefer typed fields.
  app?: Record<string, unknown>;
}

// Result envelope from local commands.
export type LocalCommandResult =
  | { type: "text"; value: string }                    // Append text to transcript as a system message.
  | { type: "skip" }                                    // Did nothing, suggestion should be ignored.
  | { type: "exit" }                                    // Exit the app cleanly.
  | { type: "clear" }                                   // Clear conversation/history.
  | { type: "submit"; value: string };                  // Re-submit transformed input (used by aliases).

// Local-jsx callback shape. Calling done() closes the rendered UI.
export type LocalJSXOnDone = (result?: string) => void;

interface SlashCommandBase {
  // Canonical command name without leading slash (e.g. "help", "theme").
  name: string;
  // One-line description shown in suggestion menu.
  description: string;
  // Optional aliases (without leading slash). Suggestions surface canonical name.
  aliases?: string[];
  // Optional hint shown after `/cmd ` when the user has typed a space.
  argumentHint?: string;
  // Source label for suggestion UI.
  source: SlashCommandSource;
  // Hide from suggestion menu (still callable by exact name).
  hidden?: boolean;
}

export interface PromptCommand extends SlashCommandBase {
  kind: "prompt";
  // Expand the slash invocation to a prompt body. Args are everything after
  // `/cmd `. Returns the string that becomes the user message sent to the model.
  expand(args: string, ctx: SlashCommandContext): Promise<string> | string;
}

export interface LocalCommand extends SlashCommandBase {
  kind: "local";
  call(ctx: SlashCommandContext): Promise<LocalCommandResult> | LocalCommandResult;
}

export interface LocalJSXCommand extends SlashCommandBase {
  kind: "local-jsx";
  // Render an Ink node. Component owns its own input handling. Calling done()
  // closes the panel; optional result string is appended as a system message.
  render(ctx: SlashCommandContext, done: LocalJSXOnDone): Promise<React.ReactNode> | React.ReactNode;
}

export type SlashCommand = PromptCommand | LocalCommand | LocalJSXCommand;

// Wrap a CustomCommand (from .atlas/commands/*.md) as a PromptCommand.
export function customCommandToSlashCommand(cmd: CustomCommand): PromptCommand {
  return {
    kind: "prompt",
    name: cmd.name,
    description: cmd.description || `Custom command: ${cmd.name}`,
    source: cmd.source.includes(".atlas/commands") ? "project" : "user",
    expand: (args) => {
      // Inject `$ARGUMENTS` substitution like cc-ref's prompt commands. If the
      // body has no $ARGUMENTS, append args at the end so users can still pass
      // context to a parameterless command.
      const body = cmd.promptBody;
      if (body.includes("$ARGUMENTS")) {
        return body.replace(/\$ARGUMENTS/g, args);
      }
      return args ? `${body}\n\n${args}` : body;
    },
  };
}
