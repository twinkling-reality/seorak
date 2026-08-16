import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
} from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LIFECYCLE_VERSION = 1;
const LIFECYCLE_KIND = "seorak-collector-lifecycle";
const OWNER_KIND = "seorak-collector-state";
const OWNER_FILE = ".seorak-state.json";
const DAEMON_OWNER_FILE = ".daemon-owner.json";
// Keeps the longest lifecycle companion candidate + durable temp name below
// the portable 255-byte NAME_MAX while leaving room for UUID claimant tokens.
const PROCESS_OWNER_TOKEN_MAX = 58;
const PROCESS_OWNER_TOKEN_PATTERN = `[A-Za-z0-9_-]{1,${PROCESS_OWNER_TOKEN_MAX}}`;

class CollectorLifecycleBusyError extends Error {}

export type CollectorLifecyclePhase =
  | "active"
  | "purge-requested"
  | "service-stopped"
  | "hooks-removed"
  | "state-renamed"
  | "purged";

interface CollectorLifecycleRecord {
  kind: typeof LIFECYCLE_KIND;
  version: typeof LIFECYCLE_VERSION;
  stateKey: string;
  phase: CollectorLifecyclePhase;
  token: string;
  tombstone?: string;
  device?: number;
  inode?: number;
}

interface CollectorOwnerRecord {
  kind: typeof OWNER_KIND;
  version: typeof LIFECYCLE_VERSION;
  stateKey: string;
}

interface ProcessOwnerRecord {
  pid: number;
  token: string;
  claimVersion?: 1;
}

interface ProcessOwnerSnapshot extends ProcessOwnerRecord {
  device: number;
  inode: number;
}

type ProcessOwnerInspection =
  | { kind: "absent" }
  | { kind: "changed" }
  | { kind: "invalid" }
  | { kind: "valid"; owner: ProcessOwnerSnapshot };

export interface CollectorLifecyclePaths {
  stateDir: string;
  stateKey: string;
  controlDir: string;
  lifecycle: string;
  lock: string;
  owner: string;
  daemonOwner: string;
  hookLeases: string;
}

export interface PurgePlan extends CollectorLifecyclePaths {
  stateExists: boolean;
  phase: CollectorLifecyclePhase | "absent";
  tombstone: string | null;
}

export interface LifecycleEnvironment {
  homeDir?: string;
  cwd?: string;
  controlDir?: string;
}

export interface PurgeFilesystem {
  removeDirectory?: (path: string) => void;
}

function stateKey(stateDir: string): string {
  return createHash("sha256").update(stateDir).digest("hex");
}

function configuredControlDir(homeDir: string): string {
  const configured = process.env.SEORAK_CONTROL_DIR;
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new Error("SEORAK_CONTROL_DIR must be an absolute path.");
    }
    return normalize(configured);
  }
  return join(homeDir, ".config", "seorak", "collector-lifecycle");
}

/**
 * Freeze every lifecycle path before taking a lock or mutating the filesystem.
 * The state key is a hash so the durable, outside-target revocation record never
 * copies a username, repo path, or any captured collector data.
 */
export function resolveCollectorLifecyclePaths(
  stateDir: string,
  environment: LifecycleEnvironment = {},
): CollectorLifecyclePaths {
  if (!stateDir || !isAbsolute(stateDir)) {
    throw new Error("SEORAK_DIR must be an absolute path.");
  }
  const resolvedStateDir = normalize(resolve(stateDir));
  if (
    existsSync(resolvedStateDir) &&
    lstatSync(resolvedStateDir).isSymbolicLink()
  ) {
    throw new Error("SEORAK_DIR must not be a symbolic link.");
  }
  const frozenStateDir = normalize(canonicalProspectivePath(resolvedStateDir));
  const homeDir = normalize(resolve(environment.homeDir ?? homedir()));
  if (
    environment.controlDir !== undefined &&
    !isAbsolute(environment.controlDir)
  ) {
    throw new Error(
      "collector lifecycle control directory must be an absolute path.",
    );
  }
  const controlDir = normalize(
    resolve(environment.controlDir ?? configuredControlDir(homeDir)),
  );
  const key = stateKey(frozenStateDir);
  return {
    stateDir: frozenStateDir,
    stateKey: key,
    controlDir,
    lifecycle: join(controlDir, `${key}.json`),
    lock: join(controlDir, `${key}.lock`),
    owner: join(frozenStateDir, OWNER_FILE),
    daemonOwner: join(frozenStateDir, DAEMON_OWNER_FILE),
    hookLeases: join(controlDir, `${key}.hooks`),
  };
}

