import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  readEventLogGeneration,
  withEventLogLock,
} from "./event-log.ts";
import {
  resolveEventLogPathContext,
  type EventLogPathContext,
} from "./paths.ts";

export type LocalEventRejectionReason =
  | "empty-record"
  | "invalid-json"
  | "invalid-event"
  | "oversize-record";

export interface LocalEventRejection {
  /** Log generation disambiguates byte offsets after acknowledged rollover. */
  generation: number;
  /** Durable shipping cursor from which this chunk was read. */
  chunkStartOffset: number;
  /** Byte position in events.jsonl. Identifies the local record without its data. */
  offset: number;
  /** Byte position immediately after the record newline. */
  nextOffset: number;
  /** Raw JSONL record size, excluding its newline. */
  bytes: number;
  reason: LocalEventRejectionReason;
}

export type CurrentEventRejections =
  | { kind: "current"; generation: number; count: number }
  | { kind: "unreadable"; generation: number };

interface RejectionBucket {
  count: number;
  bytes: number;
}

type RejectionBuckets = Record<LocalEventRejectionReason, RejectionBucket>;

interface RejectionReplayEntry {
  offset: number;
  nextOffset: number;
  bytes: number;
  reason: LocalEventRejectionReason;
}

interface RejectionReplay {
  startOffset: number;
  rejections: RejectionReplayEntry[];
}

export interface EventRejectionCheckpointV1 {
  schemaVersion: 1;
  current: {
    generation: number;
    byReason: RejectionBuckets;
    replay: RejectionReplay | null;
  };
  history: {
    throughGeneration: number | null;
    byReason: RejectionBuckets;
  };
}

export const EVENT_REJECTION_CHECKPOINT_VERSION = 1 as const;
export const EVENT_REJECTION_REPLAY_LIMIT = 128;
export const EVENT_REJECTION_CHECKPOINT_MAX_BYTES = 64 * 1024;

const REJECTION_REASONS = [
  "empty-record",
  "invalid-json",
  "invalid-event",
  "oversize-record",
] as const satisfies readonly LocalEventRejectionReason[];
const REJECTION_REASON_SET = new Set<LocalEventRejectionReason>(
  REJECTION_REASONS,
);

export class EventRejectionCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventRejectionCheckpointError";
  }
}

function emptyBuckets(): RejectionBuckets {
  return {
    "empty-record": { count: 0, bytes: 0 },
    "invalid-json": { count: 0, bytes: 0 },
    "invalid-event": { count: 0, bytes: 0 },
    "oversize-record": { count: 0, bytes: 0 },
  };
}

function emptyCheckpoint(generation: number): EventRejectionCheckpointV1 {
  return {
    schemaVersion: EVENT_REJECTION_CHECKPOINT_VERSION,
    current: {
      generation,
      byReason: emptyBuckets(),
      replay: null,
    },
    history: {
      throughGeneration: generation === 0 ? null : generation - 1,
      byReason: emptyBuckets(),
    },
  };
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseBuckets(value: unknown): RejectionBuckets | null {
  if (!isRecord(value) || !exactKeys(value, REJECTION_REASONS)) return null;
  const buckets = emptyBuckets();
  for (const reason of REJECTION_REASONS) {
    const bucket = value[reason];
    if (
      !isRecord(bucket) ||
      !exactKeys(bucket, ["count", "bytes"]) ||
      !nonNegativeInteger(bucket.count) ||
      !nonNegativeInteger(bucket.bytes)
    ) {
      return null;
    }
    buckets[reason] = {
      count: bucket.count,
      bytes: bucket.bytes,
    };
  }
  return buckets;
}

function parseReplayEntry(value: unknown): RejectionReplayEntry | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["offset", "nextOffset", "bytes", "reason"]) ||
    !nonNegativeInteger(value.offset) ||
    !nonNegativeInteger(value.nextOffset) ||
    !nonNegativeInteger(value.bytes) ||
    typeof value.reason !== "string" ||
    !REJECTION_REASON_SET.has(value.reason as LocalEventRejectionReason) ||
    value.nextOffset !== value.offset + value.bytes + 1
  ) {
    return null;
  }
  return {
    offset: value.offset,
    nextOffset: value.nextOffset,
    bytes: value.bytes,
    reason: value.reason as LocalEventRejectionReason,
  };
}

