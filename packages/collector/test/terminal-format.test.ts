/**
 * terminal-format.test.ts — the PURE layout + relative-time primitives the prose
 * board still leans on. The value gates that used to live here (null aggregate
 * to "--", the meter, the KPI cell, the live row) went with the widget grid: a
 * paragraph never renders a "--", it declines to write the sentence, and that
 * gate is asserted in terminal-narrative.test.ts instead.
 */
import { describe, expect, it } from "vitest";
import { formatAgo, paint, visibleWidth } from "../src/terminal/render/format.ts";

describe("formatAgo — mirrors the web relative-time vocabulary", () => {
  const base = Date.parse("2026-06-24T12:00:00.000Z");
  it("reads 'just now' under 10s, and for a null/invalid timestamp", () => {
    expect(formatAgo(null, base)).toBe("just now");
    expect(formatAgo("not-a-date", base)).toBe("just now");
    expect(formatAgo("2026-06-24T11:59:57.000Z", base)).toBe("just now");
  });
  it("floors into s / m / h / d ago", () => {
    expect(formatAgo("2026-06-24T11:59:30.000Z", base)).toBe("30s ago");
    expect(formatAgo("2026-06-24T11:55:00.000Z", base)).toBe("5m ago");
    expect(formatAgo("2026-06-24T10:00:00.000Z", base)).toBe("2h ago");
    expect(formatAgo("2026-06-21T12:00:00.000Z", base)).toBe("3d ago");
  });
  it("never goes negative on a future timestamp (clock skew)", () => {
    expect(formatAgo("2026-06-24T12:00:30.000Z", base)).toBe("just now");
  });
});

describe("paint — zero escape bytes when color is off", () => {
  it("is a no-op without color and wraps with color", () => {
    expect(paint(false, "1", "x")).toBe("x");
    expect(paint(true, "1", "x")).toBe("\x1b[1mx\x1b[0m");
  });
});
