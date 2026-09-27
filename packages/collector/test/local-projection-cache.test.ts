import { describe, expect, it } from "vitest";
import {
  PROJECTION_MEMO_MAX_AGE_MS,
  ProjectionMemo,
  projectionMemoIsFresh,
  projectionMemoKey,
} from "../src/local-projection-cache.ts";

describe("projectionMemoKey", () => {
  const base = {
    kind: "overview",
    directory: "/tmp/seorak",
    parameters: { rangeDays: 30, archivedRepoIds: ["a", "b"] },
    highWater: 100,
  };

  it("is stable across property order, so one parameter set is one key", () => {
    expect(projectionMemoKey(base)).toBe(
      projectionMemoKey({
        ...base,
        parameters: { archivedRepoIds: ["a", "b"], rangeDays: 30 },
      }),
    );
  });

  it("separates two projections that share every parameter", () => {
    expect(projectionMemoKey({ ...base, kind: "developerModel" })).not.toBe(
      projectionMemoKey(base),
    );
  });

  it("separates every input that changes the projection", () => {
    const key = projectionMemoKey(base);
    expect(projectionMemoKey({ ...base, highWater: 101 })).not.toBe(key);
    expect(
      projectionMemoKey({ ...base, parameters: { rangeDays: 7 } }),
    ).not.toBe(key);
    expect(projectionMemoKey({ ...base, directory: "/tmp/other" })).not.toBe(key);
    expect(
      projectionMemoKey({
        ...base,
        parameters: { rangeDays: 30, archivedRepoIds: ["a"] },
      }),
    ).not.toBe(key);
  });

  it("distinguishes an absent directory from an empty one", () => {
    expect(projectionMemoKey({ ...base, directory: undefined })).not.toBe(
      projectionMemoKey({ ...base, directory: "x" }),
    );
  });

  it("does not let a repo id containing a separator forge another key", () => {
    expect(
      projectionMemoKey({ ...base, parameters: { a: ["a,b"] } }),
    ).not.toBe(projectionMemoKey({ ...base, parameters: { a: ["a", "b"] } }));
  });
});

describe("projectionMemoIsFresh", () => {
  it("holds inside the window and expires at the bound", () => {
    expect(projectionMemoIsFresh(1_000, 1_000)).toBe(true);
    expect(projectionMemoIsFresh(1_000, 1_000 + PROJECTION_MEMO_MAX_AGE_MS - 1)).toBe(
      true,
    );
    expect(projectionMemoIsFresh(1_000, 1_000 + PROJECTION_MEMO_MAX_AGE_MS)).toBe(
      false,
    );
  });

  it("treats a backwards clock as stale rather than as infinitely fresh", () => {
    expect(projectionMemoIsFresh(5_000, 4_000)).toBe(false);
  });
});

describe("ProjectionMemo", () => {
  it("returns a stored value and misses on an unknown key", () => {
    const memo = new ProjectionMemo<string>();
    memo.set("k", 0, "snapshot");
    expect(memo.get("k", 10)).toBe("snapshot");
    expect(memo.get("other", 10)).toBeNull();
  });

  it("drops an entry once it ages out, and does not retain it", () => {
    const memo = new ProjectionMemo<string>(1_000);
    memo.set("k", 0, "snapshot");
    expect(memo.get("k", 1_000)).toBeNull();
    expect(memo.size).toBe(0);
  });

  it("evicts the oldest entry past the bound", () => {
    const memo = new ProjectionMemo<string>(60_000, 2);
    memo.set("a", 0, "A");
    memo.set("b", 0, "B");
    memo.set("c", 0, "C");
    expect(memo.size).toBe(2);
    expect(memo.get("a", 1)).toBeNull();
    expect(memo.get("b", 1)).toBe("B");
    expect(memo.get("c", 1)).toBe("C");
  });

  it("refreshing a key moves it away from eviction rather than leaving it oldest", () => {
    const memo = new ProjectionMemo<string>(60_000, 2);
    memo.set("a", 0, "A");
    memo.set("b", 0, "B");
    memo.set("a", 1, "A2");
    memo.set("c", 1, "C");
    // "b" is now the oldest insertion, so it is the one that goes.
    expect(memo.get("a", 2)).toBe("A2");
    expect(memo.get("b", 2)).toBeNull();
    expect(memo.get("c", 2)).toBe("C");
  });

  it("clear empties the memo", () => {
    const memo = new ProjectionMemo<string>();
    memo.set("k", 0, "snapshot");
    memo.clear();
    expect(memo.get("k", 1)).toBeNull();
    expect(memo.size).toBe(0);
  });
});
