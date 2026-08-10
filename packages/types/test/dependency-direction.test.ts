import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("types dependency direction", () => {
  it("keeps capabilities independent of the event payload graph", () => {
    const source = readFileSync(new URL("../src/capabilities.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["']\.\/events\.ts["']/);
    assert.match(source, /from ["']\.\/agent\.ts["']/);
  });
});
