import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  acknowledgedEventLogPath,
  resolveEventLogPathContext,
  type EventLogPathContext,
} from "./paths.ts";

/** Healthy collectors roll over after both consumers acknowledge 16 MiB. */
export const EVENT_LOG_COMPACTION_BYTES = 16 * 1024 * 1024;
const LOCK_RETRY_MS = 10;
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_OWNER_PREFIX = "owner-";
const LOCK_OWNER_SUFFIX = ".json";

interface LockOwner {
  version: 1;
  pid: number;
  token: string;
  at: number;
}

export interface EventLogLockOptions {
  waitMs?: number;
  retryMs?: number;
  staleMs?: number;
}

export class EventLogLockTimeoutError extends Error {
  readonly lockPath: string;
  readonly waitMs: number;

  constructor(lockPath: string, waitMs: number) {
    super("timed out waiting for the local event-log writer");
    this.name = "EventLogLockTimeoutError";
    this.lockPath = lockPath;
    this.waitMs = waitMs;
  }
}

const localLockTails = new Map<string, Promise<void>>();

/**
 * Collapse same-process contenders before they reach the filesystem mutex.
 * Hook processes still coordinate through the durable lock, while daemon
 * bursts avoid a polling herd whose unlucky tail can exceed the hook budget.
 */
async function serializeLocally<T>(
  lockPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = localLockTails.get(lockPath) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => turn);
  localLockTails.set(lockPath, tail);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (localLockTails.get(lockPath) === tail) {
      localLockTails.delete(lockPath);
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function ownerPid(value: unknown): number | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { pid?: unknown }).pid !== "number" ||
    !Number.isInteger((value as { pid: number }).pid) ||
    (value as { pid: number }).pid <= 0
  ) {
    return null;
  }
  return (value as { pid: number }).pid;
}

