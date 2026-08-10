import {
  BacklogRetryController,
  type BacklogRetryOptions,
} from "./backlog-retry.ts";
import type { DrainEventQueueResult } from "./ingest-queue.ts";
import type { ShippingStatusSnapshot } from "./shipping-status.ts";

export interface EventDeliveryLoopOptions {
  drain: () => Promise<DrainEventQueueResult>;
  persistStatus: (snapshot: ShippingStatusSnapshot) => Promise<void>;
  retry?: Omit<BacklogRetryOptions, "attempt" | "persistStatus">;
  onDrainError?: () => void;
}

/**
 * Serialized owner of collector delivery. File changes, startup, shutdown, and
 * the independent retry timer all enter through `trigger`; concurrent triggers
 * coalesce into one follow-up drain.
 */
export class EventDeliveryLoop {
  readonly #drain: () => Promise<DrainEventQueueResult>;
  readonly #retry: BacklogRetryController;
  readonly #onDrainError: () => void;
  #running = false;
  #queued = false;
  #permanentBlocked = false;
  #idle: Promise<void> | undefined;

  constructor(options: EventDeliveryLoopOptions) {
    this.#drain = options.drain;
    this.#onDrainError = options.onDrainError ?? (() => {});
    this.#retry = new BacklogRetryController({
      attempt: () => this.#trigger(true),
      persistStatus: options.persistStatus,
      ...options.retry,
    });
  }

  trigger(): Promise<void> {
    return this.#trigger(false);
  }

  #trigger(slowRecoveryProbe: boolean): Promise<void> {
    // A permanent rejection is an open circuit. New file events remain durable
    // in the log but cannot bypass the slow probe and turn an active session
    // into a 4xx request loop.
    if (this.#permanentBlocked && !slowRecoveryProbe) {
      return this.#idle ?? Promise.resolve();
    }
    if (slowRecoveryProbe) this.#permanentBlocked = false;
    if (this.#running) {
      this.#queued = true;
      return this.#idle!;
    }
    this.#running = true;
    this.#idle = this.#run();
    return this.#idle;
  }

  async #run(): Promise<void> {
    try {
      do {
        this.#queued = false;
        this.#retry.beginAttempt();
        let result: DrainEventQueueResult;
        try {
          result = await this.#drain();
        } catch {
          this.#onDrainError();
          result = {
            acceptedEvents: 0,
            acceptedChunks: 0,
            rejectedLocalRecords: 0,
            blocked: true,
            retriable: true,
          };
        }
        await this.#retry.observe(result);
        this.#permanentBlocked = result.blocked && !result.retriable;
        if (this.#permanentBlocked) this.#queued = false;
      } while (this.#queued);
    } finally {
      this.#running = false;
      this.#idle = undefined;
    }
  }

  stop(): void {
    this.#retry.stop();
  }
}
