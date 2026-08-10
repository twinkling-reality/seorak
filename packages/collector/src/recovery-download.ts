/**
 * recovery-download.ts — assembling the customer recovery bundle on the machine
 * that can actually read it.
 *
 * The cell serves the 30-day recovery window as five paginated endpoints, not as
 * a file: a manifest, three listings, and one request per encrypted archive
 * object. Something has to assemble those into the artifact
 * `local-and-managed-lifecycle.md` 1.8 promises, and this is that something.
 *
 * It belongs in the collector, not in a web page, for a reason that outlives the
 * convenience: the archive objects are AES-256-GCM ciphertext produced on this
 * computer, and this computer holds the only key. A browser on the billing
 * origin could fetch the bytes and would still be handing the customer something
 * it cannot open.
 *
 * **A partial bundle is a failed bundle.** The runbook is explicit that a
 * manifest naming an object the bundle lacks is a failure, not a partial
 * success, so the completion receipt is written last and only when every named
 * object has arrived and matched its digest. A directory without
 * `bundle.json` is an incomplete download, and nothing here rewrites the
 * manifest to agree with what happened to arrive.
 *
 * Nothing in this module decrypts. The plaintext record is the local history
 * that was never at risk, and `seorak local export` is the command that reads
 * it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoundedJsonResponse } from "./bounded-json-response.ts";

/** One listing page. Large enough to be few round trips, small enough that a
 *  retry costs little. The cell caps its own page size regardless. */
const PAGE_SIZE = 200;
const REQUEST_TIMEOUT_MS = 30_000;
/** A listing page is summary JSON. An archive object is not read through this
 *  path at all, so this bound never applies to ciphertext. */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Refuses a runaway cursor loop rather than paging forever on a cell that
 *  keeps handing back a continuation. */
const MAX_PAGES = 10_000;

export interface RecoveryDownloadInput {
  /** Origin of the owner cell, from the mint response's `cellUrl`. */
  cellUrl: string;
  /** The one-time grant. Never written to the bundle, and never logged. */
  token: string;
  /** Directory to assemble into. Must not already hold a bundle. */
  outputDir: string;
  fetchImpl?: typeof fetch;
  nowIso?: () => string;
}

export interface RecoveryBundleCounts {
  sessions: number;
  hours: number;
  archives: number;
}

export type RecoveryDownloadResult =
  | {
      ok: true;
      bundlePath: string;
      counts: RecoveryBundleCounts;
      archiveCiphertextBytes: number;
    }
  | {
      ok: false;
      /**
       * Why it stopped, as a closed set the CLI can speak about precisely.
       *
       * `grant-invalid` and `copy-deleted` are different facts and must not be
       * merged: one means this token no longer opens the window, the other means
       * the window closed and the managed copy is gone.
       */
      reason:
        | "grant-invalid"
        | "copy-deleted"
        | "cell-unreachable"
        | "archive-unavailable"
        | "incomplete"
        | "output-not-empty";
      detail: string;
      /** Where the incomplete attempt was left, when one was started. */
      partialPath: string | null;
    };

function normalizedCellUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
): Promise<Response> {
  return fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

type StopReason = Exclude<
  Extract<RecoveryDownloadResult, { ok: false }>["reason"],
  "output-not-empty"
>;

/**
 * Plain fields rather than constructor parameter properties: the collector runs
 * under Node's `--experimental-strip-types`, which erases annotations and does
 * not synthesize the assignments a parameter property implies.
 */
class RecoveryStop extends Error {
  reason: StopReason;
  detail: string;

  constructor(reason: StopReason, detail: string) {
    super(detail);
    this.reason = reason;
    this.detail = detail;
  }
}

/** Map a cell refusal to the fact it states. The cell answers `401` for a grant
 *  it will not honor and `410` once the copy is deleted. */
function stopForStatus(status: number, path: string): RecoveryStop {
  if (status === 401) {
    return new RecoveryStop(
      "grant-invalid",
      "the recovery grant was refused; it may be expired, revoked, or for another home",
    );
  }
  if (status === 410) {
    return new RecoveryStop(
      "copy-deleted",
      "the recovery window has closed and the managed copy is deleted",
    );
  }
  return new RecoveryStop(
    "cell-unreachable",
    `${path} answered ${status}`,
  );
}

async function getJson(
  fetchImpl: typeof fetch,
  base: string,
  path: string,
  token: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await timedFetch(fetchImpl, `${base}${path}`, token);
  } catch {
    throw new RecoveryStop("cell-unreachable", `${path} could not be reached`);
  }
  if (!response.ok) throw stopForStatus(response.status, path);
  const body = await readBoundedJsonResponse(response, MAX_PAGE_BYTES);
  if (body === null || typeof body !== "object") {
    throw new RecoveryStop("cell-unreachable", `${path} returned unreadable JSON`);
  }
  return body as Record<string, unknown>;
}

