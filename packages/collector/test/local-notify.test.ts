/**
 * local-notify.test.ts — the delivery leg, and the reason it cannot be an
 * injection vector.
 *
 * The notification text carries a repo basename the user chose, so the property
 * that matters most here is that NO value ever reaches a script or a shell as
 * text: the AppleScript is a constant and the strings travel as arguments.
 */
import { describe, expect, it, vi } from "vitest";
import type { Intervention } from "@seorak/types";
import {
  deliverLocalIntervention,
  deliverLocalInterventions,
} from "../src/local-notify.ts";

function fire(overrides: Partial<Intervention> = {}): Intervention {
  return {
    kind: "cost_spike",
    sessionId: "s-1",
    project: "seorak",
    repoId: "a".repeat(64),
    triggeredAt: "2026-08-02T12:00:00.000Z",
    signalLabel: "Cost spike",
    body: "This session has spent $12.40, past your $5 budget.",
    deepLink: "seorak://session/s-1",
    interruptionLevel: "timeSensitive",
    ...overrides,
  };
}

function okSpawn() {
  return vi.fn(() => ({
    status: 0,
    stdout: "",
    stderr: "",
    pid: 1,
    output: [],
    signal: null,
  })) as never;
}

describe("delivery", () => {
  it("passes every value as an argument, never as script text", () => {
    const spawn = okSpawn();
    // A repo basename is a directory name the user picked. If it were
    // interpolated into the script, this one would run a shell command.
    const hostile = 'x" & (do shell script "touch /tmp/pwned") & "';
    deliverLocalIntervention(fire({ project: hostile }), spawn, "darwin");

    const [command, args] = (spawn as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, string[]];
    expect(command).toBe("osascript");
    // The script is a constant: it names no value and reads from argv.
    const script = args[1]!;
    expect(script).toContain("on run argv");
    expect(script).not.toContain(hostile);
    expect(script).not.toContain("seorak");
    // And the hostile value is its own argument, byte for byte, unquoted and
    // unescaped, because nothing will ever parse it.
    expect(args).toContain(hostile);
  });

  it("sends project as title, the catalog label as subtitle, and the sentence as body", () => {
    const spawn = okSpawn();
    deliverLocalIntervention(fire(), spawn, "darwin");
    const [, args] = (spawn as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, string[]];
    expect(args.slice(2)).toEqual([
      "This session has spent $12.40, past your $5 budget.",
      "seorak",
      "Cost spike",
    ]);
  });

  it("reports an unsupported platform rather than pretending", () => {
    const spawn = okSpawn();
    expect(deliverLocalIntervention(fire(), spawn, "linux")).toEqual({
      delivered: false,
      reason: "unsupported-platform",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("never throws when the notifier is missing or fails", () => {
    const throwing = vi.fn(() => {
      throw new Error("ENOENT");
    }) as never;
    expect(deliverLocalIntervention(fire(), throwing, "darwin")).toEqual({
      delivered: false,
      reason: "notifier-failed",
    });

    const failing = vi.fn(() => ({
      status: 1,
      stdout: "",
      stderr: "not authorized",
      pid: 1,
      output: [],
      signal: null,
    })) as never;
    expect(deliverLocalIntervention(fire(), failing, "darwin")).toEqual({
      delivered: false,
      reason: "notifier-failed",
    });
  });

  it("counts a batch so a silent void is noticeable", () => {
    const spawn = okSpawn();
    expect(
      deliverLocalInterventions([fire(), fire({ kind: "long_session" })], spawn, "darwin"),
    ).toEqual({ delivered: 2, failed: 0, unsupported: false });

    expect(deliverLocalInterventions([fire()], spawn, "win32")).toEqual({
      delivered: 0,
      failed: 1,
      unsupported: true,
    });
  });
});
