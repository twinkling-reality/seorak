import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  inspectLaunchdService,
  launchdServiceLoaded,
  stopLaunchdService,
  type LaunchctlSpawn,
} from "../src/launchd.ts";

function result(
  status: number,
  stderr = "",
): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [null, "", stderr],
    stdout: "",
    stderr,
    status,
    signal: null,
    error: undefined,
  };
}

describe("launchd exact service control", () => {
  it("does not invoke launchctl off macOS", () => {
    const calls: string[][] = [];
    const spawn: LaunchctlSpawn = (_command, args) => {
      calls.push([...args]);
      return result(0);
    };
    expect(launchdServiceLoaded("app.test", spawn, "linux")).toBe(false);
    expect(stopLaunchdService("app.test", spawn, "linux")).toEqual({
      stopped: true,
      attempted: false,
      error: null,
    });
    expect(calls).toEqual([]);
  });

  it("stops the exact user-domain label and proves it absent afterward", () => {
    const calls: string[][] = [];
    const statuses = [0, 1, 1];
    const spawn: LaunchctlSpawn = (_command, args) => {
      calls.push([...args]);
      const status = statuses.shift()!;
      return result(
        status,
        calls.length === 3 ? 'Could not find service "app.test"' : "",
      );
    };
    const stopped = stopLaunchdService("app.test", spawn, "darwin");
    const target = `gui/${process.getuid!()}/app.test`;
    expect(stopped).toEqual({
      stopped: true,
      attempted: true,
      error: null,
    });
    expect(calls).toEqual([
      ["print", target],
      ["bootout", target],
      ["print", target],
    ]);
  });

  it("settles the Option B race where the first post-bootout inspect is still loaded", () => {
    // bootout returned, but launchctl still listed the service once. A later
    // inspect showed it gone. Without settle, cmdStop printed a failure for a
    // service that was already leaving.
    const calls: string[][] = [];
    const script: Array<{ status: number; stderr: string }> = [
      { status: 0, stderr: "" }, // before: loaded
      { status: 0, stderr: "" }, // bootout
      { status: 0, stderr: "" }, // after #1: still loaded (the race)
      { status: 0, stderr: "" }, // retry bootout
      { status: 1, stderr: 'Could not find service "app.test"' }, // after #2: absent
    ];
    const spawn: LaunchctlSpawn = (_command, args) => {
      calls.push([...args]);
      const next = script.shift();
      if (!next) throw new Error(`unexpected launchctl call: ${args.join(" ")}`);
      return result(next.status, next.stderr);
    };
    let now = 0;
    const sleeps: number[] = [];
    const stopped = stopLaunchdService("app.test", spawn, "darwin", {
      nowMs: () => now,
      sleepMs: (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      settleDeadlineMs: 200,
      settlePollMs: 50,
    });
    const target = `gui/${process.getuid!()}/app.test`;
    expect(stopped).toEqual({
      stopped: true,
      attempted: true,
      error: null,
    });
    expect(sleeps).toEqual([50]);
    expect(calls).toEqual([
      ["print", target],
      ["bootout", target],
      ["print", target],
      ["bootout", target],
      ["print", target],
    ]);
  });

  it("fails closed when the service stays loaded past the settle deadline", () => {
    const spawn: LaunchctlSpawn = () => result(0, "operation failed");
    let now = 0;
    expect(
      stopLaunchdService("app.test", spawn, "darwin", {
        nowMs: () => now,
        sleepMs: (ms) => {
          now += ms;
        },
        settleDeadlineMs: 100,
        settlePollMs: 50,
      }),
    ).toEqual({
      stopped: false,
      attempted: true,
      error: "operation failed",
    });
  });

  it("fails closed when launchctl still reports the exact service", () => {
    // Immediate post-bootout still loaded, and settle also never sees absence.
    const spawn: LaunchctlSpawn = () => result(0, "operation failed");
    let now = 1_000;
    expect(
      stopLaunchdService("app.test", spawn, "darwin", {
        nowMs: () => now,
        sleepMs: (ms) => {
          now += ms;
        },
        settleDeadlineMs: 0,
        settlePollMs: 50,
      }),
    ).toEqual({
      stopped: false,
      attempted: true,
      error: "operation failed",
    });
  });

  it("is idempotent when the exact service was already absent", () => {
    const calls: string[][] = [];
    const spawn: LaunchctlSpawn = (_command, args) => {
      calls.push([...args]);
      return result(1, 'Could not find service "app.test"');
    };
    expect(stopLaunchdService("app.test", spawn, "darwin")).toEqual({
      stopped: true,
      attempted: false,
      error: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("print");
  });

  it("distinguishes explicit absence from an unknown launchctl failure", () => {
    const absent: LaunchctlSpawn = () =>
      result(113, 'Could not find service "app.test"');
    expect(inspectLaunchdService("app.test", absent, "darwin")).toEqual({
      state: "absent",
      error: null,
    });

    const unknown: LaunchctlSpawn = () =>
      result(1, "Could not communicate with launchd");
    expect(inspectLaunchdService("app.test", unknown, "darwin")).toEqual({
      state: "unknown",
      error: "Could not communicate with launchd",
    });
    expect(stopLaunchdService("app.test", unknown, "darwin")).toEqual({
      stopped: false,
      attempted: false,
      error: "Could not communicate with launchd",
    });

    const wrongLabel: LaunchctlSpawn = () =>
      result(113, 'Could not find service "app.other"');
    expect(inspectLaunchdService("app.test", wrongLabel, "darwin")).toEqual({
      state: "unknown",
      error: 'Could not find service "app.other"',
    });

    const generic: LaunchctlSpawn = () => result(3, "No such process");
    expect(inspectLaunchdService("app.test", generic, "darwin")).toEqual({
      state: "unknown",
      error: "No such process",
    });
  });
});
