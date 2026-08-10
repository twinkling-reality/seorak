/**
 * codex-tailer.test.ts — the tailer's durability + activation contracts
 * (CODEX-TAILER.md ADR-T1/T2/T3/T7).
 *
 * Under test, end to end against a sandboxed rollout tree + collector dir:
 *   - the activation cutoff: history never floods, and a skipped file stays
 *     skipped even if it later grows (a resumed pre-activation thread);
 *   - incremental tailing: cursor advances only past durably-appended COMPLETE
 *     lines; a partial trailing line waits for its newline;
 *   - crash recovery: losing the per-file state re-tails with IDENTICAL event
 *     ids, so the worker's `event_id` PK collapses the re-emit to a no-op;
 *   - the per-tick row cap drains a backlog across ticks without loss;
 *   - subagent files and vanished files are handled without emission/garbage;
 *   - the state SHAPE VERSION: a v1 file round-trips, while absent or unknown
 *     versions fail closed and persist a current reset.
 *
 * fs-sandboxed: SEORAK_DIR (collector state + events.jsonl + salt) and
 * SEORAK_CODEX_DIR (the rollout root) both point at temp dirs.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "@seorak/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { codexRolloutEventId } from "../src/codex-event-id.ts";
import {
  CODEX_TAIL_STATE_VERSION,
  sweepCodexRollouts,
  type CodexTailState,
} from "../src/codex-tailer.ts";
import { codexTailStatePath, eventsLogPath } from "../src/paths.ts";

let sandbox: string;
let codexRoot: string;
const saved = {
  dir: process.env.SEORAK_DIR,
  codexDir: process.env.SEORAK_CODEX_DIR,
  momentum: process.env.SEORAK_MOMENTUM,
};

beforeAll(() => {
  process.env.SEORAK_MOMENTUM = "0";
});

afterAll(() => {
  for (const [key, env] of [
    ["dir", "SEORAK_DIR"],
    ["codexDir", "SEORAK_CODEX_DIR"],
    ["momentum", "SEORAK_MOMENTUM"],
  ] as const) {
    const v = saved[key];
    if (v === undefined) delete process.env[env];
    else process.env[env] = v;
  }
});

// A FRESH sandbox per test, not a shared one swept clean between tests. A sweep
// is async and this suite drives it directly, so a test that exceeds its timeout
// is ABANDONED while its sweep keeps appending. Against a shared events.jsonl
// those late writes land in whatever test runs next and fail it for a reason
// that is nowhere in its own body. Against a per-test directory they land in a
// path nobody reads again. paths.ts resolves SEORAK_DIR per call rather than
// caching it at import, which is what makes re-pointing it here work.
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-codextail-"));
  codexRoot = join(sandbox, "codex-sessions");
  process.env.SEORAK_DIR = sandbox;
  process.env.SEORAK_CODEX_DIR = codexRoot;
  mkdirSync(join(codexRoot, "2026", "07", "10"), { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const FILE = "rollout-2026-07-10T12-12-14-019f4ccd-0cea-7492-a137-e55d0be08fee.jsonl";
const SESSION = "019f4ccd-0cea-7492-a137-e55d0be08fee";
const AT = "2026-07-10T12:12:14.512Z";
/** An activation instant far in the past: every file the tests create (real
 *  mtime = now) reads as post-activation, i.e. live. */
const ACTIVATED_LONG_AGO = "2020-01-01T00:00:00.000Z";
/** ...and one far in the future: every file reads as historical. */
const ACTIVATED_FAR_FUTURE = "2099-01-01T00:00:00.000Z";

const rolloutPath = () => join(codexRoot, "2026", "07", "10", FILE);

const line = (type: string, payload: Record<string, unknown>): string =>
  JSON.stringify({ timestamp: AT, type, payload });
const metaLine = (extra: Record<string, unknown> = {}): string =>
  line("session_meta", { id: SESSION, cwd: "/tmp/seorak-tail-test-cwd", cli_version: "0.142.5", ...extra });
