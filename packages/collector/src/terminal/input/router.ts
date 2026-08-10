/**
 * router.ts — PURE: a ParsedInput + the current layout → a CommandResult. Slash
 * commands dispatch through COMMAND_TABLE; free text goes to the chat handler.
 *
 * Chat is a v1 STUB by design (the doc moves chat in-scope for the terminal, but
 * the LLM backend is explicitly out of v1 scope). It is isolated in `chat()` so
 * wiring a real grounded-query backend later is a one-function change — the
 * router, parser, and shell already carry free text end-to-end.
 */
import { findCommand, type CommandResult } from "./commands.ts";
import type { ParsedInput } from "./parser.ts";
import type { TerminalLayout } from "../types.ts";

/** v1 chat stub: echo the parsed question so the input path is provably wired,
 *  without fabricating an answer. Swap this body for the real grounded handler. */
export function chat(text: string): CommandResult {
  return { message: `chat is coming soon. You asked: "${text}"` };
}

export function routeInput(input: ParsedInput, layout: TerminalLayout): CommandResult {
  switch (input.kind) {
    case "empty":
      return {};
    case "chat":
      return chat(input.text);
    case "command": {
      const spec = findCommand(input.name);
      if (!spec) return { message: `unknown command: /${input.name} (try /help)` };
      return spec.run(layout, input.args);
    }
  }
}