function parseReplay(value: unknown): RejectionReplay | null | "invalid" {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !exactKeys(value, ["startOffset", "rejections"]) ||
    !nonNegativeInteger(value.startOffset) ||
    !Array.isArray(value.rejections) ||
    value.rejections.length === 0 ||
    value.rejections.length > EVENT_REJECTION_REPLAY_LIMIT
  ) {
    return "invalid";
  }
  const rejections: RejectionReplayEntry[] = [];
  const offsets = new Set<number>();
  for (const candidate of value.rejections) {
    const rejection = parseReplayEntry(candidate);
    if (
      rejection === null ||
      rejection.offset < value.startOffset ||
      offsets.has(rejection.offset)
    ) {
      return "invalid";
    }
    offsets.add(rejection.offset);
    rejections.push(rejection);
  }
  return { startOffset: value.startOffset, rejections };
}

function parseCheckpoint(value: unknown): EventRejectionCheckpointV1 | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["schemaVersion", "current", "history"]) ||
    value.schemaVersion !== EVENT_REJECTION_CHECKPOINT_VERSION ||
    !isRecord(value.current) ||
    !exactKeys(value.current, ["generation", "byReason", "replay"]) ||
    !nonNegativeInteger(value.current.generation) ||
    !isRecord(value.history) ||
    !exactKeys(value.history, ["throughGeneration", "byReason"])
  ) {
    return null;
  }
  const currentBuckets = parseBuckets(value.current.byReason);
  const historyBuckets = parseBuckets(value.history.byReason);
  const replay = parseReplay(value.current.replay);
  const throughGeneration = value.history.throughGeneration;
  const expectedThrough =
    value.current.generation === 0 ? null : value.current.generation - 1;
  if (
    currentBuckets === null ||
    historyBuckets === null ||
    replay === "invalid" ||
    throughGeneration !== expectedThrough
  ) {
    return null;
  }
  if (replay !== null) {
    const replayBuckets = emptyBuckets();
    for (const rejection of replay.rejections) {
      addBucket(replayBuckets, rejection.reason, 1, rejection.bytes);
    }
    for (const reason of REJECTION_REASONS) {
      if (
        replayBuckets[reason].count > currentBuckets[reason].count ||
        replayBuckets[reason].bytes > currentBuckets[reason].bytes
      ) {
        return null;
      }
    }
  }
  return {
    schemaVersion: EVENT_REJECTION_CHECKPOINT_VERSION,
    current: {
      generation: value.current.generation,
      byReason: currentBuckets,
      replay,
    },
    history: {
      throughGeneration: throughGeneration as number | null,
      byReason: historyBuckets,
    },
  };
}

function checkedAdd(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new EventRejectionCheckpointError(`${label} exceeds safe integer range`);
  }
  return total;
}

function addBucket(
  buckets: RejectionBuckets,
  reason: LocalEventRejectionReason,
  count: number,
  bytes: number,
): void {
  const bucket = buckets[reason];
  bucket.count = checkedAdd(bucket.count, count, "rejection count");
  bucket.bytes = checkedAdd(bucket.bytes, bytes, "rejected byte count");
}

function currentCount(checkpoint: EventRejectionCheckpointV1): number {
  return REJECTION_REASONS.reduce(
    (total, reason) =>
      checkedAdd(
        total,
        checkpoint.current.byReason[reason].count,
        "current rejection count",
      ),
    0,
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EBADF") {
      throw error;
    }
  } finally {
    await handle.close();
  }
}

