/**
 * hook-capture.ts: whether an agent invocation may be recorded as a developer
 * session at all.
 *
 * Seorak's hooks are installed once, globally, in `~/.claude/settings.json`, so
 * they fire for EVERY `claude` process on the machine, including the ones some
 * other program spawns for itself. A tool that shells out to `claude -p` for its
 * own enrichment work produces perfectly real agent invocations that are nobody's
 * development session, and they land in the counts as though they were: measured
 * on one machine, 1,038 of the 1,202 counted sessions in a 7-day window came
 * from a single such daemon.
 *
 * There is no honest way to tell them apart from the hook payload:
 *
 *   - `SessionStart` carries only sessionId, cwd, transcriptPath, and a source
 *     of "startup" or "resume", and a programmatic invocation reports "startup"
 *     exactly as an interactive one does;
 *   - `CLAUDE_CODE_ENTRYPOINT` is present in the hook environment but is
 *     INHERITED from the ancestor process, so it describes what launched the
 *     ancestor, not what this invocation is (measured: the same programmatic
 *     caller reported "claude-desktop" 1,140 times and "sdk-cli" 195 times, and
 *     "claude-desktop" is also what a real interactive session reports);
 *   - the transcript file would say, but it is prompt text and code, which this
 *     collector does not read.
 *
 * So the spawning program is the one that gets to say. Set `SEORAK_CAPTURE=0` in
 * the environment of the agent it spawns, and every Seorak hook that process
 * fires exits 0 having recorded nothing. Off is spelled `0`, the same spelling
 * `SEORAK_CODEX` and `SEORAK_MOMENTUM` use; any other set value, and no value at
 * all, capture normally.
 *
 * Scope: the six installed Claude Code hook entries, which is exactly what a
 * spawned child's environment can reach. The daemon's own capture families keep
 * their own switches (`SEORAK_CODEX`, `SEORAK_MOMENTUM`), because the daemon
 * inherits nothing from a process it never launched.
 */

import { LAUNCHER_LABEL_PATTERN } from "./local-store.ts";

/**
 * Whether the hooks may capture this invocation: on unless `SEORAK_CAPTURE=0`.
 *
 * Read fresh at every hook invocation, so a program sets it per-child rather
 * than per-machine and no restart is involved. Parameterless to match
 * `codexTailEnabled()`, the sibling kill switch `seorak status` reports.
 */
export function hookCaptureEnabled(): boolean {
  return process.env.SEORAK_CAPTURE !== "0";
}

/**
 * The launcher label a spawning program declared for this invocation, or undefined.
 *
 * `SEORAK_CAPTURE=0` is the answer for a program whose agents are not development
 * work at all. `SEORAK_LAUNCHER=<label>` is the answer for a program whose agents
 * ARE development work, launched on the developer's behalf by something other than
 * a terminal: the session is recorded exactly as any other, and also carries the
 * label, so the owner can attribute or filter it instead of losing it (ADR 007).
 * Same channel and the same reasoning as above: the hook payload cannot tell, so
 * the program that spawned the process is the one that says.
 *
 * The value is lowercased and must then match `LAUNCHER_LABEL_PATTERN`
 * (a letter or digit, then up to 63 of `a-z 0-9 . _ -`). Anything else, including
 * an empty value, records no label rather than a mangled one: an unlabeled
 * session is honest-unknown, a rewritten label would be an invented one. It is a
 * label, never content, so there is nothing to redact.
 */
export function hookLauncherLabel(): string | undefined {
  const raw = process.env.SEORAK_LAUNCHER;
  if (raw === undefined) return undefined;
  const label = raw.toLowerCase();
  return LAUNCHER_LABEL_PATTERN.test(label) ? label : undefined;
}
