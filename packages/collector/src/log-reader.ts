import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type EventBatch, type SessionEvent } from "@seorak/types";
import { EVENT_BATCH_BYTE_LIMIT, EVENT_BATCH_EVENT_LIMIT, EVENT_BATCH_SCHEMA_VERSION, parseSessionEvent } from "@seorak/types/event-validation";
import { journalEventRejection } from "./event-rejections.ts";
import { readEventLogGeneration } from "./event-log.ts";
import { eventsLogPath, offsetPath } from "./paths.ts";

/**
 * log-reader.ts — the daemon's durable read position over the active event-log
 * generation. Split out of daemon.ts so offset/crash-recovery semantics are testable
 * without booting the explicit runDaemon process lifecycle.
 *
 * Durability contract (the daemon's at-least-once guarantee):
 *   - The shipping cursor binds a generation to a BYTE position in events.jsonl.
 *     Valid events advance it only after a worker 2xx. Invalid complete records
 *     advance it only after a content-free rejection record has been fsynced.
 *   - The chunk reader consumes only COMPLETE lines: a hook that appended a
 *     partial JSON line (or a crash mid-append) leaves a trailing fragment that
 *     is not counted toward the next offset, so it is re-read intact.
 *   - writeOffset is atomic (temp + rename) so a crash mid-write cannot leave a
 *     torn cursor or make an equal-sized new generation look acknowledged.
 */

interface ShippingCursor {
  version: 1;
  generation: number;
  offset: number;
}

async function readShippingCursor(
  requestedGeneration?: number,
): Promise<ShippingCursor> {
  const generation = requestedGeneration ?? (await readEventLogGeneration());
  try {
    const value = JSON.parse(
      await readFile(offsetPath(), "utf8"),
    ) as Partial<ShippingCursor>;
    if (
      value.version !== 1 ||
      value.generation !== generation ||
      !Number.isSafeInteger(value.offset) ||
      value.offset! < 0
    ) {
      return { version: 1, generation, offset: 0 };
    }
    return { version: 1, generation, offset: value.offset! };
  } catch {
    return { version: 1, generation, offset: 0 };
  }
}

export async function readOffset(): Promise<number> {
  return (await readShippingCursor()).offset;
}

export async function writeOffset(
  offset: number,
  requestedGeneration?: number,
): Promise<void> {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("event-log offset must be a non-negative safe integer");
  }
  const currentGeneration = await readEventLogGeneration();
  const generation = requestedGeneration ?? currentGeneration;
  if (generation !== currentGeneration) {
    throw new Error("event-log generation changed before offset acknowledgement");
  }
  // Atomic: write a temp file then rename over the cursor. A crash mid-write
  // leaves the previous valid generation + offset intact.
  // rename(2) is atomic within a filesystem.
  const path = offsetPath();
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    tmp,
    JSON.stringify({ version: 1, generation, offset } satisfies ShippingCursor),
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(tmp, path);
}

interface CompleteLogRecord {
  startOffset: number;
  nextOffset: number;
  bytes: number;
  raw: Buffer | null;
}

/**
 * Stream complete JSONL records from an arbitrary byte position. A record larger
 * than the request-body ceiling is counted but not retained in memory (`raw:
 * null`), and a trailing partial record is never yielded.
 */
async function* completeLogRecords(
  startOffset: number,
): AsyncGenerator<CompleteLogRecord> {
  let lineStart = startOffset;
  let absolute = startOffset;
  let lineBytes = 0;
  let parts: Buffer[] = [];
  let oversize = false;
  const stream = createReadStream(eventsLogPath(), { start: startOffset });

  for await (const value of stream) {
    const chunk = value as Buffer;
    let segmentStart = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      const segment = chunk.subarray(segmentStart, index);
      lineBytes += segment.byteLength;
      if (!oversize && lineBytes <= EVENT_BATCH_BYTE_LIMIT) {
        parts.push(segment);
      } else {
        oversize = true;
        parts = [];
      }

      const nextOffset = absolute + index + 1;
      yield {
        startOffset: lineStart,
        nextOffset,
        bytes: lineBytes,
        raw: oversize ? null : Buffer.concat(parts, lineBytes),
      };

      lineStart = nextOffset;
      lineBytes = 0;
      parts = [];
      oversize = false;
      segmentStart = index + 1;
    }

    const trailing = chunk.subarray(segmentStart);
    lineBytes += trailing.byteLength;
    if (!oversize && lineBytes <= EVENT_BATCH_BYTE_LIMIT) {
      parts.push(trailing);
    } else {
      oversize = true;
      parts = [];
    }
    absolute += chunk.byteLength;
  }
}

export interface EventLogChunk {
  generation: number;
  batch: EventBatch;
  body: string;
  startOffset: number;
  /** Byte position after the last included or durably rejected complete line. */
  nextOffset: number;
  rejected: number;
}

function versionedBatch(
  collectorVersion: string,
  deviceId: string,
  events: SessionEvent[],
): EventBatch {
  return {
    schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
    collectorVersion,
    deviceId,
    events,
  };
}

function serializeBatch(
  collectorVersion: string,
  deviceId: string,
  events: SessionEvent[],
): { batch: EventBatch; body: string } {
  const batch = versionedBatch(collectorVersion, deviceId, events);
  return { batch, body: JSON.stringify(batch) };
}

