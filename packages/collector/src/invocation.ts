/**
 * invocation.ts — how THIS user runs Seorak, in one place.
 *
 * Every remedy the product prints ("run `… setup`", "run `… status`") has to
 * name a command the reader can actually type. A global install puts `seorak`
 * on PATH; an npx on-ramp never does, and it installs nothing on PATH either,
 * so a checklist that says `seorak status` to an npx user is a dead end at
 * exactly the moment they need it most.
 *
 * The published package name lives here alone, so renaming it is one edit
 * rather than a sweep through every message in the CLI, the status checklist,
 * the daemon, and the terminal.
 */
import { collectorDir } from "./paths.ts";
import {
  collectorExecutableDirectory,
  collectorPackageRoot,
} from "./package-layout.ts";
import { collectorRuntimeOrigin } from "./runtime-install.ts";
import { COLLECTOR_PACKAGE } from "./package-name.ts";
import { sep } from "node:path";

export { COLLECTOR_PACKAGE };

/** What an npx user types. */
export const NPX_INVOCATION = `npx ${COLLECTOR_PACKAGE}`;

/** What a global or linked install puts on PATH. */
export const BINARY_INVOCATION = "seorak";

export interface InvocationInput {
  packageRoot?: string;
  binDir?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * PURE given its inputs. `seorak` when the reader has it on PATH — a checkout
 * they linked, or a global install. `npx …` when they reached us through npm's
 * cache, and when we are running out of the runtime an npx setup staged: that
 * user never installed anything on PATH, so npx is still their only door.
 */
export function collectorInvocation(input: InvocationInput = {}): string {
  const packageRoot = input.packageRoot ?? collectorPackageRoot();
  const binDir = input.binDir ?? collectorExecutableDirectory();
  const env = input.env ?? process.env;
  const origin = collectorRuntimeOrigin(packageRoot, binDir, env);
  if (origin === "ephemeral") return NPX_INVOCATION;
  const stateDir = input.stateDir ?? collectorDir();
  const staged = `${stateDir}${sep}runtime${sep}`;
  return packageRoot.startsWith(staged) ? NPX_INVOCATION : BINARY_INVOCATION;
}

let resolved: string | undefined;

/**
 * The answer for THIS process, computed once.
 *
 * Resolving it walks the tree reading `package.json` files, and the terminal
 * asks for it inside `identityBlock`, which the session re-renders every
 * animation frame. None of the inputs can change while the process lives, so
 * the walk belongs on the first call and nowhere after it. Callers that pass
 * explicit inputs — the tests, and setup naming the runtime it just staged —
 * go through `collectorInvocation` and are never cached.
 */
export function currentCollectorInvocation(): string {
  resolved ??= collectorInvocation();
  return resolved;
}