function isPathEqualOrAncestor(ancestor: string, candidate: string): boolean {
  const rel = relative(ancestor, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve existing symlinked ancestors while retaining a possibly-absent tail. */
function canonicalProspectivePath(path: string): string {
  let cursor = path;
  const tail: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    tail.unshift(basename(cursor));
    cursor = parent;
  }
  const canonicalBase = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return join(canonicalBase, ...tail);
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseLifecycleRecord(
  paths: CollectorLifecyclePaths,
): CollectorLifecycleRecord | null {
  if (!existsSync(paths.lifecycle)) return null;
  const stat = lstatSync(paths.lifecycle);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `collector lifecycle record is not a regular file: ${paths.lifecycle}`,
    );
  }
  const raw = readJsonObject(paths.lifecycle);
  const phases: readonly CollectorLifecyclePhase[] = [
    "active",
    "purge-requested",
    "service-stopped",
    "hooks-removed",
    "state-renamed",
    "purged",
  ];
  if (
    raw.kind !== LIFECYCLE_KIND ||
    raw.version !== LIFECYCLE_VERSION ||
    raw.stateKey !== paths.stateKey ||
    typeof raw.token !== "string" ||
    raw.token.length === 0 ||
    typeof raw.phase !== "string" ||
    !phases.includes(raw.phase as CollectorLifecyclePhase) ||
    (raw.tombstone !== undefined &&
      (typeof raw.tombstone !== "string" ||
        basename(raw.tombstone) !== raw.tombstone)) ||
    (raw.device !== undefined && !Number.isSafeInteger(raw.device)) ||
    (raw.inode !== undefined && !Number.isSafeInteger(raw.inode))
  ) {
    throw new Error(
      `collector lifecycle record is invalid: ${paths.lifecycle}`,
    );
  }
  return raw as unknown as CollectorLifecycleRecord;
}

function parseOwnerRecord(
  paths: CollectorLifecyclePaths,
): CollectorOwnerRecord | null {
  if (!existsSync(paths.owner)) return null;
  const stat = lstatSync(paths.owner);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `collector state owner is not a regular file: ${paths.owner}`,
    );
  }
  const raw = readJsonObject(paths.owner);
  if (
    raw.kind !== OWNER_KIND ||
    raw.version !== LIFECYCLE_VERSION ||
    raw.stateKey !== paths.stateKey
  ) {
    throw new Error(`collector state owner is invalid: ${paths.owner}`);
  }
  return raw as unknown as CollectorOwnerRecord;
}

