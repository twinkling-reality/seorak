/**
 * Worker entry for the local plane's heavy projections.
 *
 * Every projection here is synchronous by construction: `node:sqlite` has no
 * async API, so folding a window blocks whatever thread it runs on for its whole
 * duration. Measured on a real 345,764-row history (2026-09-09), warm:
 *
 *   overview          7d 1.0s    30d 3.9s    90d 2.5s
 *   developer model   7d 0.3s    30d 1.2s    90d 2.2s
 *
 * On the daemon's main thread that stalled the HTTP server itself, which is what
 * made a lazily-loaded dashboard route look hung rather than slow.
 *
 * Moving the folds here does not make them faster. It makes them someone else's
 * thread, so `/live`, `/sessions` and every other route keep answering while one
 * builds. The jobs are named rather than arbitrary: this file holds no
 * projection logic of its own to drift from `local-projection.ts`, and a worker
 * that could run any function handed to it would be a worse boundary, not a more
 * flexible one.
 *
 * Adding a projection is one entry in `ProjectionJob` and one case below.
 */

import { parentPort } from "node:worker_threads";
import {
  buildLocalDeveloperModel,
  buildLocalOverview,
} from "./local-projection.ts";

/**
 * `directory` is `string | null` rather than optional across this boundary.
 * `exactOptionalPropertyTypes` makes "absent" and "explicitly undefined"
 * different types, and structured clone does not preserve that distinction, so
 * the wire carries null and each case re-widens it into an absent property.
 */
export type ProjectionJob =
  | {
      kind: "overview";
      directory: string | null;
      /** The instant the window is anchored at. Explicit rather than ambient:
       *  a worker has its OWN clock, so a caller that pinned `Date.now` on the
       *  main thread would otherwise be silently ignored here, and the window a
       *  snapshot covers would not be reproducible from the request. */
      nowMs: number;
      rangeDays: number;
      archivedRepoIds: string[];
    }
  | {
      kind: "developerModel";
      directory: string | null;
      nowMs: number;
      rangeDays: number;
      repoId: string | null;
    };

export interface ProjectionWorkerRequest {
  id: number;
  job: ProjectionJob;
}

export type ProjectionWorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string };

function directoryOption(
  directory: string | null,
): { directory: string } | Record<string, never> {
  return directory === null ? {} : { directory };
}

export function runProjectionJob(job: ProjectionJob): unknown {
  switch (job.kind) {
    case "overview":
      return buildLocalOverview({
        ...directoryOption(job.directory),
        nowMs: job.nowMs,
        rangeDays: job.rangeDays,
        archivedRepoIds: new Set(job.archivedRepoIds),
      });
    case "developerModel":
      return buildLocalDeveloperModel({
        ...directoryOption(job.directory),
        nowMs: job.nowMs,
        rangeDays: job.rangeDays,
        repoId: job.repoId,
      });
  }
}

// `parentPort` is null when this module is loaded on the main thread, which the
// tests do to reach `runProjectionJob` and the types. Staying silent there keeps
// the module importable without a worker host.
parentPort?.on("message", (request: ProjectionWorkerRequest) => {
  try {
    const value = runProjectionJob(request.job);
    const response: ProjectionWorkerResponse = {
      id: request.id,
      ok: true,
      value,
    };
    parentPort?.postMessage(response);
  } catch (error) {
    // The message crosses a thread boundary, so send a string rather than an
    // Error: only the message survives structured clone intact, and the caller
    // falls back to an inline build anyway.
    const response: ProjectionWorkerResponse = {
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
    parentPort?.postMessage(response);
  }
});