async function collectListing(
  fetchImpl: typeof fetch,
  base: string,
  resource: "sessions" | "hours" | "archives",
  token: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = `?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = await getJson(
      fetchImpl,
      base,
      `/recovery/v1/${resource}${query}`,
      token,
    );
    if (!Array.isArray(body.items)) {
      throw new RecoveryStop(
        "cell-unreachable",
        `/recovery/v1/${resource} returned no item list`,
      );
    }
    items.push(...body.items);
    const next = body.nextCursor;
    if (typeof next !== "string" || next === "") return items;
    cursor = next;
  }
  throw new RecoveryStop(
    "cell-unreachable",
    `/recovery/v1/${resource} did not stop paging`,
  );
}

interface ArchivePointer {
  archiveId: string;
  objectPath: string;
  ciphertextDigest: string;
}

/**
 * Read the pointer fields this download depends on.
 *
 * An unrecognized pointer is a stop, not a skip. Skipping one would produce a
 * bundle that is missing an object the manifest counts, which is the exact
 * failure this module refuses to call success.
 */
function archivePointer(value: unknown): ArchivePointer {
  const row = value as Record<string, unknown> | null;
  const archiveId = row?.archiveId;
  const objectPath = row?.objectPath;
  const digest = row?.ciphertextDigest;
  if (
    typeof archiveId !== "string" ||
    typeof objectPath !== "string" ||
    typeof digest !== "string" ||
    !/^\/recovery\/v1\/archives\/[A-Za-z0-9._-]+$/.test(objectPath)
  ) {
    throw new RecoveryStop(
      "incomplete",
      "an archive listing row did not name an object this version can fetch",
    );
  }
  return { archiveId, objectPath, ciphertextDigest: digest };
}

/**
 * Fetch one ciphertext object and prove it is the one the listing named.
 *
 * The digest is checked against the listing rather than only against the
 * response header, so a cell that served the wrong bytes and a matching header
 * still fails. The customer spends their own key on this later; they should not
 * spend it on bytes nobody verified.
 */
async function downloadArchive(
  fetchImpl: typeof fetch,
  base: string,
  pointer: ArchivePointer,
  token: string,
  directory: string,
): Promise<number> {
  let response: Response;
  try {
    response = await timedFetch(fetchImpl, `${base}${pointer.objectPath}`, token);
  } catch {
    throw new RecoveryStop(
      "archive-unavailable",
      `archive ${pointer.archiveId} could not be reached`,
    );
  }
  if (response.status === 503) {
    // The pointer exists and the object store does not. That is unreachable,
    // never "your archive is gone".
    throw new RecoveryStop(
      "archive-unavailable",
      `archive ${pointer.archiveId} is temporarily unavailable at the cell`,
    );
  }
  if (!response.ok) throw stopForStatus(response.status, pointer.objectPath);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pointer.ciphertextDigest) {
    throw new RecoveryStop(
      "incomplete",
      `archive ${pointer.archiveId} did not match the digest the manifest named`,
    );
  }
  writeFileSync(join(directory, `${pointer.archiveId}.bin`), bytes, {
    mode: 0o600,
  });
  return bytes.byteLength;
}

/** Whether the target already holds something. Kept separate from creating the
 *  directory so a permission failure is never reported as "not empty". */
function outputIsOccupied(outputDir: string): boolean {
  return existsSync(outputDir) && readdirSync(outputDir).length > 0;
}

function countOf(manifest: Record<string, unknown>, key: string): number {
  const counts = manifest.counts as Record<string, unknown> | undefined;
  const value = counts?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

/**
 * Download the managed recovery bundle.
 *
 * Order is deliberate: the manifest first, because it is the statement of what
 * the bundle must contain, and the receipt last, because it is the only claim
 * that the bundle contains it.
 */
export async function downloadRecoveryBundle(
  input: RecoveryDownloadInput,
): Promise<RecoveryDownloadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const nowIso = input.nowIso ?? (() => new Date().toISOString());
  let base: string;
  try {
    base = normalizedCellUrl(input.cellUrl);
  } catch {
    return {
      ok: false,
      reason: "cell-unreachable",
      detail: "the cell URL is not a valid absolute URL",
      partialPath: null,
    };
  }
  if (outputIsOccupied(input.outputDir)) {
    // Overwriting in place could leave one download's objects beside another's
    // manifest, and the receipt would describe neither.
    return {
      ok: false,
      reason: "output-not-empty",
      detail: "the output directory already holds files; choose an empty path",
      partialPath: null,
    };
  }
  mkdirSync(join(input.outputDir, "archives"), { recursive: true, mode: 0o700 });

  try {
    const manifest = await getJson(
      fetchImpl,
      base,
      "/recovery/v1/manifest",
      input.token,
    );
    writeFileSync(
      join(input.outputDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );

    const sessions = await collectListing(fetchImpl, base, "sessions", input.token);
    const hours = await collectListing(fetchImpl, base, "hours", input.token);
    const archives = await collectListing(fetchImpl, base, "archives", input.token);
    writeFileSync(
      join(input.outputDir, "sessions.json"),
      `${JSON.stringify(sessions, null, 2)}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      join(input.outputDir, "hours.json"),
      `${JSON.stringify(hours, null, 2)}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      join(input.outputDir, "archives.json"),
      `${JSON.stringify(archives, null, 2)}\n`,
      { mode: 0o600 },
    );

    // Every listing is checked against the manifest it came with. A cell that
    // enumerated fewer rows than it counted has not handed over the copy it
    // says it holds, and calling that a download would be the lie this whole
    // window exists to avoid.
    for (const [key, listed] of [
      ["sessions", sessions.length],
      ["hours", hours.length],
      ["archives", archives.length],
    ] as const) {
      const counted = countOf(manifest, key);
      if (counted !== listed) {
        return {
          ok: false,
          reason: "incomplete",
          detail: `the manifest counts ${counted} ${key} and the listing returned ${listed}`,
          partialPath: input.outputDir,
        };
      }
    }

    let archiveCiphertextBytes = 0;
    for (const row of archives) {
      archiveCiphertextBytes += await downloadArchive(
        fetchImpl,
        base,
        archivePointer(row),
        input.token,
        join(input.outputDir, "archives"),
      );
    }

    const counts: RecoveryBundleCounts = {
      sessions: sessions.length,
      hours: hours.length,
      archives: archives.length,
    };
    // Written last, and only here. Its presence is the completeness claim.
    writeFileSync(
      join(input.outputDir, "bundle.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          completedAt: nowIso(),
          counts,
          archiveCiphertextBytes,
          archivesRequireLocalKey: true,
          archiveEncryption: "aes-256-gcm",
          authoritativeCopy: "local-history",
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    return {
      ok: true,
      bundlePath: input.outputDir,
      counts,
      archiveCiphertextBytes,
    };
  } catch (error) {
    if (error instanceof RecoveryStop) {
      return {
        ok: false,
        reason: error.reason,
        detail: error.detail,
        partialPath: input.outputDir,
      };
    }
    throw error;
  }
}
