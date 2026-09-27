/**
 * Owns the one worker thread that builds the local plane's projections.
 *
 * Three properties matter here, and each is a decision rather than a default.
 *
 * ONE persistent worker, spawned on first use. Spawning costs tens of
 * milliseconds and loading the projection module costs more, so a worker per
 * request would hand back a slice of what moving off the main thread just won.
 * A single worker also serialises builds, which is what we want: two concurrent
 * folds over the same 244MB history would compete for the same pages.
 *
 * SINGLE-FLIGHT by key. The dashboard polls every 30s, but several widgets and
 * several tabs can ask at once, and a build outlasts the gap between them. Two
 * callers asking the same question share one build instead of queueing two.
 *
 * FALLS BACK INLINE ON FAILURE, never on slowness. If the worker cannot spawn,
 * errors, or exits, the caller builds on the main thread exactly as it did
 * before this file existed. That is a return to the old behaviour rather than an
 * outage, which is the right way for an optimisation to fail. Slowness is waited
 * out instead, for the reason recorded below.
 */

import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { collectorPackageRoot } from "./package-layout.ts";
import type {
  ProjectionJob,
  ProjectionWorkerRequest,
  ProjectionWorkerResponse,
} from "./local-projection-worker.ts";

/**
 * There is deliberately NO build timeout.
 *
 * The first version had one, at 30s, after which the caller rebuilt inline. That
 * is worse than having no worker at all, and it was measured: while the codex
 * tailer was saturating this process with I/O, a 7-day overview waited out the
 * whole timeout and THEN folded again on the main thread, so the request passed
 * 60s where an inline-only build would have answered sooner. A timeout on a
 * slow-but-progressing build converts slowness into duplicated work.
 *
 * The fallback therefore fires on FAILURE and never on slowness. A worker that
 * cannot spawn, that errors, or that exits fails its pending requests at once
 * and those callers build inline. A worker that is merely slow is waited for,
 * because it is going to produce the answer and racing it wins nothing.
 */

/**
 * Where the worker entry actually lives, which is not the same place twice.
 *
 * `new Worker(new URL("./local-projection-worker.ts", import.meta.url))` is the
 * obvious spelling and it is wrong for the shipped package. esbuild does not
 * follow `new Worker(new URL(...))`, so that file is never emitted, and in a
 * bundle `import.meta.url` points into `dist/chunks/` rather than at a sibling
 * of the source. The published collector would have spawned nothing, fallen back
 * inline through the catch below, and looked exactly like a working build while
 * doing none of this. So the entry is resolved from the package root the same
 * way `collectorExecutableDirectory` resolves hooks and the daemon, and the
 * build emits `local-overview-worker` as its own entry point.
 *
 * Returns null when neither layout has it, which the caller treats as "no
 * worker" and answers inline.
 */
export function projectionWorkerEntry(
  moduleUrl: string = import.meta.url,
): string | null {
  let packageRoot: string;
  try {
    packageRoot = collectorPackageRoot(moduleUrl);
  } catch {
    return null;
  }
  const modulePath = relative(packageRoot, fileURLToPath(moduleUrl));
  const bundled =
    modulePath === "dist" || modulePath.startsWith(`dist${sep}`);
  const candidate = bundled
    ? join(packageRoot, "dist", "local-projection-worker.mjs")
    : join(packageRoot, "src", "local-projection-worker.ts");
  return existsSync(candidate) ? candidate : null;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}


export class ProjectionThread {
  #worker: Worker | null = null;
  #nextId = 1;
  readonly #pending = new Map<number, Pending>();
  readonly #inFlight = new Map<string, Promise<unknown>>();
  #closed = false;

  /** Spawn on demand. A daemon that never serves an overview never pays for a
   *  second thread, and a worker that died is replaced on the next request. */
  #ensureWorker(): Worker | null {
    if (this.#closed) return null;
    if (this.#worker !== null) return this.#worker;
    const entry = projectionWorkerEntry();
    if (entry === null) return null;
    let worker: Worker;
    try {
      worker = new Worker(entry);
    } catch {
      return null;
    }
    worker.on("message", (response: ProjectionWorkerResponse) => {
      const pending = this.#pending.get(response.id);
      if (pending === undefined) return;
      this.#pending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.message));
    });
    // A worker that errors or exits takes its outstanding requests with it.
    // Failing them explicitly is what lets each caller fall back inline. With no
    // timeout, this is the ONLY thing that ends a wait for an answer that is
    // never coming, so it must fire on both events rather than just on error.
    const abandon = (reason: string): void => {
      if (this.#worker === worker) this.#worker = null;
      for (const [id, pending] of this.#pending) {
        this.#pending.delete(id);
        pending.reject(new Error(reason));
      }
    };
    worker.on("error", (error) => abandon(error.message));
    worker.on("exit", () => abandon("projection worker exited"));
    // Do not hold the process open for this thread. The daemon's lifetime is
    // decided by its server and its timers, never by a cache warmer.
    worker.unref();
    this.#worker = worker;
    return worker;
  }

  /**
   * Build off the main thread. Rejects rather than throwing synchronously, so
   * every failure path reaches the caller's inline fallback the same way.
   */
  build(job: ProjectionJob, key: string): Promise<unknown> {
    const existing = this.#inFlight.get(key);
    if (existing !== undefined) return existing;
    const promise = this.#dispatch(job).finally(() => {
      this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, promise);
    return promise;
  }

  #dispatch(job: ProjectionJob): Promise<unknown> {
    const worker = this.#ensureWorker();
    if (worker === null) {
      return Promise.reject(new Error("projection worker unavailable"));
    }
    const id = this.#nextId++;
    const message: ProjectionWorkerRequest = { id, job };
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        worker.postMessage(message);
      } catch (error) {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Shutdown seam. Idempotent, and safe to call with builds outstanding: the
   *  exit handler fails them so their callers fall back rather than hang. */
  async close(): Promise<void> {
    this.#closed = true;
    const worker = this.#worker;
    this.#worker = null;
    if (worker === null) return;
    await worker.terminate();
  }
}