/**
 * Read one shippable prefix from the durable shipping cursor.
 *
 * Both protocol limits are exact: at most 128 events, and at most 524,288 UTF-8
 * bytes after the versioned batch envelope is serialized. Invalid complete
 * records are fsynced to a content-free rejection checkpoint before `nextOffset`
 * can pass them. A valid record that belongs to the next chunk is not consumed.
 */
export async function readNextEventChunk(options: {
  collectorVersion: string;
  deviceId: string;
}): Promise<EventLogChunk> {
  const generation = await readEventLogGeneration();
  let offset = (await readShippingCursor(generation)).offset;
  try {
    const handle = await open(eventsLogPath(), "r");
    try {
      const stat = await handle.stat();
      if (stat.size < offset) {
        console.warn(
          `[seorak/collector] events log shrank below the read offset (${stat.size} < ${offset}); re-reading from the top (offset reset to 0)`,
        );
        offset = 0;
      }
    } finally {
      await handle.close();
    }
  } catch {
    const empty = serializeBatch(options.collectorVersion, options.deviceId, []);
    return {
      ...empty,
      generation,
      startOffset: offset,
      nextOffset: offset,
      rejected: 0,
    };
  }

  const events: SessionEvent[] = [];
  let nextOffset = offset;
  let rejected = 0;

  for await (const record of completeLogRecords(offset)) {
    let reason:
      | "empty-record"
      | "invalid-json"
      | "invalid-event"
      | "oversize-record"
      | null = null;
    let event: SessionEvent | null = null;

    if (record.raw === null) {
      reason = "oversize-record";
    } else if (record.raw.byteLength === 0) {
      reason = "empty-record";
    } else {
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(record.raw);
      } catch {
        decoded = "";
        reason = "invalid-json";
      }
      if (reason === null) {
        try {
          event = parseSessionEvent(JSON.parse(decoded));
          if (event === null) reason = "invalid-event";
        } catch {
          reason = "invalid-json";
        }
      }
    }

    if (reason !== null) {
      await journalEventRejection({
        generation,
        chunkStartOffset: offset,
        offset: record.startOffset,
        nextOffset: record.nextOffset,
        bytes: record.bytes,
        reason,
      });
      rejected += 1;
      nextOffset = record.nextOffset;
      if (rejected >= EVENT_BATCH_EVENT_LIMIT) break;
      continue;
    }

    const candidate = serializeBatch(options.collectorVersion, options.deviceId, [
      ...events,
      event!,
    ]);
    if (Buffer.byteLength(candidate.body, "utf8") > EVENT_BATCH_BYTE_LIMIT) {
      if (events.length > 0) break;
      await journalEventRejection({
        generation,
        chunkStartOffset: offset,
        offset: record.startOffset,
        nextOffset: record.nextOffset,
        bytes: record.bytes,
        reason: "oversize-record",
      });
      rejected += 1;
      nextOffset = record.nextOffset;
      if (rejected >= EVENT_BATCH_EVENT_LIMIT) break;
      continue;
    }

    events.push(event!);
    nextOffset = record.nextOffset;
    if (events.length >= EVENT_BATCH_EVENT_LIMIT) break;
  }

  const serialized = serializeBatch(
    options.collectorVersion,
    options.deviceId,
    events,
  );
  return {
    ...serialized,
    generation,
    startOffset: offset,
    nextOffset,
    rejected,
  };
}

/**
 * Read complete, current-contract events from an arbitrary byte offset for the
 * file-touch attribution ledger. Its cursor is intentionally independent from
 * shipping: a worker outage cannot stall local attribution, and a checkpoint
 * recovery cannot cause network replay.
 */
export async function readEventsFrom(
  offset: number,
): Promise<{ events: SessionEvent[]; nextOffset: number }> {
  let handle;
  try {
    handle = await open(eventsLogPath(), "r");
  } catch {
    return { events: [], nextOffset: offset };
  }
  try {
    const stat = await handle.stat();
    if (stat.size < offset) {
      // The log shrank below the ledger cursor: it was truncated or recreated.
      // Rebuild the idempotent local attribution fold from the top.
      console.warn(
        `[seorak/collector] events log shrank below the read offset (${stat.size} < ${offset}); re-reading from the top (offset reset to 0)`,
      );
      offset = 0;
    }
    if (stat.size <= offset) return { events: [], nextOffset: offset };
    const buf = Buffer.alloc(stat.size - offset);
    await handle.read(buf, 0, buf.length, offset);
    const text = buf.toString("utf8");
    const lines = text.split("\n");
    // split() always returns N+1 elements: a trailing "" when text ends with "\n",
    // or a partial line when it doesn't. Either way, the last element is not a
    // complete consumed line — drop it.
    const completeLines = lines.slice(0, -1);
    const consumedBytes = completeLines.reduce(
      (sum, line) => sum + Buffer.byteLength(line, "utf8") + 1,
      0,
    );
    const events: SessionEvent[] = [];
    for (const line of completeLines) {
      if (!line.trim()) continue;
      try {
        const event = parseSessionEvent(JSON.parse(line));
        if (event === null) {
          console.warn("[seorak/collector] attribution ledger skipped an invalid event");
          continue;
        }
        events.push(event);
      } catch {
        console.warn("[seorak/collector] attribution ledger skipped invalid JSON");
      }
    }
    return { events, nextOffset: offset + consumedBytes };
  } finally {
    await handle.close();
  }
}