const execLine = (callId: string): string =>
  line("response_item", { type: "function_call", name: "exec_command", call_id: callId, arguments: "{}" });
/** The RESULT row. Codex always writes one (0 of 9,315 corpus calls lack it), and since
 *  ADR-C13 the tool.call is emitted HERE, anchored on the CALL row's offset. A fixture that
 *  wrote only the call row would be a file Codex never produces. */
const execResultLine = (callId: string, exitCode = 0): string =>
  line("response_item", {
    type: "function_call_output",
    call_id: callId,
    output: `Chunk ID: abc\nWall time: 0.1 seconds\nProcess exited with code ${exitCode}\nOriginal token count: 3\nOutput:\nok`,
  });
const promptLine = (): string => line("event_msg", { type: "user_message", message: "hi" });

function writeRollout(lines: string[], terminated = true): void {
  writeFileSync(rolloutPath(), lines.join("\n") + (terminated ? "\n" : ""), "utf8");
}

function loggedEvents(): SessionEvent[] {
  if (!existsSync(eventsLogPath())) return [];
  return readFileSync(eventsLogPath(), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SessionEvent);
}

function tailState(): CodexTailState {
  return JSON.parse(readFileSync(codexTailStatePath(), "utf8")) as CodexTailState;
}

// Pins the ISOLATION the beforeEach above provides, rather than trusting it. The
// pair runs in order: the first abandons a write the way a timed-out test does,
// the second asserts it never arrives. Point SEORAK_DIR back at one shared
// directory and the second test reads the first one's leak and fails.
describe("suite hygiene: an abandoned write cannot reach the next test", () => {
  let leaked: Promise<"written" | "refused">;

  it("abandons an append without awaiting it, as a timed-out test would", () => {
    const target = eventsLogPath();
    leaked = new Promise((resolve) => {
      setTimeout(() => {
        // Under isolation this THROWS, because afterEach has already removed the
        // directory the path points into. That refusal is the mechanism working,
        // so it resolves rather than rejects and the next test can assert on it.
        try {
          appendFileSync(target, JSON.stringify({ eventId: "leaked-from-previous-test" }) + "\n");
          resolve("written");
        } catch {
          resolve("refused");
        }
      }, 5);
    });
    expect(loggedEvents()).toHaveLength(0);
  });

  it("does not see the previous test's abandoned write", async () => {
    // Awaiting settles the race: the write has either landed or been refused
    // before this asserts, so a pass cannot mean "the timer had not fired yet".
    expect(await leaked).toBe("refused");
    expect(loggedEvents()).toHaveLength(0);
  });
});

