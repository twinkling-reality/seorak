import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { resolveEventLogPathContext, type EventLogPathContext } from "./paths.ts";

export const CAPTURE_FAILURE_SCHEMA_VERSION = 1 as const;
export const CAPTURE_FAILURE_REASON = "event-log-lock-timeout" as const;

export interface CaptureFailureSnapshot {
  schemaVersion: typeof CAPTURE_FAILURE_SCHEMA_VERSION;
  reason: typeof CAPTURE_FAILURE_REASON;
  recordedAt: string;
}

export type CaptureFailureRead =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "current"; snapshot: CaptureFailureSnapshot };

function parseCaptureFailure(value: unknown): CaptureFailureSnapshot | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    record.schemaVersion !== CAPTURE_FAILURE_SCHEMA_VERSION ||
    record.reason !== CAPTURE_FAILURE_REASON ||
    typeof record.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(record.recordedAt)) ||
    new Date(record.recordedAt).toISOString() !== record.recordedAt
  ) {
    return null;
  }
  return record as unknown as CaptureFailureSnapshot;
}

/**
 * Constant-size, content-free evidence that at least one hook event was lost.
 * The first complete marker wins through an atomic hard-link create; later
 * failures leave that truthful evidence intact instead of racing to fabricate a
 * "latest" timestamp or growing an unbounded journal.
 */
export async function recordCaptureFailure(
  paths: EventLogPathContext,
  recordedAt: string = new Date().toISOString(),
): Promise<void> {
  const snapshot: CaptureFailureSnapshot = {
    schemaVersion: CAPTURE_FAILURE_SCHEMA_VERSION,
    reason: CAPTURE_FAILURE_REASON,
    recordedAt,
  };
  const temporary = `${paths.captureFailure}.${randomUUID()}.tmp`;
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(snapshot), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, paths.captureFailure);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } catch (error) {
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function readCaptureFailure(
  paths: EventLogPathContext = resolveEventLogPathContext(),
): CaptureFailureRead {
  if (!existsSync(paths.captureFailure)) return { kind: "missing" };
  try {
    const snapshot = parseCaptureFailure(
      JSON.parse(readFileSync(paths.captureFailure, "utf8")),
    );
    return snapshot === null
      ? { kind: "invalid" }
      : { kind: "current", snapshot };
  } catch {
    return { kind: "invalid" };
  }
}
