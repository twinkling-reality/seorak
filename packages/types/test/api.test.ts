// api.test.ts: the shared surface-transport primitives.
//
// These four helpers are the only thing terminal, web, and mobile share about
// talking to the worker, and each surface calls them from a different runtime
// (Node, a browser, React Native). A regression here breaks all three at once and
// only shows up against an ARMED or a slow worker, which is exactly the state a
// dev machine is never in. So they get pinned here rather than three times
// downstream.
//
// The worker-side half of the contract (does the route exist, does the header
// open the read gate) lives in packages/worker/test/route-contract.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  AGGREGATE_CACHE_STATUS_HEADER,
  LEGACY_AGGREGATE_CACHE_STATUS_HEADERS,
  OVERVIEW_RANGE_DAYS,
  REPLAY_SESSION_REQUEST_MAX,
  SESSION_MATERIALIZATION_MAX_ROWS,
  SESSION_PAGE_DEFAULT_LIMIT,
  SESSION_PAGE_MAX_LIMIT,
  SETTINGS_FAMILIES,
  WORKER_ERROR_CODES,
  bearerHeader,
  classifyWorkerStatus,
  conditionalGetHeaders,
  isAggregateCacheStale,
  isOverviewRangeDays,
  isWorkerErrorCode,
  readAggregateCacheStatus,
  seorakRoutes,
} from "@seorak/types";

test("worker error codes are a closed content-free control contract", () => {
  assert.deepEqual([...WORKER_ERROR_CODES], [
    "push_dispatcher_unconfigured",
    "session_materialization_limit",
    "session_outcome_limit",
    "session_page_changed",
  ]);
  assert.equal(isWorkerErrorCode("push_dispatcher_unconfigured"), true);
  assert.equal(isWorkerErrorCode("session_materialization_limit"), true);
  assert.equal(isWorkerErrorCode("session_outcome_limit"), true);
  assert.equal(isWorkerErrorCode("session_page_changed"), true);
  assert.equal(isWorkerErrorCode("APNs production dispatcher is not configured"), false);
  assert.equal(isWorkerErrorCode(null), false);
});