describe("activation cutoff (ADR-T3): history never floods the live surfaces", () => {
  it("a pre-activation file is marked done unread — and stays skipped if it later grows", async () => {
    writeRollout([metaLine(), execLine("a")]);
    // Pretend the file was last written in 2026-07-01, before activation.
    const old = new Date("2026-07-01T00:00:00.000Z");
    utimesSync(rolloutPath(), old, old);

    expect(await sweepCodexRollouts(ACTIVATED_FAR_FUTURE)).toBe(0);
    expect(loggedEvents()).toEqual([]);
    const entry = tailState().files[rolloutPath()]!;
    expect(entry.skip).toBe(true);

    // The thread resumes months later (the file grows, mtime goes fresh):
    // still nothing — its identity row predates activation and was never read.
    // An undercount, deterministically, never a half-attributed capture.
    appendFileSync(rolloutPath(), execLine("b") + "\n", "utf8");
    expect(await sweepCodexRollouts("2099-01-02T00:00:00.000Z")).toBe(0);
    expect(loggedEvents()).toEqual([]);
  });

  it("activatedAt persists from the FIRST tick; later ticks never move it", async () => {
    writeRollout([metaLine()]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);
    expect(tailState().activatedAt).toBe(ACTIVATED_LONG_AGO);
    await sweepCodexRollouts("2026-07-11T00:00:00.000Z");
    expect(tailState().activatedAt).toBe(ACTIVATED_LONG_AGO);
  });

  it("the LIVE GRACE window: a session generating at daemon start is captured, not skipped", () => {
    // The canonical first run: the daemon activates while a Codex session is
    // mid-flight, so the file's mtime is minutes BEFORE the just-minted
    // activation. Within the 30-minute grace (the reaper's own idle window)
    // the file is one live session and tails from byte 0.
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
    writeRollout([metaLine(), execLine("a"), execResultLine("a")]);
    utimesSync(rolloutPath(), tenMinAgo, tenMinAgo);
    return sweepCodexRollouts(now.toISOString()).then((n) => {
      expect(n).toBe(2);
      expect(loggedEvents().map((e) => e.kind)).toEqual(["session.start", "tool.call"]);
    });
  });

  it("…while a file idle longer than the grace window at activation stays historical", async () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    writeRollout([metaLine(), execLine("a")]);
    utimesSync(rolloutPath(), twoHoursAgo, twoHoursAgo);
    expect(await sweepCodexRollouts(now.toISOString())).toBe(0);
    expect(tailState().files[rolloutPath()]!.skip).toBe(true);
  });

  it("a reset tick LOGS how many idle files it reclassified historical (X1)", async () => {
    // A missing/corrupt state file re-mints activatedAt, and every file idle
    // past the grace window silently becomes historical. The reclassification
    // stays (it is ADR-T3 working as designed); this pins the one log line
    // that makes the capture loss visible instead of silent.
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    writeRollout([metaLine(), execLine("a")]);
    utimesSync(rolloutPath(), twoHoursAgo, twoHoursAgo);
    writeFileSync(codexTailStatePath(), "{corrupt", "utf8"); // forces a reset tick

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await sweepCodexRollouts(now.toISOString())).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("state reset, 1 idle file(s) classified historical"),
      );

      // A NON-reset tick discovering another old file stays quiet: the line is
      // about the reset, not about routine post-activation classification.
      warn.mockClear();
      await sweepCodexRollouts(new Date(now.getTime() + 60_000).toISOString());
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("a corrupt-but-valid-JSON activatedAt fails CLOSED and is rewritten, never a flood", async () => {
    // An unparseable activation would make every mtime comparison false —
    // historical files reading as live is the exact first-activation flood
    // ADR-T3 exists to prevent. The state must re-mint AND persist this tick
    // (a corrupt file left in place would slide the cutoff forward each tick).
    writeRollout([metaLine(), execLine("a")]);
    const old = new Date("2026-07-01T00:00:00.000Z");
    utimesSync(rolloutPath(), old, old);
    writeFileSync(
      codexTailStatePath(),
      JSON.stringify({ activatedAt: "not-a-timestamp", files: {} }),
      "utf8",
    );
    expect(await sweepCodexRollouts(ACTIVATED_FAR_FUTURE)).toBe(0);
    expect(loggedEvents()).toEqual([]);
    expect(tailState().activatedAt).toBe(ACTIVATED_FAR_FUTURE); // rewritten, pinned
  });
});