async function writeCheckpoint(
  paths: EventLogPathContext,
  checkpoint: EventRejectionCheckpointV1,
): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const temporary = `${paths.rejectionCheckpoint}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(checkpoint)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, paths.rejectionCheckpoint);
    await syncDirectory(paths.directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maximumBytes + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.byteLength - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maximumBytes) {
      throw new EventRejectionCheckpointError(
        "event rejection checkpoint exceeds its byte limit",
      );
    }
    return buffer.subarray(0, total).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function loadCheckpoint(
  paths: EventLogPathContext,
): Promise<EventRejectionCheckpointV1 | null> {
  let text: string;
  try {
    text = await readBoundedFile(
      paths.rejectionCheckpoint,
      EVENT_REJECTION_CHECKPOINT_MAX_BYTES,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new EventRejectionCheckpointError(
      "event rejection checkpoint cannot be read",
    );
  }
  try {
    const checkpoint = parseCheckpoint(JSON.parse(text));
    if (checkpoint !== null) return checkpoint;
  } catch {
    // Normalized to one content-free error below.
  }
  throw new EventRejectionCheckpointError(
    "event rejection checkpoint is invalid",
  );
}

interface ShippingCursor {
  version: 1;
  generation: number;
  offset: number;
}

async function readShippingCursor(
  paths: EventLogPathContext,
  generation: number,
): Promise<ShippingCursor> {
  try {
    const value = JSON.parse(
      await readFile(paths.offset, "utf8"),
    ) as Partial<ShippingCursor>;
    if (
      value.version === 1 &&
      value.generation === generation &&
      nonNegativeInteger(value.offset)
    ) {
      return { version: 1, generation, offset: value.offset };
    }
  } catch {
    // Missing or invalid cursors restart at zero in log-reader.ts.
  }
  return { version: 1, generation, offset: 0 };
}

function advanceCheckpoint(
  checkpoint: EventRejectionCheckpointV1,
  generation: number,
): EventRejectionCheckpointV1 {
  if (checkpoint.current.generation > generation) {
    throw new EventRejectionCheckpointError(
      "event rejection checkpoint is ahead of the event log",
    );
  }
  if (checkpoint.current.generation === generation) return checkpoint;
  const history = emptyBuckets();
  for (const reason of REJECTION_REASONS) {
    const prior = checkpoint.history.byReason[reason];
    const current = checkpoint.current.byReason[reason];
    history[reason] = {
      count: checkedAdd(prior.count, current.count, "historical rejection count"),
      bytes: checkedAdd(prior.bytes, current.bytes, "historical rejected bytes"),
    };
  }
  return {
    schemaVersion: EVENT_REJECTION_CHECKPOINT_VERSION,
    current: {
      generation,
      byReason: emptyBuckets(),
      replay: null,
    },
    history: {
      throughGeneration: generation - 1,
      byReason: history,
    },
  };
}

async function ensureCheckpointUnlocked(
  paths: EventLogPathContext,
  generation: number,
): Promise<EventRejectionCheckpointV1> {
  let checkpoint = await loadCheckpoint(paths);
  if (checkpoint === null) {
    checkpoint = emptyCheckpoint(generation);
    await writeCheckpoint(paths, checkpoint);
  }
  const advanced = advanceCheckpoint(checkpoint, generation);
  if (advanced !== checkpoint) {
    await writeCheckpoint(paths, advanced);
    checkpoint = advanced;
  }
  return checkpoint;
}

/**
 * Reconcile rejection state after event-log recovery or acknowledged rollover.
 * Event generation advances first; a crash before this call is repaired by the
 * next startup, status read, or rejection write.
 */
export async function advanceEventRejectionCheckpoint(
  generation: number,
): Promise<void> {
  if (!nonNegativeInteger(generation)) {
    throw new EventRejectionCheckpointError(
      "event rejection generation must be a non-negative safe integer",
    );
  }
  const paths = resolveEventLogPathContext();
  await withEventLogLock(paths, async () => {
    const actualGeneration = await readEventLogGeneration(paths);
    if (actualGeneration !== generation) {
      throw new EventRejectionCheckpointError(
        "event log generation changed before rejection reconciliation",
      );
    }
    await ensureCheckpointUnlocked(paths, actualGeneration);
  });
}

/**
 * Read a constant-bounded current-generation verdict. Historical counts never
 * affect status, and corrupt or future state fails closed instead of becoming a
 * fabricated clean generation.
 */
export async function readCurrentEventRejections(): Promise<CurrentEventRejections> {
  const paths = resolveEventLogPathContext();
  let generation = await readEventLogGeneration(paths);
  try {
    return await withEventLogLock(paths, async () => {
      generation = await readEventLogGeneration(paths);
      const checkpoint = await ensureCheckpointUnlocked(paths, generation);
      return {
        kind: "current" as const,
        generation,
        count: currentCount(checkpoint),
      };
    });
  } catch {
    return { kind: "unreadable", generation };
  }
}

function sameReplayEntry(
  left: RejectionReplayEntry,
  right: RejectionReplayEntry,
): boolean {
  return (
    left.offset === right.offset &&
    left.nextOffset === right.nextOffset &&
    left.bytes === right.bytes &&
    left.reason === right.reason
  );
}

/**
 * Persist a content-free rejection classification before the shipping cursor
 * may pass it. The exact bounded replay window distinguishes a retry from a
 * newly rejected record even when valid records create gaps in the chunk.
 */
export async function journalEventRejection(
  rejection: LocalEventRejection,
): Promise<void> {
  if (
    !nonNegativeInteger(rejection.generation) ||
    !nonNegativeInteger(rejection.chunkStartOffset) ||
    !nonNegativeInteger(rejection.offset) ||
    !nonNegativeInteger(rejection.nextOffset) ||
    !nonNegativeInteger(rejection.bytes) ||
    !REJECTION_REASON_SET.has(rejection.reason) ||
    rejection.offset < rejection.chunkStartOffset ||
    rejection.nextOffset !== rejection.offset + rejection.bytes + 1
  ) {
    throw new EventRejectionCheckpointError(
      "event rejection boundary is invalid",
    );
  }
  const paths = resolveEventLogPathContext();
  await withEventLogLock(paths, async () => {
    const actualGeneration = await readEventLogGeneration(paths);
    if (actualGeneration !== rejection.generation) {
      throw new EventRejectionCheckpointError(
        "event log generation changed before rejection persistence",
      );
    }
    const cursor = await readShippingCursor(paths, actualGeneration);
    if (cursor.offset !== rejection.chunkStartOffset) {
      throw new EventRejectionCheckpointError(
        "shipping cursor changed before rejection persistence",
      );
    }
    const checkpoint = await ensureCheckpointUnlocked(
      paths,
      actualGeneration,
    );
    const candidate: RejectionReplayEntry = {
      offset: rejection.offset,
      nextOffset: rejection.nextOffset,
      bytes: rejection.bytes,
      reason: rejection.reason,
    };
    let replay = checkpoint.current.replay;
    if (
      replay === null ||
      replay.startOffset < rejection.chunkStartOffset
    ) {
      replay = {
        startOffset: rejection.chunkStartOffset,
        rejections: [],
      };
    } else if (replay.startOffset > rejection.chunkStartOffset) {
      throw new EventRejectionCheckpointError(
        "rejection replay moved behind its durable cursor",
      );
    }
    const atOffset = replay.rejections.find(
      (entry) => entry.offset === candidate.offset,
    );
    if (atOffset !== undefined) {
      if (sameReplayEntry(atOffset, candidate)) return;
      throw new EventRejectionCheckpointError(
        "rejection classification changed at a replayed offset",
      );
    }
    if (replay.rejections.length >= EVENT_REJECTION_REPLAY_LIMIT) {
      throw new EventRejectionCheckpointError(
        "event rejection replay window is full",
      );
    }
    replay.rejections.push(candidate);
    checkpoint.current.replay = replay;
    addBucket(
      checkpoint.current.byReason,
      rejection.reason,
      1,
      rejection.bytes,
    );
    await writeCheckpoint(paths, checkpoint);
  });
}
