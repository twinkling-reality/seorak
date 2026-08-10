import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { daemonLogArchivePath, daemonLogPath } from "./paths.ts";

/** One bounded current generation plus one bounded archive. */
export const DAEMON_LOG_MAX_BYTES = 8 * 1024 * 1024;
const COPY_BUFFER_BYTES = 64 * 1024;

export interface DaemonLogRotationResult {
  rotated: boolean;
  bytesArchived: number;
  bytesDiscarded: number;
}

function syncDirectory(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EBADF") throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sameFile(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Publish a durable bounded backup, then truncate the exact source inode in
 * place. launchd opens stdout/stderr before the daemon runs, so rename rotation
 * would strand those held descriptors on the old inode.
 */
export function rotateDaemonLogIfNeeded(options: {
  logPath?: string;
  archivePath?: string;
  maxBytes?: number;
} = {}): DaemonLogRotationResult {
  const logPath = options.logPath ?? daemonLogPath();
  const archivePath = options.archivePath ?? daemonLogArchivePath();
  const maxBytes = options.maxBytes ?? DAEMON_LOG_MAX_BYTES;
  if (logPath === archivePath) {
    throw new Error("daemon log and archive paths must be different");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("daemon log maxBytes must be a positive safe integer");
  }

  let source: number | undefined;
  let temporary: string | undefined;
  try {
    try {
      source = openSync(logPath, "r+");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { rotated: false, bytesArchived: 0, bytesDiscarded: 0 };
      }
      throw error;
    }

    const before = fstatSync(source);
    if (!before.isFile()) {
      throw new Error(`daemon log is not a regular file: ${logPath}`);
    }
    if (before.size <= maxBytes) {
      return { rotated: false, bytesArchived: 0, bytesDiscarded: 0 };
    }

    const pathStat = lstatSync(logPath);
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || !sameFile(before, pathStat)) {
      throw new Error(`daemon log path identity changed: ${logPath}`);
    }

    temporary = `${archivePath}.${process.pid}.${randomUUID()}.tmp`;
    const destination = openSync(temporary, "wx", 0o600);
    try {
      const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, maxBytes));
      let sourceOffset = before.size - maxBytes;
      let remaining = maxBytes;
      while (remaining > 0) {
        const length = Math.min(buffer.length, remaining);
        const read = readSync(source, buffer, 0, length, sourceOffset);
        if (read <= 0) {
          throw new Error("daemon log changed while its archive was being copied");
        }
        let written = 0;
        while (written < read) {
          const bytes = writeSync(destination, buffer, written, read - written);
          if (bytes <= 0) {
            throw new Error("daemon log archive write made no progress");
          }
          written += bytes;
        }
        sourceOffset += read;
        remaining -= read;
      }
      fsyncSync(destination);
    } finally {
      closeSync(destination);
    }

    const afterCopy = fstatSync(source);
    const currentPath = lstatSync(logPath);
    if (
      afterCopy.size !== before.size ||
      !sameFile(before, afterCopy) ||
      currentPath.isSymbolicLink() ||
      !currentPath.isFile() ||
      !sameFile(before, currentPath)
    ) {
      throw new Error("daemon log changed while its archive was being copied");
    }

    renameSync(temporary, archivePath);
    temporary = undefined;
    syncDirectory(dirname(archivePath));

    // Archive publication is durable before this destructive step. ftruncate
    // keeps launchd's already-open stdout/stderr descriptors on the same inode.
    ftruncateSync(source, 0);
    fsyncSync(source);
    return {
      rotated: true,
      bytesArchived: maxBytes,
      bytesDiscarded: before.size - maxBytes,
    };
  } finally {
    if (source !== undefined) closeSync(source);
    if (temporary) rmSync(temporary, { force: true });
  }
}