describe("incremental tail (ADR-T1): complete lines only, cursor after durable append", () => {
  it("a live file tails from byte 0; a second sweep with no growth adds nothing", async () => {
    const lines = [metaLine(), execLine("a"), execResultLine("a"), promptLine()];
    writeRollout(lines);
    expect(await sweepCodexRollouts(ACTIVATED_LONG_AGO)).toBe(3);

    const events = loggedEvents();
    expect(events.map((e) => e.kind)).toEqual(["session.start", "tool.call", "session.prompt"]);
    // The cursor sits exactly past the last complete line.
    expect(tailState().files[rolloutPath()]!.offset).toBe(
      Buffer.byteLength(lines.join("\n") + "\n", "utf8"),
    );

    expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(0);
    expect(loggedEvents()).toHaveLength(3);
  });

  it("appended rows emit incrementally with ids anchored on their true byte offsets", async () => {
    const initial = [metaLine(), execLine("a"), execResultLine("a")];
    writeRollout(initial);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);

    // Where the next CALL row starts. Emission happens at its RESULT row (ADR-C13), but the
    // id must still anchor HERE — that is the invariant that keeps every id byte-identical
    // to the one the pre-Phase-3 adapter minted, so a re-tail collapses on the PK.
    const callOffset = Buffer.byteLength(initial.join("\n") + "\n", "utf8");
    appendFileSync(rolloutPath(), execLine("b") + "\n" + execResultLine("b", 1) + "\n", "utf8");
    expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(1);

    const last = loggedEvents().at(-1)! as SessionEvent & { errored?: boolean };
    expect(last.kind).toBe("tool.call");
    expect(last.eventId).toBe(codexRolloutEventId(SESSION, FILE, callOffset));
    expect(last.errored).toBe(true); // exit 1, read from the header
  });

  it("a partial trailing line is left unconsumed until its newline lands", async () => {
    const whole = execLine("a");
    writeRollout([metaLine()]); // terminated
    appendFileSync(rolloutPath(), whole.slice(0, 20), "utf8"); // torn mid-append

    expect(await sweepCodexRollouts(ACTIVATED_LONG_AGO)).toBe(1); // just the start
    const metaBytes = Buffer.byteLength(metaLine() + "\n", "utf8");
    expect(tailState().files[rolloutPath()]!.offset).toBe(metaBytes);

    // The torn line completes AND its result lands. The tool.call emits once, anchored on
    // the CALL row's true offset — proof the torn line was never half-parsed.
    appendFileSync(rolloutPath(), whole.slice(20) + "\n" + execResultLine("a") + "\n", "utf8");
    expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(1);
    expect(loggedEvents().at(-1)!.eventId).toBe(codexRolloutEventId(SESSION, FILE, metaBytes));
  });

  it("the per-tick row cap drains a backlog across ticks without loss", async () => {
    const prompts = Array.from({ length: 502 }, () => promptLine());
    writeRollout([metaLine(), ...prompts]); // 503 lines > the 500-row default cap
    expect(await sweepCodexRollouts(ACTIVATED_LONG_AGO)).toBe(500);
    expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(3);
    expect(await sweepCodexRollouts("2026-07-10T14:00:00.000Z")).toBe(0);
    expect(loggedEvents()).toHaveLength(503);
    // No id was minted twice across the three ticks.
    expect(new Set(loggedEvents().map((e) => e.eventId)).size).toBe(503);
    // 503 rows over three sweeps is the point of this test, and it is the only
    // one here heavy enough to pass 5s when the machine is also running another
    // package's suite. The 30s override this used to carry was headroom over
    // that 5s default, which vitest.config.ts now sets once for the whole suite;
    // the intent it recorded is unchanged, only its home. Re-measured on
    // 2026-08-05: 4.0s alone and 8.8s inside the full suite at load 68, not the
    // 1.5s idle originally noted, so a regression that made the sweep genuinely
    // slow still has to clear the suite's 60s to hide here.
  });
});

