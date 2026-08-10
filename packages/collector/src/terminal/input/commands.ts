/**
 * commands.ts — PURE slash-command handlers + the command table. Each handler
 * takes the current layout + args and returns a CommandResult describing the
 * effect (a new layout to save, a feedback line, multi-line output, or quit) —
 * it performs NO I/O, so the whole command surface is unit-tested without a TTY.
 * The shell applies the result (persist layout, paint message, exit).
 *
 * Adding a command = one entry in COMMAND_TABLE; the registry shape keeps the
 * router and `/help` in lockstep (help is generated from the table).
 */
import { ALLOWED_RANGE_DAYS, ALLOWED_VIEWS, clampRangeDays, clampView, setRangeDays, setView } from "../layout.ts";
import type { TerminalLayout } from "../types.ts";

export interface CommandResult {
  /** New layout when the command changed it (the shell saves + repaints). */
  layout?: TerminalLayout;
  /** A single feedback line shown under the board. */
  message?: string;
  /** Multi-line output (help, layout listing). */
  lines?: string[];
  /** Request the shell to exit. */
  quit?: boolean;
}

export interface CommandSpec {
  name: string;
  aliases?: string[];
  /** The argument placeholder shown in help/palette ("<7|30|90>"), or
   *  undefined for a no-arg command. Its presence IS `takesArg`. */
  arg?: string;
  summary: string;
  run: (layout: TerminalLayout, args: string[]) => CommandResult;
}

/** True when the command needs an argument — derived from `arg`. Drives the
 *  Enter/accept rule: accepting an arg-taking command EXPANDS to the name + a
 *  space (ready for the arg) rather than running and erroring. */
export function takesArg(spec: CommandSpec): boolean {
  return spec.arg !== undefined;
}

function rangeCommand(layout: TerminalLayout, args: string[]): CommandResult {
  const raw = args[0];
  if (!raw) return { message: `usage: /range <${ALLOWED_RANGE_DAYS.join("|")}>` };
  const parsed = Number.parseInt(raw, 10);
  if (clampRangeDays(parsed) !== parsed) {
    return { message: `range must be one of ${ALLOWED_RANGE_DAYS.join(", ")} days` };
  }
  return { layout: setRangeDays(layout, parsed), message: `range set to ${parsed} days` };
}

/** `/view` with no argument TOGGLES, which is what a two-state preference wants;
 *  an explicit `/view list` still works and is what the palette offers. */
function viewCommand(layout: TerminalLayout, args: string[]): CommandResult {
  const raw = args[0];
  if (!raw) {
    const i = ALLOWED_VIEWS.indexOf(layout.view);
    const next = ALLOWED_VIEWS[(i + 1) % ALLOWED_VIEWS.length]!;
    return { layout: setView(layout, next), message: `showing the ${next} view` };
  }
  if (clampView(raw) !== raw) return { message: `view must be one of ${ALLOWED_VIEWS.join(", ")}` };
  return { layout: setView(layout, raw), message: `showing the ${raw} view` };
}

function quitCommand(): CommandResult {
  return { quit: true };
}

export const COMMAND_TABLE: CommandSpec[] = [
  { name: "range", arg: `<${ALLOWED_RANGE_DAYS.join("|")}>`, summary: "set the date range", run: rangeCommand },
  // No `arg`, deliberately: a two-state preference wants a toggle, and declaring
  // an arg makes Enter EXPAND to "/view " instead of running it. The palette
  // still offers both values once you type a space, and `/view list` still works.
  { name: "view", aliases: ["v"], summary: "cycle sentences, list, and all projects", run: viewCommand },
  { name: "help", aliases: ["?"], summary: "show this help", run: () => helpCommand() },
  { name: "quit", aliases: ["q", "exit"], summary: "leave the session", run: quitCommand },
];

const COMMAND_LOOKUP = new Map<string, CommandSpec>();
for (const spec of COMMAND_TABLE) {
  COMMAND_LOOKUP.set(spec.name, spec);
  for (const alias of spec.aliases ?? []) COMMAND_LOOKUP.set(alias, spec);
}

export function findCommand(name: string): CommandSpec | undefined {
  return COMMAND_LOOKUP.get(name);
}

/** Width of the longest command name so the `<arg>` placeholders
 *  line up in both the palette and `/help`, regardless of command-name length. */
const COMMAND_NAME_COL = Math.max(...COMMAND_TABLE.map((c) => c.name.length + 1));

/**
 * commandUsage — PURE. A command's display usage with the name padded to the
 * shared column so the arg placeholders align across rows: "/range <7|30|90>",
 * "/quit". ONE source for the palette and
 * `/help` so the two never drift.
 */
export function commandUsage(spec: CommandSpec): string {
  const head = `/${spec.name}`;
  return spec.arg ? `${head.padEnd(COMMAND_NAME_COL)} ${spec.arg}` : head;
}

/** `/help` output, generated from the table so it never drifts from the commands.
 *  Free-text (no leading slash) is the chat path. */
export function helpCommand(): CommandResult {
  const usageWidth = Math.max(...COMMAND_TABLE.map((c) => commandUsage(c).length)) + 2;
  const lines = [
    "commands:",
    ...COMMAND_TABLE.map((c) => `  ${commandUsage(c).padEnd(usageWidth)}${c.summary}`),
    "",
    "left/right change the window, up/down focus one project, escape clears the focus.",
    "Tab completes a command, and anything without a leading slash is a question (chat, coming soon).",
    "The dashboard link at the bottom of the board opens the charts, replay, and model.",
  ];
  return { lines };
}
