/**
 * terminal-layout.test.ts — the persisted session preference: the window and the
 * view. The widget-slot model (normalize, add/remove/reorder, colSpan clamping)
 * went with the grid, so the pure half of this file pins the clamps, and the
 * disk half pins the VERSION GATE: current loads, a retired v1/v2 file is
 * imported once and erased, and every other shape is rejected — without ever
 * printing a byte, because a stray line corrupts the painted TUI frame.
 *
 * fs-sandboxed: SEORAK_DIR points at a temp dir, never the real ~/.seorak.
 */
import { existsSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { terminalLayoutPath } from "../src/paths.ts";
import {
  ALLOWED_RANGE_DAYS,
  DEFAULT_RANGE_DAYS,
  DEFAULT_VIEW,
  TERMINAL_LAYOUT_VERSION,
  clampRangeDays,
  clampView,
  defaultLayout,
  loadLayout,
  normalizeLayout,
  saveLayout,
  setRangeDays,
  setView,
} from "../src/terminal/layout.ts";

let sandbox: string;
const savedDir = process.env.SEORAK_DIR;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-layout-"));
  process.env.SEORAK_DIR = sandbox;
});

afterEach(() => {
  process.env.SEORAK_DIR = sandbox;
  rmSync(terminalLayoutPath(), { force: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
});

function writeRaw(body: string): void {
  writeFileSync(terminalLayoutPath(), body, "utf8");
}

function onDisk(): Record<string, unknown> {
  return JSON.parse(readFileSync(terminalLayoutPath(), "utf8")) as Record<string, unknown>;
}

describe("clampRangeDays", () => {
  it("accepts exactly the allowed windows", () => {
    for (const d of ALLOWED_RANGE_DAYS) expect(clampRangeDays(d)).toBe(d);
  });

  it("falls back to the default for anything else, including junk", () => {
    for (const bad of [1, 14, 365, 0, -7, null, undefined, "nope", {}]) {
      expect(clampRangeDays(bad)).toBe(DEFAULT_RANGE_DAYS);
    }
  });

  it("parses a numeric string (the /range argument path)", () => {
    expect(clampRangeDays("30")).toBe(30);
  });
});

describe("normalizeLayout", () => {
  it("keeps a valid window and view", () => {
    expect(normalizeLayout({ rangeDays: 90, view: "list" })).toEqual({ rangeDays: 90, view: "list" });
  });

  it("defaults an absent or invalid window rather than failing to load", () => {
    expect(normalizeLayout({})).toEqual({ rangeDays: DEFAULT_RANGE_DAYS, view: DEFAULT_VIEW });
    expect(normalizeLayout({ rangeDays: 14 })).toEqual({ rangeDays: DEFAULT_RANGE_DAYS, view: DEFAULT_VIEW });
  });

  it("reads the window out of an OLD widget-era file instead of resetting it", () => {
    const v2 = { version: 2, widgets: [{ id: "cost", colSpan: 3 }], rangeDays: 30 };
    expect(normalizeLayout(v2)).toEqual({ rangeDays: 30, view: DEFAULT_VIEW });
  });
});

describe("clampView", () => {
  it("accepts the two forms and defaults anything else to prose", () => {
    expect(clampView("list")).toBe("list");
    expect(clampView("paragraph")).toBe("paragraph");
    for (const bad of ["grid", "", null, undefined, 7, {}]) expect(clampView(bad)).toBe(DEFAULT_VIEW);
  });

  it("defaults to the paragraph: the form that can carry a caveat inline", () => {
    expect(DEFAULT_VIEW).toBe("paragraph");
  });
});

describe("setRangeDays is pure", () => {
  it("returns a new layout and clamps the value", () => {
    const base = defaultLayout();
    const next = setRangeDays(base, 30);
    expect(next).toEqual({ rangeDays: 30, view: DEFAULT_VIEW });
    expect(base).toEqual({ rangeDays: DEFAULT_RANGE_DAYS, view: DEFAULT_VIEW });
    expect(setRangeDays(base, 14)).toEqual({ rangeDays: DEFAULT_RANGE_DAYS, view: DEFAULT_VIEW });
  });

  it("setView is pure and leaves the window alone", () => {
    const base = setRangeDays(defaultLayout(), 90);
    expect(setView(base, "list")).toEqual({ rangeDays: 90, view: "list" });
    expect(base.view).toBe(DEFAULT_VIEW);
  });
});

describe("loadLayout version gate: current version", () => {
  it("round-trips a saved layout: the window and the view both survive", () => {
    saveLayout({ rangeDays: 90, view: "list" });
    expect(onDisk().version).toBe(TERMINAL_LAYOUT_VERSION);
    expect(loadLayout()).toEqual({ rangeDays: 90, view: "list" });
  });

  it("clamps a current-version file carrying an illegal window", () => {
    writeRaw(JSON.stringify({ version: TERMINAL_LAYOUT_VERSION, rangeDays: 14, view: "grid" }));
    expect(loadLayout()).toEqual({ rangeDays: DEFAULT_RANGE_DAYS, view: DEFAULT_VIEW });
  });
});

describe("loadLayout version gate: the bounded v1/v2 import", () => {
  it("keeps the window out of a v2 file and rewrites it at the current version", () => {
    writeRaw(JSON.stringify({ version: 2, widgets: [{ id: "cost", colSpan: 3 }], rangeDays: 30 }));

    expect(loadLayout()).toEqual({ rangeDays: 30, view: DEFAULT_VIEW });

    const after = onDisk();
    expect(after).toEqual({ version: TERMINAL_LAYOUT_VERSION, rangeDays: 30, view: DEFAULT_VIEW });
    expect(after).not.toHaveProperty("widgets");
  });

  it("carries a view across when the retired file happens to have one", () => {
    writeRaw(JSON.stringify({ version: 2, widgets: [{ id: "cost", colSpan: 3 }], rangeDays: 90, view: "list" }));
    expect(loadLayout()).toEqual({ rangeDays: 90, view: "list" });
    expect(onDisk()).toEqual({ version: TERMINAL_LAYOUT_VERSION, rangeDays: 90, view: "list" });
  });

  it("keeps the window out of a v1 file (widgets were bare ids) and rewrites it", () => {
    writeRaw(JSON.stringify({ version: 1, widgets: ["cost", "momentum"], rangeDays: 90 }));

    expect(loadLayout()).toEqual({ rangeDays: 90, view: DEFAULT_VIEW });

    const after = onDisk();
    expect(after).toEqual({ version: TERMINAL_LAYOUT_VERSION, rangeDays: 90, view: DEFAULT_VIEW });
    expect(after).not.toHaveProperty("widgets");
  });

  it("clamps an out-of-range window on import rather than letting it survive", () => {
    writeRaw(JSON.stringify({ version: 2, widgets: [], rangeDays: 365 }));

    expect(loadLayout()).toEqual({ rangeDays: DEFAULT_RANGE_DAYS, view: DEFAULT_VIEW });
    expect(onDisk()).toEqual({
      version: TERMINAL_LAYOUT_VERSION,
      rangeDays: DEFAULT_RANGE_DAYS,
      view: DEFAULT_VIEW,
    });
  });

  it("is one-time: the second load sees the current version, not the retired shape", () => {
    writeRaw(JSON.stringify({ version: 1, widgets: ["cost"], rangeDays: 30 }));
    expect(loadLayout()).toEqual({ rangeDays: 30, view: DEFAULT_VIEW });
    expect(loadLayout()).toEqual({ rangeDays: 30, view: DEFAULT_VIEW });
    expect(onDisk().version).toBe(TERMINAL_LAYOUT_VERSION);
  });
});

describe("loadLayout version gate: rejection", () => {
  it("rejects a versionless file and replaces it, so the shape does not persist", () => {
    writeRaw(JSON.stringify({ rangeDays: 90, view: "list" }));

    expect(loadLayout()).toEqual(defaultLayout());
    expect(onDisk()).toEqual({
      version: TERMINAL_LAYOUT_VERSION,
      rangeDays: DEFAULT_RANGE_DAYS,
      view: DEFAULT_VIEW,
    });
  });

  it("rejects a non-numeric version and replaces it", () => {
    writeRaw(JSON.stringify({ version: "three", rangeDays: 30 }));

    expect(loadLayout()).toEqual(defaultLayout());
    expect(onDisk()).toEqual({
      version: TERMINAL_LAYOUT_VERSION,
      rangeDays: DEFAULT_RANGE_DAYS,
      view: DEFAULT_VIEW,
    });
  });

  it("rejects a JSON primitive and a bare array the same way", () => {
    for (const body of ["7", '"paragraph"', "[]", "null"]) {
      writeRaw(body);
      expect(loadLayout()).toEqual(defaultLayout());
      expect(onDisk().version).toBe(TERMINAL_LAYOUT_VERSION);
    }
  });

  it("rejects an unrecognized version below the current one and replaces it", () => {
    writeRaw(JSON.stringify({ version: 0, rangeDays: 30 }));

    expect(loadLayout()).toEqual(defaultLayout());
    expect(onDisk().version).toBe(TERMINAL_LAYOUT_VERSION);
  });

  it("leaves a FUTURE version untouched: an older reader must not clobber newer state", () => {
    const future = JSON.stringify({ version: TERMINAL_LAYOUT_VERSION + 1, rangeDays: 30, somethingNew: true });
    writeRaw(future);

    expect(loadLayout()).toEqual(defaultLayout());
    expect(readFileSync(terminalLayoutPath(), "utf8")).toBe(future);
  });

  it("still overwrites a future-version file when the USER changes the preference", () => {
    writeRaw(JSON.stringify({ version: TERMINAL_LAYOUT_VERSION + 1, rangeDays: 30 }));
    saveLayout({ rangeDays: 90, view: "list" });
    expect(onDisk()).toEqual({ version: TERMINAL_LAYOUT_VERSION, rangeDays: 90, view: "list" });
  });
});

describe("loadLayout: absent, corrupt, and unwritable", () => {
  it("defaults when the file is absent and creates nothing", () => {
    expect(existsSync(terminalLayoutPath())).toBe(false);
    expect(loadLayout()).toEqual(defaultLayout());
    expect(existsSync(terminalLayoutPath())).toBe(false);
  });

  it("defaults on corrupt JSON without throwing, and leaves the bytes alone", () => {
    writeRaw("{not json");
    expect(() => loadLayout()).not.toThrow();
    expect(loadLayout()).toEqual(defaultLayout());
    expect(readFileSync(terminalLayoutPath(), "utf8")).toBe("{not json");
  });

  it("still yields the migrated layout when the import cannot be written", () => {
    // Root ignores the mode bits, so the unwritable-dir premise does not hold there.
    if (process.getuid?.() === 0) return;

    const readOnly = join(sandbox, "read-only");
    mkdirSync(readOnly, { recursive: true });
    process.env.SEORAK_DIR = readOnly;
    writeRaw(JSON.stringify({ version: 2, widgets: [{ id: "cost", colSpan: 3 }], rangeDays: 30 }));
    chmodSync(readOnly, 0o555);

    try {
      expect(loadLayout()).toEqual({ rangeDays: 30, view: DEFAULT_VIEW });
      expect(onDisk().version).toBe(2);
    } finally {
      chmodSync(readOnly, 0o755);
      rmSync(readOnly, { recursive: true, force: true });
      process.env.SEORAK_DIR = sandbox;
    }
  });
});

describe("loadLayout is silent (a stray line corrupts the painted frame)", () => {
  it("writes nothing to stdout or stderr on any load path", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      loadLayout(); // absent
      for (const body of [
        JSON.stringify({ version: TERMINAL_LAYOUT_VERSION, rangeDays: 30, view: "list" }),
        JSON.stringify({ version: 2, widgets: [{ id: "cost", colSpan: 3 }], rangeDays: 30 }),
        JSON.stringify({ version: 1, widgets: ["cost"], rangeDays: 90 }),
        JSON.stringify({ version: TERMINAL_LAYOUT_VERSION + 1, rangeDays: 30 }),
        JSON.stringify({ rangeDays: 30 }),
        "{not json",
      ]) {
        writeRaw(body);
        loadLayout();
      }

      for (const spy of [log, warn, error, info, debug, stdout, stderr]) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of [log, warn, error, info, debug, stdout, stderr]) spy.mockRestore();
    }
  });
});
