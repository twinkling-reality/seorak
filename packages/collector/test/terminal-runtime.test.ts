import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/terminal/fetch.ts", () => ({
  fetchBoard: async () => {
    throw new Error("unexpected board failure");
  },
  fetchLive: async () => {
    throw new Error("unexpected live failure");
  },
  fetchOverview: async () => {
    throw new Error("unexpected overview failure");
  },
  fetchOverviewConditional: async () => {
    throw new Error("unexpected overview failure");
  },
}));
import {
  runInteractive,
  type TerminalInput,
  type TerminalOutput,
  type TerminalRuntime,
} from "../src/terminal/shell.ts";

class FakeInput extends EventEmitter implements TerminalInput {
  isTTY = true;
  rawModes: boolean[] = [];
  paused = false;
  resumed = false;

  setRawMode(enabled: boolean): void {
    this.rawModes.push(enabled);
  }

  pause(): this {
    this.paused = true;
    return this;
  }

  resume(): this {
    this.resumed = true;
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

describe("interactive terminal runtime", () => {
  it("enters raw alternate-screen mode and fully restores it on ctrl-c", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    let keypressEnabled = false;
    const runtime: TerminalRuntime = {
      input,
      output,
      enableKeypressEvents: () => {
        keypressEnabled = true;
      },
    };

    const completion = runInteractive(
      {
        workerUrl: "http://unused.test",
        color: false,
        demo: "welcome",
      },
      runtime,
    );
    expect(keypressEnabled).toBe(true);
    expect(input.rawModes).toEqual([true]);
    expect(input.resumed).toBe(true);
    expect(input.listenerCount("keypress")).toBe(1);
    expect(output.listenerCount("resize")).toBe(1);
    expect(output.writes.join("")).toContain("\u001b[?1049h");

    input.emit("keypress", undefined, { name: "c", ctrl: true });

    await expect(completion).resolves.toBe(0);
    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(input.listenerCount("keypress")).toBe(0);
    expect(output.listenerCount("resize")).toBe(0);
    expect(output.writes.join("")).toContain("\u001b[?25h\u001b[?1049l");
  });

  it("restores the terminal when an asynchronous poll escapes its transport", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const runtime: TerminalRuntime = {
      input,
      output,
      enableKeypressEvents: () => {},
    };

    const completion = runInteractive(
      {
        workerUrl: "http://unused.test",
        color: false,
      },
      runtime,
    );

    await expect(completion).resolves.toBe(1);
    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(input.listenerCount("keypress")).toBe(0);
    expect(output.listenerCount("resize")).toBe(0);
    expect(output.writes.join("")).toContain("\u001b[?1049h");
    expect(output.writes.join("")).toContain("\u001b[?25h\u001b[?1049l");
  });

  it("keeps demo output isolated from the host shipping status", async () => {
    const previousDirectory = process.env.SEORAK_DIR;
    const directory = mkdtempSync(join(tmpdir(), "seorak-terminal-demo-"));
    process.env.SEORAK_DIR = directory;
    writeFileSync(
      join(directory, "shipping-status.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        state: "blocked",
        updatedAt: "2026-07-29T12:00:00.000Z",
        consecutiveFailures: 1,
        httpStatus: 422,
      })}\n`,
      "utf8",
    );
    const input = new FakeInput();
    const output = new FakeOutput();

    try {
      const completion = runInteractive(
        {
          workerUrl: "http://unused.test",
          color: false,
          demo: "healthy",
        },
        {
          input,
          output,
          enableKeypressEvents: () => {},
        },
      );
      expect(output.writes.join("")).not.toContain(
        "captured events are waiting to ship",
      );
      input.emit("keypress", undefined, { name: "c", ctrl: true });
      await expect(completion).resolves.toBe(0);
    } finally {
      if (previousDirectory === undefined) delete process.env.SEORAK_DIR;
      else process.env.SEORAK_DIR = previousDirectory;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
