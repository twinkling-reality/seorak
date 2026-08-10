/**
 * emit/guard.ts — the tripwire's failure mode and its two shape predicates.
 *
 * Every refusal in the emit layer throws EmitAllowlistError, and nothing else. That
 * one type is what append.ts and the codex tailer branch on to tell "this event
 * would have leaked, drop it and be loud" from "the disk failed, retry" — so it
 * lives below both the registry and the validators, and no other error type may
 * escape a validator.
 */
export class EmitAllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmitAllowlistError";
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
