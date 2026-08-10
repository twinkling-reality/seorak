/**
 * parser.ts — PURE: a raw input line → a structured intent. Slash-prefixed lines
 * are commands (`/range 30`); everything else is free-text chat (grounded
 * stat/session questions, v1-stubbed). Blank lines are `empty` (the shell
 * ignores them). The router decides what each intent DOES; the parser only
 * classifies, so it is trivially unit-tested.
 */
export type ParsedInput =
  | { kind: "command"; name: string; args: string[] }
  | { kind: "chat"; text: string }
  | { kind: "empty" };

export function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/).filter((p) => p.length > 0);
    const name = (parts.shift() ?? "").toLowerCase();
    return { kind: "command", name, args: parts };
  }
  return { kind: "chat", text: trimmed };
}
