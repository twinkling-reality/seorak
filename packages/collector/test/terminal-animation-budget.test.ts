import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const terminalFetch = vi.hoisted(() => ({
  fetchLive: vi.fn(),
  fetchOverviewConditional: vi.fn(),
}));

vi.mock("../src/terminal/fetch.ts", () => ({
  fetchBoard: async () => {
    throw new Error("unexpected one-shot fetch");
  },
  fetchLive: terminalFetch.fetchLive,
  fetchOverview: async () => {
    throw new Error("unexpected legacy overview fetch");
  },
  fetchOverviewConditional: terminalFetch.fetchOverviewConditional,
}));

import {
  runInteractive,
  type TerminalInput,
  type TerminalOutput,
  type TerminalRuntime,
} from "../src/terminal/shell.ts";

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("interactive terminal animation budget", () => {
  it("does not restart full-screen animation after the session budget is spent", async () => {
    vi.useFakeTimers();
    terminalFetch.fetchLive.mockImplementation(() => new Promise(() => {}));
    terminalFetch.fetchOverviewConditional.mockImplementation(
      () => new Promise(() => {}),
    );

    const input = new FakeInput();
    const output = new FakeOutput();
    const runtime: TerminalRuntime = {
      input,
      output,
      enableKeypressEvents: () => {},
    };

    const completion = runInteractive(
      {
        workerUrl: "http://unreachable.test",
        color: true,
      },
      runtime,
    );

    await vi.advanceTimersByTimeAsync(15_000);
    const writesAfterBudget = output.writes.length;
    expect(writesAfterBudget).toBeGreaterThan(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(output.writes).toHaveLength(writesAfterBudget);

    output.emit("resize");
    expect(output.writes).toHaveLength(writesAfterBudget + 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(output.writes).toHaveLength(writesAfterBudget + 1);

    input.emit("keypress", undefined, { name: "c", ctrl: true });
    await expect(completion).resolves.toBe(0);
  });
});
