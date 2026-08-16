/**
 * terminal-identity.test.ts — the identity block (ADR-2a): the CC/Codex-genre
 * opener rendered ONLY in quiet states. Assertions pin the three real fact
 * rows, the honest nothing-installed fallback, border integrity at narrow
 * widths, and the color-off zero-ANSI contract.
 */
import { describe, expect, it } from "vitest";
import { hostOf, identityBlock } from "../src/terminal/render/identity.ts";
import { renderConnecting, renderFrame, renderUnreachable } from "../src/terminal/render/frame.ts";
import { frameBoxWidth, visibleWidth } from "../src/terminal/render/format.ts";
import type { BoardData, RenderContext } from "../src/terminal/types.ts";

const ANSI = /\x1b\[[0-9;]*m/;
const FACTS = { watching: "Claude Code and Codex", workerHost: "seorak-worker.example.workers.dev" };

describe("identityBlock", () => {
  it("carries the wordmark, the positioning line, and the three fact rows", () => {
    const text = identityBlock(FACTS, 30, false, 100).join("\n");
    expect(text).toContain("seorak");
    expect(text).toContain("performance tracking for agentic development");
    expect(text).toContain("watching");
    expect(text).toContain("Claude Code and Codex");
    expect(text).toContain("seorak-worker.example.workers.dev");
    expect(text).toContain("last 30 days");
    // Block Elements (slope quadrants + full blocks), not ▲: block glyphs fill
    // their cell in every monospace font, so the pyramid stays centered
    // (▲ renders double-width in some fonts and breaks the apex).
    expect(text).toContain("█");
    expect(text).toContain("▟");
    expect(text).toContain("▙");
    expect(text).not.toContain("▲");
  });

  it("nothing installed → an honest fallback naming the fix", () => {
    const text = identityBlock({ ...FACTS, watching: null }, 7, false, 100).join("\n");
    expect(text).toContain("nothing yet (run seorak setup)");
  });

  it("color off emits zero ANSI escapes", () => {
    for (const line of identityBlock(FACTS, 7, false, 100)) expect(line).not.toMatch(ANSI);
  });

  it("narrow width: compact form (no mark), clipped values, intact border", () => {
    const lines = identityBlock(FACTS, 7, false, 40);
    const max = frameBoxWidth(40);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(max);
    }
    const text = lines.join("\n");
    expect(text).not.toContain("█");
    expect(text).toContain("…");
    expect(lines[0]).toContain("╭");
    expect(lines.at(-1)).toContain("╯");
  });

  it("every width keeps the right border aligned (padEnd by visible width)", () => {
    for (const width of [48, 64, 80, 120]) {
      const lines = identityBlock(FACTS, 90, true, width);
      const widths = new Set(lines.map((l) => visibleWidth(l)));
      expect(widths.size).toBe(1);
    }
  });
});

describe("hostOf", () => {
  it("extracts the host and falls back to the raw string", () => {
    expect(hostOf("https://seorak-worker.example.workers.dev")).toBe("seorak-worker.example.workers.dev");
    expect(hostOf("http://localhost:8787")).toBe("localhost:8787");
    expect(hostOf("not a url")).toBe("not a url");
  });
});

describe("quiet states render the block; the live board never does", () => {
  const layout = { widgets: [{ id: "live-sessions", colSpan: 12 }], rangeDays: 7 };
  const emptyOverview = { generatedAt: "2026-07-16T09:00:00.000Z", live: [], usage: { projects: [] } };
  const ctx = (identity?: typeof FACTS): RenderContext =>
    ({ color: false, width: 100, now: Date.now(), days: 7, ...(identity ? { identity } : {}) }) as RenderContext;

  it("first-run WITH identity facts → the block replaces the slim header", () => {
    const data = { live: [], generatedAt: null, overview: emptyOverview } as unknown as BoardData;
    const out = renderFrame(layout, data, ctx(FACTS));
    expect(out).toContain("performance tracking for agentic development");
    expect(out).toContain("No sessions yet.");
    expect(out).not.toContain("7d"); // no range pills; range lives in the block
  });

  it("first-run WITHOUT identity facts keeps the slim header (one-shot compat)", () => {
    const data = { live: [], generatedAt: null, overview: emptyOverview } as unknown as BoardData;
    const out = renderFrame(layout, data, ctx());
    expect(out).toContain("7d");
    expect(out).not.toContain("watching");
  });

  it("connecting is a loader, and names the host it is dialing", () => {
    // The block is NOT here any more: /live answers in about 250ms, so rendering
    // it meant flashing a screen too fast to read. It belongs to the entry card,
    // which stays put because it has something to say.
    const connecting = renderConnecting(false, 100, "seorak", undefined, "https://w.example", FACTS, 7);
    expect(connecting).not.toContain("watching");
    expect(connecting).toContain("connecting to w.example");
  });

  it("unreachable with identity carries the block and never repeats the URL", () => {
    const unreachable = renderUnreachable("https://w.example", false, 100, "seorak", FACTS, 7);
    expect(unreachable).toContain("watching");
    expect(unreachable).toContain("Cannot reach the worker right now.");
    expect(unreachable).toContain("seorak status");
    expect(unreachable).not.toContain("https://w.example");
  });
});

describe("identity styling (ADR-2a round 2: accent border, gradient wave, palette)", () => {
  it("the border wears the muted accent when color is on", () => {
    const lines = identityBlock(FACTS, 7, true, 100);
    expect(lines[0]).toContain("\x1b[2;36m");
    expect(lines.at(-1)).toContain("\x1b[2;36m");
  });

  it("the mark is a multi-shade aurora gradient even when static (phase 0)", () => {
    const text = identityBlock(FACTS, 7, true, 100).join("\n");
    const shades = new Set([...text.matchAll(/38;5;(\d+)m/g)].map((m) => m[1]));
    expect(shades.size).toBeGreaterThanOrEqual(4);
    // the static band spans cyan into the web-accent lavender family
    expect(text).toContain("38;5;44");
    expect(text).toContain("38;5;146");
  });

  it("advancing the pulse slides every cell's color; a full period repeats", () => {
    const p0 = identityBlock(FACTS, 7, true, 100, 0).join("\n");
    const p2 = identityBlock(FACTS, 7, true, 100, 2).join("\n");
    const period = identityBlock(FACTS, 7, true, 100, 32).join("\n"); // 16 ramp steps x 2 ticks
    expect(p0).not.toBe(p2);
    expect(p0).toBe(period);
  });

  it("color off stays zero-ANSI even with a pulse phase", () => {
    for (const line of identityBlock(FACTS, 7, false, 100, 3)) expect(line).not.toMatch(ANSI);
  });
});