async function readOwnerPid(path: string): Promise<number | null> {
  try {
    return ownerPid(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function pathAgeMs(path: string): Promise<number | null> {
  try {
    return Math.max(0, Date.now() - (await stat(path)).mtimeMs);
  } catch {
    return null;
  }
}

async function removeLockDirectory(
  lockPath: string,
  entries: readonly string[],
): Promise<boolean> {
  let removedEntry = false;
  for (const entry of entries) {
    try {
      await unlink(join(lockPath, entry));
      removedEntry = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
  }
  // Another recovery may have removed the observed owner and a successor may
  // already occupy the canonical directory. Never rmdir that successor.
  if (entries.length > 0 && !removedEntry) return false;
  try {
    await rmdir(lockPath);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Recover only a demonstrably dead owner, or malformed state that has remained
 * unchanged past the abandonment window. Age alone never licenses stealing
 * from a live PID: event-log rollover can legitimately outlast 30 seconds.
 *
 * A legacy file lock from pre-token collectors remains readable for a safe
 * cutover. It is removed only after its PID is dead (or malformed and stale).
 */
async function recoverAbandonedLock(
  lockPath: string,
  staleMs: number,
): Promise<boolean> {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }

  if (!lockStat.isDirectory()) {
    const pid = await readOwnerPid(lockPath);
    if (pid !== null) {
      if (isProcessAlive(pid)) return false;
      try {
        await unlink(lockPath);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT";
      }
    }
    if (Date.now() - lockStat.mtimeMs <= staleMs) return false;
    try {
      await unlink(lockPath);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }

  let entries: string[];
  try {
    entries = await readdir(lockPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }

  let sawDeadOwner = false;
  for (const entry of entries) {
    const pid = await readOwnerPid(join(lockPath, entry));
    if (pid === null) continue;
    if (isProcessAlive(pid)) return false;
    sawDeadOwner = true;
  }
  if (!sawDeadOwner) {
    const ageMs = await pathAgeMs(lockPath);
    if (ageMs === null) return true;
    if (ageMs <= staleMs) return false;
  }
  return removeLockDirectory(lockPath, entries);
}

async function acquireLock(
  paths: EventLogPathContext,
  options: EventLogLockOptions,
): Promise<{ ownerPath: string }> {
  const waitMs = Math.max(0, options.waitMs ?? LOCK_WAIT_MS);
  const retryMs = Math.max(1, options.retryMs ?? LOCK_RETRY_MS);
  const staleMs = Math.max(0, options.staleMs ?? LOCK_STALE_MS);
  const deadline = Date.now() + waitMs;
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });

  while (true) {
    const token = randomUUID();
    const ownerPath = join(
      paths.lock,
      `${LOCK_OWNER_PREFIX}${token}${LOCK_OWNER_SUFFIX}`,
    );
    try {
      await mkdir(paths.lock, { mode: 0o700 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (await recoverAbandonedLock(paths.lock, staleMs)) continue;
      if (Date.now() >= deadline) {
        throw new EventLogLockTimeoutError(paths.lock, waitMs);
      }
      await delay(retryMs);
      continue;
    }

    const owner: LockOwner = {
      version: 1,
      pid: process.pid,
      token,
      at: Date.now(),
    };
    try {
      const handle = await open(ownerPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(owner), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { ownerPath };
    } catch (error) {
      await unlink(ownerPath).catch(() => {});
      await rmdir(paths.lock).catch(() => {});
      throw error;
    }
  }
}

/**
 * Token-specific cleanup cannot remove a successor lock. If stale recovery
 * replaced this owner's directory, its token path is absent and rmdir refuses
 * to remove the non-empty replacement.
 */
async function releaseLock(
  lockPath: string,
  ownerPath: string,
): Promise<void> {
  try {
    await unlink(ownerPath);
  } catch (error) {
    // A missing token means stale recovery already superseded this owner.
    // Its replacement is not ours to remove.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    await rmdir(lockPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
  }
}

export async function withEventLogLock<T>(
  paths: EventLogPathContext,
  operation: () => Promise<T>,
  options: EventLogLockOptions = {},
): Promise<T> {
  return serializeLocally(paths.lock, async () => {
    const ownership = await acquireLock(paths, options);
    try {
      return await operation();
    } finally {
      await releaseLock(paths.lock, ownership.ownerPath);
    }
  });
}

export async function appendEventLine(
  line: string,
  paths: EventLogPathContext = resolveEventLogPathContext(),
  lockOptions: EventLogLockOptions = {},
  beforeAppend?: () => void | Promise<void>,
): Promise<void> {
  await withEventLogLock(
    paths,
    async () => {
      await beforeAppend?.();
      await appendFile(paths.events, line, {
        encoding: "utf8",
        mode: 0o600,
      });
    },
    lockOptions,
  );
}

export async function readEventLogGeneration(
  paths: EventLogPathContext = resolveEventLogPathContext(),
): Promise<number> {
  try {
    const value = Number((await readFile(paths.generation, "utf8")).trim());
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function writeEventLogGeneration(
  paths: EventLogPathContext,
  generation: number,
): Promise<void> {
  const temporary = `${paths.generation}.${randomUUID()}.tmp`;
  await writeFile(temporary, String(generation), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, paths.generation);
}

async function recoverAcknowledgedGenerationsUnlocked(
  paths: EventLogPathContext,
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(paths.directory);
  } catch {
    return 0;
  }
  const acknowledged = names
    .map((name) => {
      const match = /^events\.acknowledged\.(\d+)\.jsonl$/.exec(name);
      return match ? Number(match[1]) : null;
    })
    .filter(
      (generation): generation is number =>
        generation !== null && Number.isSafeInteger(generation),
    )
    .sort((left, right) => left - right);
  if (acknowledged.length === 0) return 0;

  const newest = acknowledged.at(-1)!;
  const current = await readEventLogGeneration(paths);
  if (newest > current) await writeEventLogGeneration(paths, newest);
  for (const generation of acknowledged) {
    await unlink(acknowledgedEventLogPath(paths, generation)).catch(() => {});
  }
  return acknowledged.length;
}

/**
 * Complete cleanup after a process died between rotating an acknowledged file
 * and removing it. These archives are named only while both durable consumers
 * are exactly at EOF, so recovery never guesses whether data was consumed.
 */
export async function recoverAcknowledgedEventLogs(): Promise<number> {
  const paths = resolveEventLogPathContext();
  return withEventLogLock(paths, () =>
    recoverAcknowledgedGenerationsUnlocked(paths),
  );
}

export async function eventLogNeedsCompaction(
  minimumBytes: number = EVENT_LOG_COMPACTION_BYTES,
): Promise<boolean> {
  const paths = resolveEventLogPathContext();
  try {
    return (await stat(paths.events)).size >= minimumBytes;
  } catch {
    return false;
  }
}

export interface EventLogCompactionResult {
  compacted: boolean;
  bytesReclaimed: number;
  generation: number;
  reason?: "below-threshold" | "shipping-behind" | "attribution-behind";
}

/**
 * Rotate only when shipping and attribution have both acknowledged the exact
 * current EOF. Hooks share the same short-lived lock, so no append can land in
 * the retired generation after that proof. Offsets intentionally remain at the
 * prior EOF: both readers already implement shrink recovery and reset to zero
 * before consuming the new generation.
 */
export async function compactAcknowledgedEventLog(options: {
  shippingOffset: number;
  attributionOffset: number;
  minimumBytes?: number;
}): Promise<EventLogCompactionResult> {
  const paths = resolveEventLogPathContext();
  return withEventLogLock(paths, async () => {
    await recoverAcknowledgedGenerationsUnlocked(paths);
    const generation = await readEventLogGeneration(paths);
    const minimumBytes =
      options.minimumBytes ?? EVENT_LOG_COMPACTION_BYTES;
    let size: number;
    try {
      size = (await stat(paths.events)).size;
    } catch {
      return { compacted: false, bytesReclaimed: 0, generation };
    }
    if (size < minimumBytes) {
      return {
        compacted: false,
        bytesReclaimed: 0,
        generation,
        reason: "below-threshold",
      };
    }
    if (options.shippingOffset !== size) {
      return {
        compacted: false,
        bytesReclaimed: 0,
        generation,
        reason: "shipping-behind",
      };
    }
    if (options.attributionOffset !== size) {
      return {
        compacted: false,
        bytesReclaimed: 0,
        generation,
        reason: "attribution-behind",
      };
    }

    const nextGeneration = generation + 1;
    const acknowledgedPath = acknowledgedEventLogPath(
      paths,
      nextGeneration,
    );
    await rename(paths.events, acknowledgedPath);
    try {
      await writeFile(paths.events, "", {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await writeEventLogGeneration(paths, nextGeneration);
    } catch (error) {
      await unlink(paths.events).catch(() => {});
      await rename(acknowledgedPath, paths.events).catch(() => {});
      throw error;
    }
    await unlink(acknowledgedPath).catch(() => {});
    return {
      compacted: true,
      bytesReclaimed: size,
      generation: nextGeneration,
    };
  });
}