test("the public route contract cannot acquire transport authority", () => {
  const source = readFileSync(
    new URL("../src/api.ts", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "api.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const forbidden = new Set([
    "EventSource",
    "WebSocket",
    "XMLHttpRequest",
    "fetch",
  ]);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ((ts.isIdentifier(node.expression) &&
        forbidden.has(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          forbidden.has(node.expression.name.text)))
    ) {
      violations.push(node.expression.getText(tree));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.deepEqual(violations, []);
});

test("bearerHeader sends a header only for a real token", () => {
  assert.deepEqual(bearerHeader("k"), { authorization: "Bearer k" });
  // An OPEN worker must see no header at all, not an empty credential: an empty
  // Bearer is a wrong token, and an armed worker would 401 it.
  assert.deepEqual(bearerHeader(""), {});
  assert.deepEqual(bearerHeader("   "), {});
  assert.deepEqual(bearerHeader(null), {});
  assert.deepEqual(bearerHeader(undefined), {});
  // A token pasted from a terminal or a phone keyboard carries whitespace.
  assert.deepEqual(bearerHeader("  k  "), { authorization: "Bearer k" });
});

test("conditionalGetHeaders adds If-None-Match only when an ETag is held", () => {
  assert.deepEqual(conditionalGetHeaders("k", 'W/"v8"'), {
    authorization: "Bearer k",
    "if-none-match": 'W/"v8"',
  });
  // First poll: no ETag yet, so the request must NOT be conditional or the worker
  // has nothing to compare and the caller has no body to fall back on.
  assert.deepEqual(conditionalGetHeaders("k", null), { authorization: "Bearer k" });
  assert.deepEqual(conditionalGetHeaders(null, 'W/"v8"'), { "if-none-match": 'W/"v8"' });
  assert.deepEqual(conditionalGetHeaders(), {});
});

test("classifyWorkerStatus names what the user has to do about it", () => {
  assert.equal(classifyWorkerStatus(200), "ok");
  assert.equal(classifyWorkerStatus(204), "ok");
  // 304 is the cheap steady state, never an error: the caller keeps its snapshot.
  assert.equal(classifyWorkerStatus(304), "notModified");
  // 401 is the one status whose fix is a key rather than the URL.
  assert.equal(classifyWorkerStatus(401), "locked");
  assert.equal(classifyWorkerStatus(404), "notFound");
  assert.equal(classifyWorkerStatus(400), "error");
  assert.equal(classifyWorkerStatus(500), "error");
});

test("aggregate cache status describes the bytes and accepts the native-client cutover", () => {
  assert.equal(
    readAggregateCacheStatus(new Headers({ [AGGREGATE_CACHE_STATUS_HEADER]: "revalidating" })),
    "revalidating",
  );
  assert.equal(
    readAggregateCacheStatus(
      new Headers({ [LEGACY_AGGREGATE_CACHE_STATUS_HEADERS.overview]: "stale" }),
      LEGACY_AGGREGATE_CACHE_STATUS_HEADERS.overview,
    ),
    "stale",
  );
  // Older workers omitted the header on fresh responses. Unknown future values
  // are conservative rather than being silently promoted to fresh.
  assert.equal(readAggregateCacheStatus(new Headers()), "fresh");
  assert.equal(
    readAggregateCacheStatus(
      new Headers({ [AGGREGATE_CACHE_STATUS_HEADER]: "unavailable" }),
    ),
    "unavailable",
  );
  assert.equal(
    readAggregateCacheStatus(new Headers({ [AGGREGATE_CACHE_STATUS_HEADER]: "future" })),
    "unknown",
  );
  assert.equal(isAggregateCacheStale("fresh"), false);
  assert.equal(isAggregateCacheStale("revalidating"), true);
  assert.equal(isAggregateCacheStale("unknown"), true);
});

test("route ids are percent-encoded, so an opaque id cannot break the URL", () => {
  assert.equal(seorakRoutes.replay("a/b?c"), "/replay/a%2Fb%3Fc");
  assert.equal(seorakRoutes.session("a b"), "/sessions/a%20b");
  assert.equal(seorakRoutes.sessionOutcome("a#b"), "/sessions/a%23b/outcome");
  assert.equal(
    seorakRoutes.deviceTokens("d/1"),
    "/devices/d%2F1/tokens",
  );
});

test("session pages carry only typed bounded keyset inputs", () => {
  assert.equal(SESSION_PAGE_DEFAULT_LIMIT, 100);
  assert.equal(SESSION_PAGE_MAX_LIMIT, 200);
  assert.equal(SESSION_MATERIALIZATION_MAX_ROWS, 10_000);
  assert.equal(REPLAY_SESSION_REQUEST_MAX, 40);
  assert.equal(seorakRoutes.sessions(), "/sessions");
  assert.equal(
    seorakRoutes.sessions({ cursor: "opaque+/=", limit: 200 }),
    "/sessions?cursor=opaque%2B%2F%3D&limit=200",
  );
  assert.equal(seorakRoutes.sessions({ cursor: null }), "/sessions");
  assert.equal(seorakRoutes.sessions({ cursor: "" }), "/sessions?cursor=");
  assert.equal(
    seorakRoutes.sessions({ repoId: "a".repeat(64), limit: 200 }),
    `/sessions?limit=200&repoId=${"a".repeat(64)}`,
  );
});

test("windowed routes carry their range, and repoId only when scoped", () => {
  assert.equal(seorakRoutes.overview(30), "/overview?days=30");
  assert.equal(seorakRoutes.developerModel(7), "/developer-model?days=7");
  assert.equal(
    seorakRoutes.developerModel(90, "repo-1"),
    "/developer-model?days=90&repoId=repo-1",
  );
  // An absent scope must not become the string "null" in the query.
  assert.equal(seorakRoutes.developerModel(7, null), "/developer-model?days=7");
});

test("isOverviewRangeDays accepts exactly the declared windows", () => {
  for (const days of OVERVIEW_RANGE_DAYS) {
    assert.equal(isOverviewRangeDays(days), true, `${days} is declared`);
  }
  // The rejected cases are the ones a caller actually produces: a window this
  // build does not serve, the NaN that `Number.parseInt("")` yields for a missing
  // `?days`, and the string form a query string arrives as.
  for (const rejected of [1, 14, 60, 180, 365, 0, -7, 7.5, Number.NaN, "30", null, undefined]) {
    assert.equal(isOverviewRangeDays(rejected), false, `${String(rejected)} is not a window`);
  }
});

test("the shared range and family lists are the ones surfaces branch on", () => {
  assert.deepEqual([...OVERVIEW_RANGE_DAYS], [7, 30, 90]);
  assert.deepEqual(
    [...SETTINGS_FAMILIES],
    [
      "capture",
      "notifications",
      "liveActivity",
      "projectThemes",
      "projectMerges",
      "projectArchive",
    ],
  );
});
