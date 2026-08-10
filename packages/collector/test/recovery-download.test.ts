import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { downloadRecoveryBundle } from "../src/recovery-download.ts";

const directories: string[] = [];

function scratch(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-recovery-"));
  directories.push(path);
  return join(path, "bundle");
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

const ARCHIVE_ONE = new TextEncoder().encode("ciphertext-one");
const ARCHIVE_TWO = new TextEncoder().encode("ciphertext-two");

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pointer(id: string, bytes: Uint8Array): Record<string, unknown> {
  return {
    archiveId: id,
    objectPath: `/recovery/v1/archives/${id}`,
    ciphertextDigest: digestOf(bytes),
    ciphertextBytes: bytes.byteLength,
    algorithm: "aes-256-gcm",
    compression: "gzip",
  };
}

/**
 * A cell that answers the five recovery endpoints.
 *
 * Overrides let one test change exactly one answer, so a failure case differs
 * from the passing case by the thing being asserted and nothing else.
 */
function cell(
  overrides: {
    manifestCounts?: { sessions: number; hours: number; archives: number };
    sessions?: unknown[];
    hours?: unknown[];
    archives?: Record<string, unknown>[];
    objects?: Record<string, Uint8Array>;
    status?: (path: string) => number | null;
  } = {},
): typeof fetch {
  const sessions = overrides.sessions ?? [{ streamId: "s-1" }];
  const hours = overrides.hours ?? [{ hour: "2026-08-03T17" }];
  const archives = overrides.archives ?? [
    pointer("a-1", ARCHIVE_ONE),
    pointer("a-2", ARCHIVE_TWO),
  ];
  const objects = overrides.objects ?? {
    "a-1": ARCHIVE_ONE,
    "a-2": ARCHIVE_TWO,
  };
  const counts = overrides.manifestCounts ?? {
    sessions: sessions.length,
    hours: hours.length,
    archives: archives.length,
  };
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const forced = overrides.status?.(url.pathname);
    if (forced !== null && forced !== undefined) {
      return new Response(JSON.stringify({ error: "refused" }), {
        status: forced,
      });
    }
    if (url.pathname === "/recovery/v1/manifest") {
      return Response.json({
        schemaVersion: 1,
        ownerId: "owner-test",
        counts: { ...counts, receipts: 0 },
        encryption: {
          archives: "aes-256-gcm",
          serviceCanDecryptArchives: false,
          archiveKeyHolder: "customer-machine",
        },
        completeness: { authoritativeCopy: "local-history" },
      });
    }
    if (url.pathname === "/recovery/v1/sessions") {
      return Response.json({ items: sessions, nextCursor: null });
    }
    if (url.pathname === "/recovery/v1/hours") {
      return Response.json({ items: hours, nextCursor: null });
    }
    if (url.pathname === "/recovery/v1/archives") {
      return Response.json({ items: archives, nextCursor: null });
    }
    const archiveId = /^\/recovery\/v1\/archives\/(.+)$/.exec(url.pathname)?.[1];
    const object = archiveId ? objects[archiveId] : undefined;
    if (!object) return new Response(null, { status: 404 });
    return new Response(object, { status: 200 });
  }) as typeof fetch;
}

