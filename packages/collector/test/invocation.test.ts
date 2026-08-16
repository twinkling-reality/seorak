/**
 * invocation.test.ts — every remedy the product prints has to name a command the
 * reader can type. An npx on-ramp installs nothing on PATH and never will, so
 * "run `seorak status`" is a dead end for the install most likely to need it.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BINARY_INVOCATION,
  NPX_INVOCATION,
  collectorInvocation,
} from "../src/invocation.ts";

const STATE = "/home/u/.seorak";

describe("collectorInvocation", () => {
  it("uses the binary for a source checkout", () => {
    const root = "/Users/dev/seorak/packages/collector";
    expect(
      collectorInvocation({
        packageRoot: root,
        binDir: join(root, "bin"),
        stateDir: STATE,
        env: {},
      }),
    ).toBe(BINARY_INVOCATION);
  });

  it("uses the binary for a global install, which is on PATH", () => {
    const root = "/usr/local/lib/node_modules/seorak";
    expect(
      collectorInvocation({
        packageRoot: root,
        binDir: join(root, "dist"),
        stateDir: STATE,
        env: {},
      }),
    ).toBe(BINARY_INVOCATION);
  });

  it("uses npx when running out of npm's cache", () => {
    const root = "/home/u/.npm/_npx/9f2/node_modules/seorak";
    expect(
      collectorInvocation({
        packageRoot: root,
        binDir: join(root, "dist"),
        stateDir: STATE,
        env: {},
      }),
    ).toBe(NPX_INVOCATION);
  });

  // The staged runtime is durable, but the user who created it still installed
  // nothing on PATH — npx remains their only door. The daemon and the hooks run
  // from here, so this is the branch that decides what THEY print.
  it("uses npx from the runtime an npx setup staged", () => {
    const root = `${STATE}/runtime/0.1.2/node_modules/seorak`;
    expect(
      collectorInvocation({
        packageRoot: root,
        binDir: join(root, "dist"),
        stateDir: STATE,
        env: {},
      }),
    ).toBe(NPX_INVOCATION);
  });

  it("does not mistake a sibling of the state dir for the staged runtime", () => {
    const root = "/home/u/.seorak-other/runtime/0.1.2/node_modules/seorak";
    expect(
      collectorInvocation({
        packageRoot: root,
        binDir: join(root, "dist"),
        stateDir: STATE,
        env: {},
      }),
    ).toBe(BINARY_INVOCATION);
  });
});
