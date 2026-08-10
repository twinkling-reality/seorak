import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hooksSource = readFileSync(new URL("../src/hooks.ts", import.meta.url), "utf8");
const collectorRoot = new URL("..", import.meta.url);

function sourceFilesUnder(root: URL): URL[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), root);
    if (entry.isDirectory()) return sourceFilesUnder(child);
    return /\.(?:[cm]?js|ts)$/.test(entry.name) ? [child] : [];
  });
}

describe("hooks module boundary", () => {
  it("does not re-export adapter-owned values or types", () => {
    expect(hooksSource).not.toMatch(
      /export\s*\{[^}]*(?:activeAgentId|agentCapabilities|getAdapter)[^}]*\}/s,
    );
    expect(hooksSource).not.toMatch(
      /export\s+type\s*\{[^}]*CanonicalInput[^}]*\}/s,
    );
  });

  it("has no speculative hook-adapter selector or inert Codex hook path", () => {
    expect(
      existsSync(new URL("../src/adapters/index.ts", import.meta.url)),
    ).toBe(false);

    const production = sourceFilesUnder(new URL("./src/", collectorRoot))
      .concat(sourceFilesUnder(new URL("./bin/", collectorRoot)))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const removed = [
      ["SEORAK", "ADAPTER"].join("_"),
      ["active", "AgentId"].join(""),
      ["get", "Adapter"].join(""),
      ["Tool", "Adapter"].join(""),
      ["codex", "Adapter"].join(""),
    ];
    for (const symbol of removed) {
      expect(production, `${symbol} must remain deleted`).not.toContain(symbol);
    }
  });

  it("binds each installed hook executable directly to the Claude parser", () => {
    const hookBins = sourceFilesUnder(new URL("./bin/", collectorRoot)).filter(
      (path) => /hook-[^/]+\.mjs$/.test(path.pathname),
    );
    expect(hookBins).toHaveLength(5);
    for (const path of hookBins) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("parseClaudeCodeHook");
      expect(source).toMatch(/input\?\.phase\s*!==/);
    }
  });
});
