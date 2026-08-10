import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readCaptureFailure,
  recordCaptureFailure,
} from "../src/capture-failure.ts";
import { resolveEventLogPathContext } from "../src/paths.ts";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "seorak-capture-failure-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("content-free capture failure marker", () => {
  it("stays absent until a hook append actually times out", () => {
    expect(
      readCaptureFailure(resolveEventLogPathContext(directory)),
    ).toEqual({ kind: "missing" });
  });

  it("atomically keeps the first complete closed failure shape", async () => {
    const paths = resolveEventLogPathContext(directory);
    await recordCaptureFailure(paths, "2026-07-29T12:00:00.000Z");
    await recordCaptureFailure(paths, "2026-07-29T12:01:00.000Z");

    expect(readCaptureFailure(paths)).toEqual({
      kind: "current",
      snapshot: {
        schemaVersion: 1,
        reason: "event-log-lock-timeout",
        recordedAt: "2026-07-29T12:00:00.000Z",
      },
    });
    expect(readdirSync(directory)).toEqual(["capture-failure.json"]);
  });

  it("fails closed on unknown or corrupt marker shapes", () => {
    const paths = resolveEventLogPathContext(directory);
    writeFileSync(
      paths.captureFailure,
      JSON.stringify({
        schemaVersion: 1,
        reason: "event-log-lock-timeout",
        recordedAt: "2026-07-29T12:00:00.000Z",
        eventId: "must-not-be-accepted",
      }),
      "utf8",
    );
    expect(readCaptureFailure(paths)).toEqual({ kind: "invalid" });
  });
});