function syncDirectory(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EBADF")
      throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeDurableJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function writeLifecycleRecord(
  paths: CollectorLifecyclePaths,
  record: CollectorLifecycleRecord,
): void {
  writeDurableJson(paths.lifecycle, record);
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function inspectProcessOwner(path: string): ProcessOwnerInspection {
  let before: ReturnType<typeof lstatSync>;
  try {
    before = lstatSync(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "invalid" };
  }
  if (!before.isFile() || before.isSymbolicLink()) return { kind: "invalid" };

  let serialized: string;
  try {
    serialized = readFileSync(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "changed" }
      : { kind: "invalid" };
  }

  let after: ReturnType<typeof lstatSync>;
  try {
    after = lstatSync(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "changed" }
      : { kind: "invalid" };
  }
  if (before.dev !== after.dev || before.ino !== after.ino) {
    return { kind: "changed" };
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { kind: "invalid" };
    }
    const raw = parsed as Record<string, unknown>;
    if (
      !Number.isSafeInteger(raw.pid) ||
      (raw.pid as number) <= 0 ||
      typeof raw.token !== "string" ||
      raw.token.length === 0 ||
      raw.token.length > PROCESS_OWNER_TOKEN_MAX ||
      !/^[A-Za-z0-9_-]+$/.test(raw.token) ||
      (raw.claimVersion !== undefined && raw.claimVersion !== 1)
    ) {
      return { kind: "invalid" };
    }
    return {
      kind: "valid",
      owner: {
        pid: raw.pid as number,
        token: raw.token,
        ...(raw.claimVersion === 1 ? { claimVersion: 1 as const } : {}),
        device: after.dev,
        inode: after.ino,
      },
    };
  } catch {
    return { kind: "invalid" };
  }
}

function readProcessOwner(path: string): ProcessOwnerRecord | null {
  const inspection = inspectProcessOwner(path);
  return inspection.kind === "valid" ? inspection.owner : null;
}

function publishProcessOwner(
  path: string,
  owner: ProcessOwnerRecord,
): "published" | "exists" {
  const candidate = `${path}.${owner.pid}.${owner.token}.candidate`;
  try {
    writeDurableJson(candidate, owner);
    try {
      linkSync(candidate, path);
      syncDirectory(dirname(path));
      return "published";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
      throw error;
    }
  } finally {
    rmSync(candidate, { force: true });
  }
}

function exclusiveOwnerCompanion(path: string, token: string): string {
  return `${path}.${token}.owner`;
}

interface ReclaimAnchor {
  path: string;
  claimantPid: number;
}

type ReclaimAnchorInspection =
  | { kind: "absent" }
  | { kind: "changed" }
  | { kind: "invalid" }
  | { kind: "valid"; anchor: ReclaimAnchor };

interface OwnershipArtifact {
  kind: "companion" | "reclaim" | "candidate" | "temporary";
  ownerToken: string;
  actorPid?: number;
  incompleteAllowed?: boolean;
}

function reclaimAnchorPath(
  companionPath: string,
  claimantPid: number,
  claimantToken: string,
): string {
  return `${companionPath}.reclaim.${claimantPid}.${claimantToken}`;
}

function inspectReclaimAnchor(
  companionPath: string,
  expected: ProcessOwnerSnapshot,
): ReclaimAnchorInspection {
  const directory = dirname(companionPath);
  const prefix = `${basename(companionPath)}.reclaim.`;
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "invalid" };
  }
  const matches = entries.filter((entry) => entry.startsWith(prefix));
  if (matches.length === 0) return { kind: "absent" };
  if (matches.length !== 1) return { kind: "invalid" };

  const entry = matches[0]!;
  const identity = entry
    .slice(prefix.length)
    .match(
      new RegExp(`^([1-9][0-9]*)\\.(${PROCESS_OWNER_TOKEN_PATTERN})$`),
    );
  if (!identity) return { kind: "invalid" };
  const claimantPid = Number(identity[1]);
  if (!Number.isSafeInteger(claimantPid)) return { kind: "invalid" };

  const path = join(directory, entry);
  const inspection = inspectProcessOwner(path);
  if (inspection.kind === "absent" || inspection.kind === "changed") {
    return { kind: "changed" };
  }
  if (
    inspection.kind !== "valid" ||
    !sameOwner(inspection.owner, expected)
  ) {
    return { kind: "invalid" };
  }
  return {
    kind: "valid",
    anchor: { path, claimantPid },
  };
}

function parseOwnershipArtifact(
  canonicalPath: string,
  entry: string,
): OwnershipArtifact | null {
  const prefix = `${basename(canonicalPath)}.`;
  if (!entry.startsWith(prefix)) return null;
  const rest = entry.slice(prefix.length);
  const token = PROCESS_OWNER_TOKEN_PATTERN;

  let match = rest.match(new RegExp(`^(${token})\\.owner$`));
  if (match) return { kind: "companion", ownerToken: match[1]! };

  match = rest.match(
    new RegExp(
      `^(${token})\\.owner\\.reclaim\\.([1-9][0-9]*)\\.(${token})$`,
    ),
  );
  if (match) {
    const actorPid = Number(match[2]);
    return Number.isSafeInteger(actorPid)
      ? { kind: "reclaim", ownerToken: match[1]!, actorPid }
      : null;
  }

  match = rest.match(
    new RegExp(
      `^(${token})\\.owner\\.([1-9][0-9]*)\\.(${token})\\.candidate$`,
    ),
  );
  if (match && match[1] === match[3]) {
    const actorPid = Number(match[2]);
    return Number.isSafeInteger(actorPid)
      ? {
          kind: "candidate",
          ownerToken: match[1]!,
          actorPid,
          incompleteAllowed: true,
        }
      : null;
  }

  match = rest.match(
    new RegExp(
      `^(${token})\\.owner\\.([1-9][0-9]*)\\.(${token})\\.candidate\\.` +
        `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.tmp$`,
    ),
  );
  if (match && match[1] === match[3]) {
    const actorPid = Number(match[2]);
    return Number.isSafeInteger(actorPid)
      ? {
          kind: "temporary",
          ownerToken: match[1]!,
          actorPid,
          incompleteAllowed: true,
        }
      : null;
  }

  match = rest.match(new RegExp(`^(${token})\\.candidate$`));
  return match
    ? { kind: "candidate", ownerToken: match[1]! }
    : null;
}