describe("crash recovery (ADR-T2): a re-tail is a PK no-op, never a double count", () => {
  it("a session.start whose append FAILS is retried next tick with the SAME id (never lost)", async () => {
    // The lost-start window (review finding): the adapter records the file's
    // identity in state, the append then fails, the state persists. The start
    // stays OWED (startEmitted false) until durably appended, so the re-read
    // meta re-emits it — anchored on the persisted offset, same id.
    writeRollout([metaLine(), execLine("a"), execResultLine("a")]);
    mkdirSync(eventsLogPath()); // appendFile onto a DIRECTORY → EISDIR, a disk failure
    try {
      expect(await sweepCodexRollouts(ACTIVATED_LONG_AGO)).toBe(0);
      const entry = tailState().files[rolloutPath()]!;
      expect(entry.sessionId).toBe(SESSION);
      expect(entry.startEmitted).toBe(false); // still owed
      expect(entry.offset).toBe(0); // cursor never advanced past the failed row
    } finally {
      rmSync(eventsLogPath(), { recursive: true, force: true });
    }

    expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(2);
    const events = loggedEvents();
    expect(events.map((e) => e.kind)).toEqual(["session.start", "tool.call"]);
    expect(events[0]!.eventId).toBe(codexRolloutEventId(SESSION, FILE, 0));
    expect(tailState().files[rolloutPath()]!.startEmitted).toBe(true);
  });

  it("losing the per-file state re-emits the SAME event ids (INSERT OR IGNORE absorbs)", async () => {
    // This also exercises the pendingCalls round-trip: wiping the state re-reads the file
    // from byte 0, so the call row is re-held and its result re-releases it, re-deriving the
    // SAME id from the same byte coordinate.
    writeRollout([metaLine(), execLine("a"), execResultLine("a"), promptLine()]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);
    const firstIds = loggedEvents().map((e) => e.eventId);
    expect(firstIds).toHaveLength(3);

    // Simulate losing every per-file cursor (keep activation, else the file
    // would read as historical and prove nothing).
    writeFileSync(
      codexTailStatePath(),
      JSON.stringify({ activatedAt: ACTIVATED_LONG_AGO, files: {} }),
      "utf8",
    );
    expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(3);

    // The local log now holds duplicates — but every re-emitted id is
    // IDENTICAL, so the worker's event_id PK collapses them. Model it as a Set.
    const all = loggedEvents().map((e) => e.eventId);
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(3);
    expect(all.slice(3)).toEqual(firstIds);
  });
});

describe("skips and hygiene", () => {
  it("a subagent thread file emits nothing and persists its skip (ADR-T7)", async () => {
    writeRollout([
      metaLine({ thread_source: "subagent", parent_thread_id: "019f-parent" }),
      execLine("a"),
    ]);
    expect(await sweepCodexRollouts(ACTIVATED_LONG_AGO)).toBe(0);
    expect(loggedEvents()).toEqual([]);
    expect(tailState().files[rolloutPath()]!.skip).toBe(true);
  });

  it("a shrunk rollout holds its cursor, emits nothing, and logs the transition ONCE (X3)", async () => {
    // Truncated/rewritten in place: re-reading different bytes at the same
    // coordinates would mint wrong-content event ids that the worker's
    // event_id PK pins forever, so the cursor must NOT auto-reset to 0.
    // The first full sweep also clears any leftover shrink-log memory for this
    // path (the map is module-level), so the assertions below start from zero.
    writeRollout([metaLine(), execLine("a"), execResultLine("a")]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);
    const cursor = tailState().files[rolloutPath()]!.offset;
    const before = loggedEvents().length;

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const shrinkLogs = () =>
      error.mock.calls.filter((c) => String(c[0]).includes("shrank below its cursor")).length;
    try {
      // First shrink: the transition logs once.
      writeRollout([metaLine()]); // rewritten in place, now smaller than the cursor
      expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(0);
      expect(shrinkLogs()).toBe(1);

      // A second sweep at the SAME shrunken size stays silent — the cursor never
      // moves, so without the dedupe this line would fire every tick forever.
      expect(await sweepCodexRollouts("2026-07-10T13:00:30.000Z")).toBe(0);
      expect(shrinkLogs()).toBe(1);

      // A FURTHER size change (still below the cursor) is a new transition: re-log.
      writeRollout([metaLine(), execLine("z")]); // different size, still < cursor
      expect(await sweepCodexRollouts("2026-07-10T13:01:00.000Z")).toBe(0);
      expect(shrinkLogs()).toBe(2);
    } finally {
      error.mockRestore();
    }
    expect(loggedEvents()).toHaveLength(before); // nothing re-emitted across the shrinks
    expect(tailState().files[rolloutPath()]!.offset).toBe(cursor); // cursor put
  });

  it("a vanished file's state entry is pruned", async () => {
    writeRollout([metaLine()]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);
    expect(tailState().files[rolloutPath()]).toBeDefined();

    rmSync(rolloutPath());
    await sweepCodexRollouts("2026-07-10T13:00:00.000Z");
    expect(tailState().files[rolloutPath()]).toBeUndefined();
  });

  it("a FAILED listing prunes nothing: one bad tick must not wipe every cursor", async () => {
    // readdir can fail transiently (permission blip, unmount). That says
    // nothing about the files — pruning on it would force a full re-tail of
    // every live file (review finding). Cursors survive; a later successful
    // listing prunes legitimately.
    writeRollout([metaLine()]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);
    expect(tailState().files[rolloutPath()]).toBeDefined();

    rmSync(codexRoot, { recursive: true, force: true }); // listing now errors
    await sweepCodexRollouts("2026-07-10T13:00:00.000Z");
    expect(tailState().files[rolloutPath()]).toBeDefined(); // retained

    mkdirSync(join(codexRoot, "2026", "07", "10"), { recursive: true }); // root back, file gone
    await sweepCodexRollouts("2026-07-10T14:00:00.000Z");
    expect(tailState().files[rolloutPath()]).toBeUndefined(); // pruned for real
  });

  it("a missing Codex root is a silent no-op (Codex not installed)", async () => {
    rmSync(codexRoot, { recursive: true, force: true });
    expect(await sweepCodexRollouts(ACTIVATED_LONG_AGO)).toBe(0);
    expect(loggedEvents()).toEqual([]);
  });

  it("a corrupt state file degrades to a fresh activation, never a throw or a flood", async () => {
    writeRollout([metaLine()]);
    const old = new Date("2026-07-01T00:00:00.000Z");
    utimesSync(rolloutPath(), old, old);
    writeFileSync(codexTailStatePath(), "{corrupt", "utf8");
    // Fresh activation "now" (2099) → the 2026 file is history → nothing.
    expect(await sweepCodexRollouts(ACTIVATED_FAR_FUTURE)).toBe(0);
    expect(loggedEvents()).toEqual([]);
  });
});