describe("customer recovery download", () => {
  it("writes the manifest, every listing, and every named ciphertext object", async () => {
    const outputDir = scratch();

    const result = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787/",
      token: "grant-token",
      outputDir,
      fetchImpl: cell(),
      nowIso: () => "2026-08-03T19:00:00.000Z",
    });

    expect(result).toMatchObject({
      ok: true,
      counts: { sessions: 1, hours: 1, archives: 2 },
      archiveCiphertextBytes: ARCHIVE_ONE.byteLength + ARCHIVE_TWO.byteLength,
    });
    expect(existsSync(join(outputDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(outputDir, "sessions.json"))).toBe(true);
    expect(existsSync(join(outputDir, "hours.json"))).toBe(true);
    expect(readFileSync(join(outputDir, "archives", "a-1.bin"))).toEqual(
      Buffer.from(ARCHIVE_ONE),
    );
    // The receipt is the completeness claim, and it says what the customer
    // still needs in order to read what they just downloaded.
    const receipt = JSON.parse(
      readFileSync(join(outputDir, "bundle.json"), "utf8"),
    );
    expect(receipt).toMatchObject({
      counts: { archives: 2 },
      archivesRequireLocalKey: true,
      authoritativeCopy: "local-history",
    });
  });

  it("fails rather than writing a bundle that lacks an object the manifest names", async () => {
    // The runbook is explicit: a manifest naming an object the bundle lacks is a
    // failed export, not a partial one.
    const outputDir = scratch();

    const result = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787",
      token: "grant-token",
      outputDir,
      fetchImpl: cell({ objects: { "a-1": ARCHIVE_ONE } }),
    });

    expect(result).toMatchObject({ ok: false, partialPath: outputDir });
    expect(existsSync(join(outputDir, "bundle.json"))).toBe(false);
  });

  it("refuses ciphertext that does not match the digest the listing named", async () => {
    const outputDir = scratch();

    const result = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787",
      token: "grant-token",
      outputDir,
      fetchImpl: cell({
        objects: {
          "a-1": new TextEncoder().encode("not-what-was-promised"),
          "a-2": ARCHIVE_TWO,
        },
      }),
    });

    expect(result).toMatchObject({ ok: false, reason: "incomplete" });
    expect(result.ok === false && result.detail).toContain("digest");
    expect(existsSync(join(outputDir, "bundle.json"))).toBe(false);
  });

  it("fails when a listing returns fewer rows than the manifest counts", async () => {
    const outputDir = scratch();

    const result = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787",
      token: "grant-token",
      outputDir,
      fetchImpl: cell({ manifestCounts: { sessions: 9, hours: 1, archives: 2 } }),
    });

    expect(result).toMatchObject({ ok: false, reason: "incomplete" });
    expect(result.ok === false && result.detail).toContain("9 sessions");
    expect(existsSync(join(outputDir, "bundle.json"))).toBe(false);
  });

  it("tells a refused grant apart from a deleted copy", async () => {
    const refused = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787",
      token: "grant-token",
      outputDir: scratch(),
      fetchImpl: cell({ status: (path) => (path.endsWith("manifest") ? 401 : null) }),
    });
    expect(refused).toMatchObject({ ok: false, reason: "grant-invalid" });

    const deleted = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787",
      token: "grant-token",
      outputDir: scratch(),
      fetchImpl: cell({ status: (path) => (path.endsWith("manifest") ? 410 : null) }),
    });
    expect(deleted).toMatchObject({ ok: false, reason: "copy-deleted" });
    expect(deleted.ok === false && deleted.detail).toContain("deleted");
  });

  it("says an unreachable archive store is unavailable, never that the archive is gone", async () => {
    const result = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787",
      token: "grant-token",
      outputDir: scratch(),
      fetchImpl: cell({
        status: (path) => (path.startsWith("/recovery/v1/archives/") ? 503 : null),
      }),
    });

    expect(result).toMatchObject({ ok: false, reason: "archive-unavailable" });
    expect(result.ok === false && result.detail).toContain("unavailable");
  });

  it("refuses to assemble into a directory that already holds files", async () => {
    // Overwriting in place could leave one download's objects beside another's
    // manifest, and the receipt would describe neither.
    const outputDir = scratch();
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "manifest.json"), "{}");

    const result = await downloadRecoveryBundle({
      cellUrl: "http://127.0.0.1:8787",
      token: "grant-token",
      outputDir,
      fetchImpl: cell(),
    });

    expect(result).toMatchObject({ ok: false, reason: "output-not-empty" });
  });
});
