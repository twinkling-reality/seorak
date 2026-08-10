/**
 * terminal-range-race.test.ts — a /overview response for range A must never be
 * applied to a session whose current range is B.
 *
 * ←/→ is one keystroke and the windowed aggregate takes ~2s to build, so two
 * range changes in a row leave two fetches in flight, and the SLOWER FIRST one
 * can land last. Before the generation token it then wrote its window's snapshot,
 * etag, and reachability verdict over the newer window's: `overviewForWindow`
 * held the mismatched aggregate back, so the paragraph blanked out until the next
 * 15s poll, and a stale failure could paint a connection banner over a board that
 * had just answered.
 *
 * The read client is mocked so each request is resolved BY HAND in whatever order
 * the test wants; nothing here touches the network. SEORAK_DIR points at a temp
 * dir so the persisted layout is the sandbox's, never the user's.
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverviewFetchResult } from "../src/terminal/fetch.ts";
import { getDemoBoard } from "../src/terminal/demo/fixtures.ts";
import {
  runInteractive,
  type TerminalInput,
  type TerminalOutput,
  type TerminalRuntime,
} from "../src/terminal/shell.ts";

const pending = vi.hoisted(() => ({
  calls: [] as Array<{ days: number; settle: (result: unknown) => void }>,
}));

vi.mock("../src/terminal/fetch.ts", () => ({
  // The live head is not part of this race: it answers null so the board's
  // reachability comes from /overview alone.
  fetchLive: async () => null,
  fetchOverview: async () => null,
  fetchBoard: async () => ({
    data: { live: [], generatedAt: null, overview: null },
    reachable: false,
  }),
  fetchOverviewConditional: (_base: string, days: number) =>
    new Promise((resolve) => {
      pending.calls.push({ days, settle: resolve });
    }),
}));

class FakeInput extends EventEmitter implements TerminalInput {
  isTTY = true;
  setRawMode(): void {}
  pause(): this {
    return this;
  }
  resume(): this {
    return this;
  }
}

class FakeOutput extends EventEmitter implements TerminalOutput {
  columns = 88;
  writes: string[] = [];
  write(value: string): boolean {
    this.writes.push(value);
    return true;
  }
}

/** A real snapshot for `days`, tagged with a one-token session count so the
 *  painted frame says WHICH window's numbers it is showing. */
function snapshotFor(days: number, sessions: number): OverviewFetchResult {
  const overview = getDemoBoard("no-live-sessions", Date.now(), days).overview!;
  overview.usage.totals = { ...overview.usage.totals, sessions };
  return { status: "ok", overview, etag: `etag-${days}`, cacheStatus: "fresh" };
}

const FAILED: OverviewFetchResult = {
  status: "failed",
  overview: null,
  etag: null,
  cacheStatus: "unknown",
};

/** Let every already-settled promise run its continuations. */
const settleAll = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let dir: string;
let previousDir: string | undefined;

beforeEach(() => {
  pending.calls.length = 0;
  previousDir = process.env.SEORAK_DIR;
  dir = mkdtempSync(join(tmpdir(), "seorak-range-race-"));
  process.env.SEORAK_DIR = dir;
});

afterEach(() => {
  if (previousDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = previousDir;
  rmSync(dir, { recursive: true, force: true });
});

interface Session {
  input: FakeInput;
  output: FakeOutput;
  completion: Promise<number>;
  frame: () => string;
}

/** Start a session, answer its first /overview poll for the default 7-day
 *  window, and dismiss the entry card so the board itself is what paints. */
async function startSession(): Promise<Session> {
  const input = new FakeInput();
  const output = new FakeOutput();
  const runtime: TerminalRuntime = { input, output, enableKeypressEvents: () => {} };
  const completion = runInteractive({ workerUrl: "http://unused.test", color: false }, runtime);

  expect(pending.calls.map((c) => c.days)).toEqual([7]);
  pending.calls[0]!.settle(snapshotFor(7, 7));
  await settleAll();
  // Any key clears the entry card; the board is polling behind it already.
  input.emit("keypress", undefined, { name: "escape" });
  await settleAll();

  return { input, output, completion, frame: () => output.writes.at(-1) ?? "" };
}

describe("overlapping range changes", () => {
  it("paints the LATEST requested window when the slower first response lands last", async () => {
    const { input, output, completion, frame } = await startSession();

    input.emit("keypress", undefined, { name: "right" }); // 7 → 30
    input.emit("keypress", undefined, { name: "right" }); // 30 → 90
    expect(pending.calls.map((c) => c.days)).toEqual([7, 30, 90]);

    // The 90-day answer arrives first...
    pending.calls[2]!.settle(snapshotFor(90, 777));
    await settleAll();
    expect(frame()).toContain("777");
    const paintsAfterLatest = output.writes.length;

    // ...and the superseded 30-day request answers afterwards.
    pending.calls[1]!.settle(snapshotFor(30, 111));
    await settleAll();

    expect(frame()).toContain("777");
    expect(frame()).not.toContain("111");
    // Discarded on arrival: a superseded response repaints nothing.
    expect(output.writes.length).toBe(paintsAfterLatest);

    input.emit("keypress", undefined, { name: "c", ctrl: true });
    await expect(completion).resolves.toBe(0);
  });

  it("does not paint a superseded failure as a connection failure", async () => {
    const { input, output, completion, frame } = await startSession();

    input.emit("keypress", undefined, { name: "right" }); // 7 → 30
    input.emit("keypress", undefined, { name: "right" }); // 30 → 90
    pending.calls[2]!.settle(snapshotFor(90, 777));
    await settleAll();
    const paintsAfterLatest = output.writes.length;

    // The abandoned 30-day request fails (an abort, a timeout, a 401). It is not
    // evidence about the window on screen, so it must not degrade it.
    pending.calls[1]!.settle(FAILED);
    await settleAll();

    expect(frame()).toContain("777");
    expect(frame()).not.toContain("did not come back");
    expect(output.writes.length).toBe(paintsAfterLatest);

    input.emit("keypress", undefined, { name: "c", ctrl: true });
    await expect(completion).resolves.toBe(0);
  });

  it("still degrades a CURRENT window's failed read to the honest banner", async () => {
    const { input, completion, frame } = await startSession();

    input.emit("keypress", undefined, { name: "right" }); // 7 → 30
    pending.calls[1]!.settle(FAILED);
    await settleAll();

    // Nothing was superseded here, so the failure is real and the surface says so
    // rather than showing the previous window's numbers as this one's.
    expect(frame()).toContain("did not come back");

    input.emit("keypress", undefined, { name: "c", ctrl: true });
    await expect(completion).resolves.toBe(0);
  });
});