/**
 * The state shape version. Only the current envelope is interpreted; retired,
 * absent, or future versions reset fail-closed rather than guessing at cursor
 * meaning.
 */
describe("state versioning: only v1 is accepted", () => {
  const bytes = (lines: string[]) => Buffer.byteLength(lines.join("\n") + "\n", "utf8");

  /** A fully populated per-file entry: cursor, identity, the token walk, and a call held
   *  across the tick boundary. Every field the importer must carry, in one object. */
  const richEntry = (offset: number) => ({
    offset,
    sessionId: SESSION,
    startOffset: 0,
    startEmitted: true,
    skip: false,
    activeModel: "gpt-5.5",
    prevTokens: { input: 1200, cachedInput: 900, output: 340, total: 1540 },
    tokensByModel: {
      "gpt-5.5": { inputTokens: 300, outputTokens: 340, cacheReadTokens: 900 },
      "gpt-5.4-mini": { inputTokens: 12, outputTokens: 7, cacheReadTokens: 0 },
    },
    pendingCalls: { z: { offset: 41, at: AT, toolName: "Shell" } },
  });

  const writeStateFile = (body: Record<string, unknown>): void =>
    writeFileSync(codexTailStatePath(), JSON.stringify(body), "utf8");

  it("pins the current state version", () => {
    expect(CODEX_TAIL_STATE_VERSION).toBe(1);
  });

  it("a v1 state round-trips a tick with every field preserved and the version rewritten", async () => {
    const head = [metaLine(), execLine("z")];
    writeRollout(head);
    const entry = richEntry(bytes(head));
    writeStateFile({
      version: 1,
      activatedAt: ACTIVATED_LONG_AGO,
      files: { [rolloutPath()]: entry },
    });

    // One new complete row, so the tick genuinely advances and rewrites the state.
    appendFileSync(rolloutPath(), promptLine() + "\n", "utf8");
    expect(await sweepCodexRollouts("2026-07-10T13:00:00.000Z")).toBe(1);
    expect(loggedEvents().map((e) => e.kind)).toEqual(["session.prompt"]);

    const after = tailState();
    expect(after.version).toBe(1);
    expect(after.activatedAt).toBe(ACTIVATED_LONG_AGO);
    expect(after.files[rolloutPath()]).toEqual({
      ...entry,
      offset: bytes([...head, promptLine()]), // the only field the tick may move
    });
  });

  it("an UNVERSIONED state fails closed, names the missing version, and persists the reset", async () => {
    const head = [metaLine(), execLine("z")];
    writeRollout(head);
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    utimesSync(rolloutPath(), twoHoursAgo, twoHoursAgo);
    writeStateFile({
      activatedAt: ACTIVATED_LONG_AGO,
      files: { [rolloutPath()]: richEntry(bytes(head)) },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await sweepCodexRollouts(now.toISOString())).toBe(0);
      expect(loggedEvents()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "state reset (unrecognized state version missing), 1 idle file(s) classified historical",
        ),
      );
    } finally {
      warn.mockRestore();
    }
    const after = tailState();
    expect(after.version).toBe(1);
    expect(after.activatedAt).toBe(now.toISOString());
    expect(after.files[rolloutPath()]!.skip).toBe(true);
  });

  it("an UNRECOGNIZED version fails closed, names the version, and persists the reset", async () => {
    // A file written by software this build does not understand. Reading it would be a
    // guess about field MEANING, and a wrong guess about `offset` either re-emits at wrong
    // coordinates or skips unread bytes. So: reset, and say which version was refused.
    const head = [metaLine(), execLine("a")];
    writeRollout(head);
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    utimesSync(rolloutPath(), twoHoursAgo, twoHoursAgo);
    writeStateFile({
      version: 2,
      activatedAt: ACTIVATED_LONG_AGO,
      files: { [rolloutPath()]: richEntry(0) },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await sweepCodexRollouts(now.toISOString())).toBe(0);
      expect(loggedEvents()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "state reset (unrecognized state version 2), 1 idle file(s) classified historical",
        ),
      );
    } finally {
      warn.mockRestore();
    }

    // Persisted THIS tick at the version this build writes: leaving the unreadable file in
    // place would re-mint a later activation on every tick, sliding the cutoff forward.
    const after = tailState();
    expect(after.version).toBe(1);
    expect(after.activatedAt).toBe(now.toISOString());
    expect(after.files[rolloutPath()]!.skip).toBe(true);
  });

  it("corrupt JSON still resets fail-closed and persists at the current version", async () => {
    writeRollout([metaLine(), execLine("a")]);
    const old = new Date("2026-07-01T00:00:00.000Z");
    utimesSync(rolloutPath(), old, old);
    writeFileSync(codexTailStatePath(), "{corrupt", "utf8");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await sweepCodexRollouts(ACTIVATED_FAR_FUTURE)).toBe(0);
      // The generic reset line, NOT the unrecognized-version one: corruption is corruption.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("state reset, 1 idle file(s) classified historical"),
      );
    } finally {
      warn.mockRestore();
    }
    const after = tailState();
    expect(after.version).toBe(1);
    expect(after.activatedAt).toBe(ACTIVATED_FAR_FUTURE);
  });

  it("the rewrite is atomic: a successful tick leaves no .tmp behind", async () => {
    // tmp + rename is what makes a crash mid-write leave the PREVIOUS valid state rather
    // than a truncated one. A surviving .tmp would mean the rename leg never ran.
    writeStateFile({ version: 1, activatedAt: ACTIVATED_LONG_AGO, files: {} });
    writeRollout([metaLine(), execLine("a"), execResultLine("a")]);
    await sweepCodexRollouts("2026-07-10T13:00:00.000Z");
    expect(readdirSync(sandbox).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    // ...and the file left behind is complete JSON carrying the whole envelope.
    const after = tailState();
    expect(after.version).toBe(1);
    expect(after.activatedAt).toBe(ACTIVATED_LONG_AGO);
  });
});

