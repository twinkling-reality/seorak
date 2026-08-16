import type { DrainEventQueueResult } from "./ingest-queue.ts";
import {
  SHIPPING_STATUS_SCHEMA_VERSION,
  type ShippingStatusSnapshot,
} from "./shipping-status.ts";

export interface BacklogRetryOptions {
  attempt: () => Promise<void>;
  persistStatus: (snapshot: ShippingStatusSnapshot) => Promise<void>;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  random?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onAttemptError?: () => void;
}

const defaultSetTimer = (callback: () => void, delayMs: number): unknown =>
  setTimeout(callback, delayMs);
const defaultClearTimer = (handle: unknown): void =>
  clearTimeout(handle as ReturnType<typeof setTimeout>);

function requirePositiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

/** Half-to-full jitter avoids synchronized collector retry spikes. */
export function retryDelayMs(options: {
  consecutiveFailures: number;
  baseDelayMs: number;
  maxDelayMs: number;
  random: number;
  retryAfterMs?: number;
}): number {
  const exponent = Math.max(0, options.consecutiveFailures - 1);
  const ceiling = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** Math.min(exponent, 30),
  );
  const random = Math.min(1, Math.max(0, options.random));
  const jittered = Math.round(ceiling / 2 + (ceiling / 2) * random);
  return Math.max(jittered, options.retryAfterMs ?? 0);
}

/**
 * One durable-log retry scheduler. It owns exactly one timer, probes permanent
 * failures at the slow ceiling, and resets its backoff only after the backlog
 * catches up.
 */
export class BacklogRetryController {
  readonly #attempt: () => Promise<void>;
  readonly #persistStatus: (snapshot: ShippingStatusSnapshot) => Promise<void>;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #onAttemptError: () => void;
  #consecutiveFailures = 0;
  #timer: unknown;
  #stopped = false;

  constructor(options: BacklogRetryOptions) {
    this.#attempt = options.attempt;
    this.#persistStatus = options.persistStatus;
    this.#baseDelayMs = requirePositiveDuration(
      options.baseDelayMs ?? 30_000,
      "baseDelayMs",
    );
    this.#maxDelayMs = requirePositiveDuration(
      options.maxDelayMs ?? 15 * 60_000,
      "maxDelayMs",
    );
    if (this.#maxDelayMs < this.#baseDelayMs) {
      throw new Error("maxDelayMs must be greater than or equal to baseDelayMs");
    }
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#setTimer = options.setTimer ?? defaultSetTimer;
    this.#clearTimer = options.clearTimer ?? defaultClearTimer;
    this.#onAttemptError = options.onAttemptError ?? (() => {});
  }

  beginAttempt(): void {
    if (this.#timer !== undefined) {
      this.#clearTimer(this.#timer);
      this.#timer = undefined;
    }
  }

  async observe(result: DrainEventQueueResult): Promise<void> {
    this.beginAttempt();
    const now = this.#now();
    const updatedAt = new Date(now).toISOString();

    if (!result.blocked) {
      this.#consecutiveFailures = 0;
      await this.#persistStatus({
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "caught-up",
        updatedAt,
        consecutiveFailures: 0,
        ...(result.route ? { route: result.route } : {}),
      });
      return;
    }

    this.#consecutiveFailures += 1;
    if (!result.retriable) {
      const nextRetryAt = new Date(now + this.#maxDelayMs).toISOString();
      await this.#persistStatus({
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt,
        consecutiveFailures: this.#consecutiveFailures,
        ...(!this.#stopped ? { nextRetryAt } : {}),
        ...(result.status !== undefined ? { httpStatus: result.status } : {}),
        ...(result.protocol ? { protocol: result.protocol } : {}),
      });
      if (this.#stopped) return;
      this.#timer = this.#setTimer(() => {
        this.#timer = undefined;
        void this.#attempt().catch(() => this.#onAttemptError());
      }, this.#maxDelayMs);
      return;
    }

    if (this.#stopped) {
      await this.#persistStatus({
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt,
        consecutiveFailures: this.#consecutiveFailures,
        ...(result.status !== undefined ? { httpStatus: result.status } : {}),
        ...(result.protocol ? { protocol: result.protocol } : {}),
      });
      return;
    }

    const delayMs = retryDelayMs({
      consecutiveFailures: this.#consecutiveFailures,
      baseDelayMs: this.#baseDelayMs,
      maxDelayMs: this.#maxDelayMs,
      random: this.#random(),
      ...(result.retryAfterMs !== undefined
        ? { retryAfterMs: result.retryAfterMs }
        : {}),
    });
    const nextRetryAt = new Date(now + delayMs).toISOString();
    await this.#persistStatus({
      schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
      state: "retrying",
      updatedAt,
      consecutiveFailures: this.#consecutiveFailures,
      nextRetryAt,
      ...(result.status !== undefined ? { httpStatus: result.status } : {}),
    });
    if (this.#stopped) return;

    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      void this.#attempt().catch(() => this.#onAttemptError());
    }, delayMs);
  }

  stop(): void {
    this.#stopped = true;
    this.beginAttempt();
  }
}
