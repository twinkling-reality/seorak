import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SESSION_PAGE_MAX_LIMIT,
  seorakRoutes,
  sessionToLiveActivity,
} from "../src/mobile.ts";

test("the mobile entry exposes cross-surface runtime contracts", () => {
  assert.equal(seorakRoutes.overview(7), "/overview?days=7");
  assert.equal(
    seorakRoutes.sessions({ cursor: "next", limit: SESSION_PAGE_MAX_LIMIT }),
    "/sessions?cursor=next&limit=200",
  );
  assert.equal(
    seorakRoutes.sessions({ repoId: "a".repeat(64), limit: SESSION_PAGE_MAX_LIMIT }),
    `/sessions?limit=200&repoId=${"a".repeat(64)}`,
  );
  assert.equal(typeof sessionToLiveActivity, "function");
});

test("the mobile entry cannot pull server validators or upstream catalogs into Metro", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/mobile.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /\.\/push\.ts|\.\/widgets\.ts/);
  assert.doesNotMatch(source, /@mobile-surfaces\/(surface-contracts|traps)/);
});
