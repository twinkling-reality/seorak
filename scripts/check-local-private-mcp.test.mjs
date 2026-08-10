import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  LocalPrivateMcpCheckError,
  checkLocalPrivateMcp,
} from "./check-local-private-mcp.mjs";

const sourcePath = resolve(
  import.meta.dirname,
  "../packages/collector/src/local-private-mcp-resource.ts",
);

test("collector MCP gate executes the official-SDK E2E", () => {
  assert.doesNotThrow(() => checkLocalPrivateMcp());
});

test("a planted API-audience authorization fails, then the clean seam passes", () => {
  const source = readFileSync(sourcePath, "utf8");
  const planted = source.replace(
    "audience: resourceServerUrl.toString()",
    'audience: "http://127.0.0.1:4318/api/v1"',
  );
  assert.notEqual(planted, source, "mutation did not change the authority call");
  assert.throws(
    () => checkLocalPrivateMcp({ source: planted, runFocusedSuite: false }),
    (error) => {
      assert.ok(error instanceof LocalPrivateMcpCheckError);
      assert.match(error.message, /canonical MCP resource URL/);
      assert.match(error.message, /API audience path/);
      return true;
    },
  );
  assert.doesNotThrow(() =>
    checkLocalPrivateMcp({ source, runFocusedSuite: false })
  );
});