/**
 * The tailer's quota path (CODEX-CAPTURE ADR-C15).
 *
 * The adapter tests prove the READING is correct. These prove it actually gets EMITTED —
 * a distinction that matters, because the tailer holds the quota in its own `pendingQuota`
 * slot and appends it separately. If that slot were wrong, no quota would ever reach the
 * worker and every adapter test would still pass.
 */
describe("agent.quota emission (ADR-C15): coalesced, and never gated on token movement", () => {
  const turnLine = (): string =>
    JSON.stringify({ timestamp: AT, type: "turn_context", payload: { model: "gpt-5.5" } });

  /** A real token_count row: cumulative totals plus the provider's rate_limits block. */
  const tokenLine = (
    pct: number,
    totals: { input: number; cached: number; output: number },
  ): string =>
    line("event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: totals.input,
          cached_input_tokens: totals.cached,
          output_tokens: totals.output,
          reasoning_output_tokens: 0,
          total_tokens: totals.input + totals.output,
        },
      },
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: pct, window_minutes: 10080, resets_at: 1784489092 },
        secondary: null,
        plan_type: "plus",
      },
    });

  it("coalesces many readings in one tick down to ONE event carrying the NEWEST", async () => {
    // The quota is last-write-wins, so every reading but the last is already superseded.
    // Emitting all of them would put a row in D1 for each `token_count` row Codex writes
    // (8,704 in the local corpus) where exactly one is ever read.
    writeRollout([
      metaLine(),
      turnLine(),
      tokenLine(1, { input: 100, cached: 0, output: 10 }),
      tokenLine(2, { input: 200, cached: 0, output: 20 }),
      tokenLine(3, { input: 300, cached: 0, output: 30 }),
    ]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);

    const quotas = loggedEvents().filter((e) => e.kind === "agent.quota");
    expect(quotas).toHaveLength(1);
    expect((quotas[0] as { windows: { usedPercent: number }[] }).windows[0]!.usedPercent).toBe(3);
  });

  it("EMITS THE QUOTA on a tick whose rows moved no tokens at all", async () => {
    // THE 26% CASE, end to end through the real tailer. Codex re-emits `token_count` with
    // unchanged cumulative totals; `session.tokens` correctly declines to snapshot those
    // rows, and the ACCOUNT quota on them is fresh regardless. If the quota rode the token
    // carrier, this whole tick would be silent.
    const same = { input: 100, cached: 0, output: 10 };
    writeRollout([metaLine(), turnLine(), tokenLine(1, same)]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);

    // Second tick: identical totals (no movement), a FRESH percentage.
    writeFileSync(
      rolloutPath(),
      [metaLine(), turnLine(), tokenLine(1, same), tokenLine(9, same)].join("\n") + "\n",
      "utf8",
    );
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);

    const events = loggedEvents();
    const quotas = events.filter((e) => e.kind === "agent.quota");
    // Two ticks, two quota readings, and the second is the fresh one...
    expect(quotas).toHaveLength(2);
    expect((quotas[1] as { windows: { usedPercent: number }[] }).windows[0]!.usedPercent).toBe(9);
    // ...while the second tick correctly snapshotted NO new tokens (nothing was spent).
    expect(events.filter((e) => e.kind === "session.tokens")).toHaveLength(1);
  });

  it("gives the quota and the token snapshot DIFFERENT ids from the same row", async () => {
    // Both are derived from one `token_count` row at one byte offset. A shared id would let
    // the worker's `INSERT OR IGNORE` drop whichever landed second, silently.
    writeRollout([metaLine(), turnLine(), tokenLine(4, { input: 100, cached: 0, output: 10 })]);
    await sweepCodexRollouts(ACTIVATED_LONG_AGO);

    const events = loggedEvents();
    const quota = events.find((e) => e.kind === "agent.quota");
    const tokens = events.find((e) => e.kind === "session.tokens");
    expect(quota).toBeDefined();
    expect(tokens).toBeDefined();
    expect(quota!.eventId).not.toBe(tokens!.eventId);
  });
});