function unlinkStableOwnershipArtifact(
  canonicalPath: string,
  artifactPath: string,
): void {
  let before: ReturnType<typeof lstatSync>;
  try {
    before = lstatSync(artifactPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) return;
  if (inspectProcessOwner(canonicalPath).kind !== "absent") return;
  let after: ReturnType<typeof lstatSync>;
  try {
    after = lstatSync(artifactPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (before.dev !== after.dev || before.ino !== after.ino) return;
  try {
    unlinkSync(artifactPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Publication and reclamation artifacts carry only PID/token owner records.
 * With no canonical authority, a complete artifact owned by a dead process is
 * unreachable state and can be removed without naming a later canonical owner.
 */
function reclaimOrphanedOwnershipArtifacts(path: string): void {
  if (inspectProcessOwner(path).kind !== "absent") return;
  const directory = dirname(path);
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const artifactIdentity = parseOwnershipArtifact(path, entry);
    if (!artifactIdentity) continue;
    const artifactPath = join(directory, entry);
    const artifact = inspectProcessOwner(artifactPath);
    const actorPid = artifactIdentity.actorPid;
    if (actorPid !== undefined && processIsAlive(actorPid)) continue;
    if (artifact.kind !== "valid") {
      if (
        artifactIdentity.incompleteAllowed === true &&
        actorPid !== undefined
      ) {
        unlinkStableOwnershipArtifact(path, artifactPath);
      }
      continue;
    }
    if (
      artifact.owner.token !== artifactIdentity.ownerToken ||
      (actorPid !== undefined &&
        artifactIdentity.kind !== "reclaim" &&
        artifact.owner.pid !== actorPid) ||
      processIsAlive(artifact.owner.pid)
    ) {
      continue;
    }
    unlinkStableOwnershipArtifact(path, artifactPath);
  }
  syncDirectory(directory);
}

/**
 * A retained token-specific hard link makes stale-owner reclamation a claim:
 * a contender atomically moves it to a claimant-specific path before removing
 * the canonical name. If that contender dies, a successor atomically transfers
 * the same inode anchor and continues; no recovery step can name a later owner.
 */
function publishExclusiveProcessOwner(
  path: string,
  owner: ProcessOwnerRecord,
): "published" | "exists" {
  reclaimOrphanedOwnershipArtifacts(path);
  const companion = exclusiveOwnerCompanion(path, owner.token);
  if (publishProcessOwner(companion, owner) === "exists") return "exists";
  let canonicalPublished = false;
  try {
    try {
      linkSync(companion, path);
      syncDirectory(dirname(path));
      canonicalPublished = true;
      return "published";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
      throw error;
    }
  } finally {
    if (!canonicalPublished) rmSync(companion, { force: true });
  }
}

function sameOwner(
  owner: ProcessOwnerSnapshot,
  expected: ProcessOwnerSnapshot,
): boolean {
  return (
    owner.device === expected.device &&
    owner.inode === expected.inode &&
    owner.pid === expected.pid &&
    owner.token === expected.token &&
    owner.claimVersion === expected.claimVersion
  );
}

function releaseExclusiveProcessOwner(path: string, token: string): void {
  const companionPath = exclusiveOwnerCompanion(path, token);
  const companion = inspectProcessOwner(companionPath);
  const canonical = inspectProcessOwner(path);
  if (
    companion.kind !== "valid" ||
    canonical.kind !== "valid" ||
    companion.owner.token !== token ||
    canonical.owner.token !== token ||
    companion.owner.claimVersion !== 1 ||
    canonical.owner.claimVersion !== 1 ||
    companion.owner.device !== canonical.owner.device ||
    companion.owner.inode !== canonical.owner.inode
  ) {
    return;
  }
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const confirmed = inspectProcessOwner(companionPath);
  if (
    confirmed.kind === "valid" &&
    confirmed.owner.token === token &&
    confirmed.owner.claimVersion === 1 &&
    confirmed.owner.device === companion.owner.device &&
    confirmed.owner.inode === companion.owner.inode
  ) {
    unlinkSync(companionPath);
  }
  syncDirectory(dirname(path));
}

function reclaimExclusiveProcessOwner(
  path: string,
  expected: ProcessOwnerSnapshot,
): "reclaimed" | "changed" | "invalid" {
  const companionPath = exclusiveOwnerCompanion(path, expected.token);
  if (processIsAlive(expected.pid)) return "changed";

  for (let attempt = 0; attempt < 3; attempt++) {
    const canonical = inspectProcessOwner(path);
    if (
      canonical.kind === "absent" ||
      canonical.kind === "changed" ||
      (canonical.kind === "valid" && !sameOwner(canonical.owner, expected))
    ) {
      return "changed";
    }
    if (canonical.kind !== "valid") return "invalid";

    const companion = inspectProcessOwner(companionPath);
    if (companion.kind === "valid") {
      if (!sameOwner(companion.owner, expected)) return "invalid";
      const claimPath = reclaimAnchorPath(
        companionPath,
        process.pid,
        randomUUID(),
      );
      try {
        renameSync(companionPath, claimPath);
        syncDirectory(dirname(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      return completeExclusiveOwnerReclaim(path, expected, claimPath);
    }
    if (companion.kind === "invalid") return "invalid";
    if (companion.kind === "changed") continue;

    const claim = inspectReclaimAnchor(companionPath, expected);
    if (claim.kind === "invalid") return "invalid";
    if (claim.kind === "changed") continue;
    if (claim.kind === "valid") {
      if (processIsAlive(claim.anchor.claimantPid)) return "changed";
      const transferredPath = reclaimAnchorPath(
        companionPath,
        process.pid,
        randomUUID(),
      );
      try {
        renameSync(claim.anchor.path, transferredPath);
        syncDirectory(dirname(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      return completeExclusiveOwnerReclaim(path, expected, transferredPath);
    }

    let linked = false;
    try {
      linkSync(path, companionPath);
      syncDirectory(dirname(path));
      linked = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOENT") continue;
      throw error;
    }
    const repaired = inspectProcessOwner(companionPath);
    if (
      repaired.kind !== "valid" ||
      !sameOwner(repaired.owner, expected)
    ) {
      if (linked) rmSync(companionPath, { force: true });
      return repaired.kind === "invalid" ? "invalid" : "changed";
    }
  }
  return "changed";
}

function completeExclusiveOwnerReclaim(
  path: string,
  expected: ProcessOwnerSnapshot,
  claimPath: string,
): "reclaimed" | "changed" | "invalid" {
  const claim = inspectProcessOwner(claimPath);
  const canonical = inspectProcessOwner(path);
  if (
    claim.kind !== "valid" ||
    canonical.kind !== "valid" ||
    !sameOwner(claim.owner, expected) ||
    !sameOwner(canonical.owner, expected)
  ) {
    return claim.kind === "invalid" || canonical.kind === "invalid"
      ? "invalid"
      : "changed";
  }
  if (processIsAlive(expected.pid)) return "changed";

  unlinkSync(path);
  syncDirectory(dirname(path));
  try {
    unlinkSync(claimPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  syncDirectory(dirname(path));
  return "reclaimed";
}

function removeOwnedFile(path: string, token: string): void {
  const owner = readProcessOwner(path);
  if (owner?.token !== token) return;
  unlinkSync(path);
  syncDirectory(dirname(path));
}

/**
 * Serialize init, uninstall, and hook-lease publication. A complete owner is
 * published through one hard link, while a retained token-specific companion
 * makes both release and dead-owner reclamation successor-safe.
 */
export function acquireCollectorLifecycleLock(
  paths: CollectorLifecyclePaths,
): () => void {
  mkdirSync(paths.controlDir, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const owner = {
    pid: process.pid,
    token,
    claimVersion: 1,
  } satisfies ProcessOwnerRecord;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (publishExclusiveProcessOwner(paths.lock, owner) === "published") {
      return () => releaseExclusiveProcessOwner(paths.lock, token);
    }
    const inspection = inspectProcessOwner(paths.lock);
    if (inspection.kind === "absent" || inspection.kind === "changed") continue;
    if (inspection.kind === "invalid") {
      throw new Error(
        "the Seorak lifecycle lock is incomplete or corrupt; refusing to reclaim it.",
      );
    }
    const existing = inspection.owner;
    if (processIsAlive(existing.pid)) {
      throw new CollectorLifecycleBusyError(
        "another Seorak lifecycle command is already running.",
      );
    }
    const reclaimed = reclaimExclusiveProcessOwner(paths.lock, existing);
    if (reclaimed === "invalid") {
      throw new Error(
        "the Seorak lifecycle lock is incomplete or corrupt; refusing to reclaim it.",
      );
    }
  }
  throw new CollectorLifecycleBusyError(
    "another Seorak lifecycle command is changing ownership.",
  );
}

export async function acquireHookCaptureLease(
  paths: CollectorLifecyclePaths,
  timeoutMs: number = 5_000,
): Promise<(() => void) | null> {
  const deadline = Date.now() + timeoutMs;
  try {
    const initial = parseLifecycleRecord(paths);
    if (initial !== null && initial.phase !== "active") return null;
    while (Date.now() <= deadline) {
      let releaseLifecycle: (() => void) | undefined;
      try {
        releaseLifecycle = acquireCollectorLifecycleLock(paths);
        const record = parseLifecycleRecord(paths);
        if (record !== null && record.phase !== "active") return null;

        mkdirSync(paths.hookLeases, { recursive: true, mode: 0o700 });
        const token = randomUUID();
        const leasePath = join(paths.hookLeases, `${token}.json`);
        const owner = { pid: process.pid, token } satisfies ProcessOwnerRecord;
        if (publishProcessOwner(leasePath, owner) !== "published") {
          throw new Error("collector hook lease collision.");
        }

        const confirmed = parseLifecycleRecord(paths);
        if (confirmed !== null && confirmed.phase !== "active") {
          removeOwnedFile(leasePath, token);
          return null;
        }
        return () => removeOwnedFile(leasePath, token);
      } catch (error) {
        if (!(error instanceof CollectorLifecycleBusyError)) throw error;
        const current = parseLifecycleRecord(paths);
        if (current !== null && current.phase !== "active") return null;
        await delay(5);
      } finally {
        releaseLifecycle?.();
      }
    }
    return null;
  } catch (error) {
    throw error;
  }
}

export function hookCaptureLeaseStatus(
  paths: CollectorLifecyclePaths,
): "clear" | "live" | "invalid" {
  if (!existsSync(paths.hookLeases)) return "clear";
  const directory = lstatSync(paths.hookLeases);
  if (!directory.isDirectory() || directory.isSymbolicLink()) return "invalid";
  let live = false;
  for (const name of readdirSync(paths.hookLeases)) {
    if (!name.endsWith(".json")) continue;
    const leasePath = join(paths.hookLeases, name);
    const owner = readProcessOwner(leasePath);
    if (!owner) {
      if (!existsSync(leasePath)) continue;
      return "invalid";
    }
    if (processIsAlive(owner.pid)) {
      live = true;
      continue;
    }
    try {
      unlinkSync(leasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "invalid";
    }
  }
  if (!live) {
    try {
      if (readdirSync(paths.hookLeases).length === 0) {
        rmSync(paths.hookLeases, { recursive: false });
      }
    } catch {
      // Another owner may be releasing concurrently; the next inspection proves it.
    }
  }
  return live ? "live" : "clear";
}

function validateSafeTarget(
  paths: CollectorLifecyclePaths,
  environment: LifecycleEnvironment,
): { canonical: string; exists: boolean } {
  const canonical = normalize(canonicalProspectivePath(paths.stateDir));
  const canonicalHome = normalize(
    canonicalProspectivePath(resolve(environment.homeDir ?? homedir())),
  );
  const canonicalCwd = normalize(
    canonicalProspectivePath(resolve(environment.cwd ?? process.cwd())),
  );
  const canonicalControl = normalize(
    canonicalProspectivePath(paths.controlDir),
  );
  if (
    canonical === parse(canonical).root ||
    isPathEqualOrAncestor(canonical, canonicalHome) ||
    isPathEqualOrAncestor(canonical, canonicalCwd) ||
    isPathEqualOrAncestor(canonical, canonicalControl)
  ) {
    throw new Error(`refusing unsafe collector state path: ${paths.stateDir}`);
  }

  if (!existsSync(paths.stateDir)) return { canonical, exists: false };
  const stat = lstatSync(paths.stateDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(
      `collector state path is not a real directory: ${paths.stateDir}`,
    );
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(
      `collector state path is not owned by the current user: ${paths.stateDir}`,
    );
  }
  return { canonical, exists: true };
}

function isDefaultStateDir(
  paths: CollectorLifecyclePaths,
  homeDir: string,
): boolean {
  return (
    paths.stateDir ===
    normalize(canonicalProspectivePath(resolve(homeDir, ".seorak")))
  );
}

/**
 * `setup` claims a directory before any hook, daemon, or durable runtime can
 * write to it. A custom pre-existing non-empty directory is never adopted
 * implicitly.
 */
export function claimCollectorState(
  paths: CollectorLifecyclePaths,
  environment: LifecycleEnvironment = {},
): void {
  const safe = validateSafeTarget(paths, environment);
  const homeDir = normalize(resolve(environment.homeDir ?? homedir()));
  if (!safe.exists) {
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  }
  const owner = parseOwnerRecord(paths);
  if (owner) return;
  if (
    safe.exists &&
    !isDefaultStateDir(paths, homeDir) &&
    readdirSync(paths.stateDir).length > 0
  ) {
    throw new Error(
      `refusing to claim non-empty custom collector state directory: ${paths.stateDir}`,
    );
  }
  writeDurableJson(paths.owner, {
    kind: OWNER_KIND,
    version: LIFECYCLE_VERSION,
    stateKey: paths.stateKey,
  } satisfies CollectorOwnerRecord);
}

export function assertCollectorCanInitialize(
  paths: CollectorLifecyclePaths,
): void {
  const record = parseLifecycleRecord(paths);
  if (record && record.phase !== "active" && record.phase !== "purged") {
    throw new Error(
      `collector purge is incomplete (${record.phase}); retry \`seorak uninstall --purge\` first.`,
    );
  }
}

export function activateCollectorState(paths: CollectorLifecyclePaths): void {
  writeLifecycleRecord(paths, {
    kind: LIFECYCLE_KIND,
    version: LIFECYCLE_VERSION,
    stateKey: paths.stateKey,
    phase: "active",
    token: randomUUID(),
  });
}

/**
 * Fast fail-closed gate for hook subprocesses and daemon startup. A malformed
 * record is treated as revoked; absence preserves pre-feature installations.
 */
export function collectorCaptureRevoked(
  stateDir: string,
  environment: LifecycleEnvironment = {},
): boolean {
  try {
    const paths = resolveCollectorLifecyclePaths(stateDir, environment);
    const record = parseLifecycleRecord(paths);
    return record !== null && record.phase !== "active";
  } catch {
    return true;
  }
}

export function planCollectorPurge(
  paths: CollectorLifecyclePaths,
  environment: LifecycleEnvironment = {},
): PurgePlan {
  const safe = validateSafeTarget(paths, environment);
  const record = parseLifecycleRecord(paths);
  const homeDir = normalize(resolve(environment.homeDir ?? homedir()));
  if (
    safe.exists &&
    !parseOwnerRecord(paths) &&
    !isDefaultStateDir(paths, homeDir)
  ) {
    throw new Error(
      `refusing to purge an unowned custom collector state directory: ${paths.stateDir}`,
    );
  }
  const tombstone =
    record?.tombstone !== undefined
      ? join(dirname(paths.stateDir), record.tombstone)
      : null;
  if (tombstone && existsSync(tombstone)) {
    const stat = lstatSync(tombstone);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`collector purge tombstone is unsafe: ${tombstone}`);
    }
  }
  return {
    ...paths,
    stateExists: safe.exists,
    phase: record?.phase ?? "absent",
    tombstone,
  };
}

export function beginCollectorPurge(
  paths: CollectorLifecyclePaths,
): CollectorLifecycleRecord {
  const current = parseLifecycleRecord(paths);
  if (current && current.phase !== "active" && current.phase !== "purged") {
    return current;
  }
  const stat = existsSync(paths.stateDir) ? lstatSync(paths.stateDir) : null;
  const next: CollectorLifecycleRecord = {
    kind: LIFECYCLE_KIND,
    version: LIFECYCLE_VERSION,
    stateKey: paths.stateKey,
    phase: "purge-requested",
    token: randomUUID(),
    ...(stat ? { device: stat.dev, inode: stat.ino } : {}),
  };
  writeLifecycleRecord(paths, next);
  return next;
}

export function advanceCollectorPurge(
  paths: CollectorLifecyclePaths,
  phase: Exclude<CollectorLifecyclePhase, "active" | "purge-requested">,
): void {
  const current = parseLifecycleRecord(paths);
  if (!current || current.phase === "active") {
    throw new Error("collector purge has not been requested.");
  }
  const order: readonly CollectorLifecyclePhase[] = [
    "active",
    "purge-requested",
    "service-stopped",
    "hooks-removed",
    "state-renamed",
    "purged",
  ];
  if (order.indexOf(phase) <= order.indexOf(current.phase)) return;
  writeLifecycleRecord(paths, { ...current, phase });
}

/**
 * Atomically removes the canonical state namespace before recursive deletion.
 * A failed rm leaves only the exact journal-bound tombstone for a safe retry.
 */
export function purgeCollectorStateDirectory(
  paths: CollectorLifecyclePaths,
  environment: LifecycleEnvironment = {},
  filesystem: PurgeFilesystem = {},
): void {
  const hookLeases = hookCaptureLeaseStatus(paths);
  if (hookLeases !== "clear") {
    throw new Error(
      hookLeases === "live"
        ? "collector hook capture is still active."
        : "collector hook ownership is invalid.",
    );
  }
  validateSafeTarget(paths, environment);
  let record = parseLifecycleRecord(paths);
  if (!record || record.phase === "active") {
    throw new Error("collector purge has not been requested.");
  }

  let tombstoneName = record.tombstone;
  if (!tombstoneName) {
    tombstoneName = `.seorak-purge-${record.token}`;
    record = { ...record, tombstone: tombstoneName };
    writeLifecycleRecord(paths, record);
  }
  const tombstone = join(dirname(paths.stateDir), tombstoneName);

  if (existsSync(paths.stateDir)) {
    if (existsSync(tombstone)) {
      throw new Error(`collector purge tombstone already exists: ${tombstone}`);
    }
    const before = lstatSync(paths.stateDir);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error(
        `collector state path changed during purge: ${paths.stateDir}`,
      );
    }
    if (
      record.device === undefined ||
      record.inode === undefined ||
      before.dev !== record.device ||
      before.ino !== record.inode
    ) {
      throw new Error(
        `collector state identity changed during purge: ${paths.stateDir}`,
      );
    }
    renameSync(paths.stateDir, tombstone);
    syncDirectory(dirname(paths.stateDir));
    const after = lstatSync(tombstone);
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.dev !== record.device ||
      after.ino !== record.inode
    ) {
      throw new Error(
        `collector state identity changed during purge: ${tombstone}`,
      );
    }
  }

  if (existsSync(tombstone)) {
    const stat = lstatSync(tombstone);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`collector purge tombstone is unsafe: ${tombstone}`);
    }
    if (
      record.device === undefined ||
      record.inode === undefined ||
      stat.dev !== record.device ||
      stat.ino !== record.inode
    ) {
      throw new Error(
        `collector purge tombstone identity changed: ${tombstone}`,
      );
    }
    advanceCollectorPurge(paths, "state-renamed");
    const removeDirectory =
      filesystem.removeDirectory ??
      ((path: string) => rmSync(path, { recursive: true }));
    removeDirectory(tombstone);
    syncDirectory(dirname(tombstone));
  }

  const completed = parseLifecycleRecord(paths);
  if (!completed)
    throw new Error("collector lifecycle record disappeared during purge.");
  const { tombstone: _removed, ...withoutTombstone } = completed;
  writeLifecycleRecord(paths, { ...withoutTombstone, phase: "purged" });
}

export function daemonLeaseStatus(
  paths: CollectorLifecyclePaths,
): "absent" | "stale" | "live" | "invalid" {
  if (!existsSync(paths.daemonOwner)) return "absent";
  const owner = readProcessOwner(paths.daemonOwner);
  if (!owner) return "invalid";
  return processIsAlive(owner.pid) ? "live" : "stale";
}

export function acquireDaemonLease(paths: CollectorLifecyclePaths): () => void {
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const owner = {
    pid: process.pid,
    token,
    claimVersion: 1,
  } satisfies ProcessOwnerRecord;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (
      publishExclusiveProcessOwner(paths.daemonOwner, owner) === "published"
    ) {
      return () => releaseExclusiveProcessOwner(paths.daemonOwner, token);
    }
    const inspection = inspectProcessOwner(paths.daemonOwner);
    if (inspection.kind === "absent" || inspection.kind === "changed") continue;
    if (inspection.kind === "invalid") {
      throw new Error(
        "collector daemon ownership is incomplete or corrupt; refusing to reclaim it.",
      );
    }
    const existing = inspection.owner;
    if (processIsAlive(existing.pid)) {
      throw new Error(
        `collector daemon is already running (pid ${existing.pid}).`,
      );
    }
    const reclaimed = reclaimExclusiveProcessOwner(paths.daemonOwner, existing);
    if (reclaimed === "invalid") {
      throw new Error(
        "collector daemon ownership is incomplete or corrupt; refusing to reclaim it.",
      );
    }
  }
  throw new Error("could not acquire the collector daemon lease.");
}
