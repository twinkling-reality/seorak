/**
 * worker-url.ts — ONE resolver for "which worker, and with what token?".
 *
 * Extracted from cli.ts after the F-audit found the session and `seorak status`
 * resolving the worker URL through DIVERGENT paths: the session honored the
 * ADR-5 precedence (flag > env > plist > default) while status read only the
 * plist and fell back to localhost, so an env-configured or --no-service
 * install probed the wrong worker and reported a healthy setup as broken.
 * Every consumer (session, one-shot, status, init verify) now assembles
 * its target through `resolveTargets`, so the precedence can never fork again.
 * The DAEMON is the one consumer that stops short of the plist leg — it is
 * launched by that plist and reads its own environment (`resolveEnvAccessToken`,
 * which states why) — and it forked the token rule inline until it came here.
 *
 * The plist scan is a tolerant string search (no XML parser dep); all pure
 * pieces take their inputs as plain values so they unit-test without a mac.
 */
import { existsSync, readFileSync } from "node:fs";
import type { SavedConnection } from "./connection.ts";

export const DEFAULT_WORKER_URL = "http://localhost:8787";

/** Resolve the worker base URL by the ADR-5 precedence: explicit `--worker-url`,
 *  then `SEORAK_WORKER_URL`, then the URL baked into the installed plist, then the
 *  localhost default. PURE: the impure reads (env, plist) happen in the caller and
 *  are passed in, so the precedence is tested directly. A trailing slash is trimmed
 *  so `${base}/live` never doubles up. This is the headline functional guard —
 *  the plist leg is null on any non-mac / --no-service / foreground install, so
 *  without the env/flag legs a deployed install would falsely probe localhost. */
export function resolveWorkerUrl(sources: {
  flag?: string | boolean | undefined;
  env?: string | undefined;
  saved?: string | null | undefined;
  plist?: string | null | undefined;
}): string {
  const flag = typeof sources.flag === "string" ? sources.flag.trim() : "";
  const env = sources.env?.trim() ?? "";
  const saved = sources.saved?.trim() ?? "";
  const plist = sources.plist?.trim() ?? "";
  return (flag || env || saved || plist || DEFAULT_WORKER_URL).replace(/\/$/, "");
}

/** Resolve the owner access token sent as
 *  `Authorization: Bearer` on read polls and reachability probes. Pure, same
 *  shape as resolveWorkerUrl: env wins over the plist-baked value; undefined
 *  against an open worker (no header sent). Each source is already reduced to a
 *  single string by the read-key-over-ingest-key rule — see
 *  `resolveEnvAccessToken`, which owns that rule for every consumer. */
export function resolveAccessToken(sources: {
  env?: string | undefined;
  plist?: string | null | undefined;
}): string | undefined {
  const env = sources.env?.trim() ?? "";
  if (env) return env;
  const plist = sources.plist?.trim() ?? "";
  return plist || undefined;
}

/**
 * The ENV leg of the read-token precedence, written ONCE: SEORAK_READ_KEY over
 * SEORAK_INGEST_KEY. That is the one-token model — the read token defaults to
 * the ingest key the daemon already carries, and a future read-only token sets
 * SEORAK_READ_KEY without a code change.
 *
 * Both consumers resolve through here. The terminal (`resolveTargets`) adds the
 * plist leg only when neither environment credential was supplied; an explicit
 * blank environment value therefore cannot resurrect a baked token. The daemon
 * stops at the environment leg because it is normally launched by that plist.
 *
 * Undefined against an open worker, and a set-but-blank SEORAK_READ_KEY reads as
 * "no read token" rather than falling through to the ingest key: an operator who
 * blanked the value asked for no header, not for a different one.
 */
export function resolveEnvAccessToken(env: NodeJS.ProcessEnv): string | undefined {
  return resolveAccessToken({ env: env.SEORAK_READ_KEY ?? env.SEORAK_INGEST_KEY });
}

/**
 * Resolve the write credential for diagnostics. An explicitly present
 * environment value owns the decision even when blank, so clearing a rotated
 * key cannot silently resurrect the credential baked into launchd.
 */
export function resolveIngestToken(
  env: NodeJS.ProcessEnv,
  plistPath: string,
  saved: SavedConnection | null = null,
): string | undefined {
  return env.SEORAK_INGEST_KEY !== undefined
    ? resolveAccessToken({ env: env.SEORAK_INGEST_KEY })
    : resolveAccessToken({
        plist:
          saved?.ingestToken ??
          servicePlistEnv(plistPath, "SEORAK_INGEST_KEY"),
      });
}

/** Best-effort: pull a single env var's value back out of an installed plist so
 *  `status`/the terminal use the same config `init` baked. String scan for the
 *  `<key>NAME</key><string>value</string>` pair (no XML parser dep). null when the
 *  plist is absent or the key isn't present. */
export function servicePlistEnv(plistPath: string, name: string): string | null {
  if (!existsSync(plistPath)) return null;
  try {
    const xml = readFileSync(plistPath, "utf8");
    const idx = xml.indexOf(name);
    if (idx === -1) return null;
    const after = xml.slice(idx);
    const match = after.match(/<string>([^<]*)<\/string>/);
    return match ? unescapeXml(match[1]!) : null;
  } catch {
    return null;
  }
}

/** Pull SEORAK_WORKER_URL back out of an installed plist so every read surface
 *  probes the same worker `init` configured. */
export function serviceWorkerUrl(plistPath: string): string | null {
  return servicePlistEnv(plistPath, "SEORAK_WORKER_URL");
}

export interface WorkerTargets {
  workerUrl: string;
  accessToken?: string;
}

/**
 * Where a READ-ONLY surface should look when this install has no worker.
 *
 * `resolveWorkerUrl` falls back to `http://localhost:8787`, which is right for
 * the daemon (it ships there, and it gates every hosted behaviour behind
 * `WORKER_CONFIGURED` anyway) and wrong for the terminal. An account-free
 * install has no worker on 8787 and never will, so `seorak` rendered the
 * unreachable screen while the SAME routes were being answered on loopback by
 * the plane the daemon had already started. The Free product looked broken
 * because its own front door was pointed at a server the contract says it does
 * not need.
 *
 * So a read surface with no configured connection reads the local plane, and
 * carries NO first-party token: the plane mints no operator credential and
 * `credentialRequired` is false on its descriptor. Scoped `srkx_` integration
 * grants are separate. This does not change where anything is WRITTEN. Ingest
 * still resolves through `resolveWorkerUrl`, so an unconfigured install still
 * ships nowhere rather than posting events at its own plane.
 *
 * PURE, and deliberately takes the origin rather than importing the plane: the
 * caller owns `SEORAK_LOCAL_PLANE_PORT`, and this file stays free of the
 * server it points at.
 */
export function resolveReadTargets(
  targets: WorkerTargets,
  connected: boolean,
  localPlaneOrigin: string,
): WorkerTargets {
  return connected ? targets : { workerUrl: localPlaneOrigin.replace(/\/$/, "") };
}

/**
 * Whether this machine has been pointed at a worker AT ALL.
 *
 * `resolveWorkerUrl` always answers with a URL, because every read surface needs
 * one to build a request. That default is exactly what used to make an
 * account-free install look broken: `seorak setup` and `seorak status` probed
 * `http://localhost:8787`, found nothing there, and reported an incomplete
 * setup — for a product whose Free tier is complete WITHOUT a worker.
 *
 * So the presence of a connection is its own question, and it is answered only
 * by an explicit act: passing `--worker-url`, exporting `SEORAK_WORKER_URL`,
 * signing in (`seorak login` writes the saved connection), or having previously
 * baked a URL into the installed LaunchAgent. Nothing infers one from a default.
 *
 * PURE, same shape as `resolveWorkerUrl`: the caller reads env and plist.
 */
export function workerConnectionConfigured(sources: {
  flag?: string | boolean | undefined;
  env?: string | undefined;
  saved?: string | null | undefined;
  plist?: string | null | undefined;
}): boolean {
  return (
    (typeof sources.flag === "string" && sources.flag.trim() !== "") ||
    (sources.env?.trim() ?? "") !== "" ||
    (sources.saved?.trim() ?? "") !== "" ||
    (sources.plist?.trim() ?? "") !== ""
  );
}

/** The impure companion to `workerConnectionConfigured`, assembled from the same
 *  legs `resolveTargets` uses so the two can never disagree about which install
 *  is connected. */
export function hasWorkerConnection(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  plistPath: string,
  saved: SavedConnection | null = null,
): boolean {
  return workerConnectionConfigured({
    flag: flags["worker-url"],
    env: env.SEORAK_WORKER_URL,
    saved: saved?.workerUrl,
    plist: serviceWorkerUrl(plistPath),
  });
}

/**
 * resolveTargets — the ONE assembly every read surface calls: worker URL by the
 * ADR-5 precedence plus the access token (env over plist, read key over ingest
 * key). Reads the env and plist itself so a caller cannot accidentally drop a
 * leg; tests inject a temp plist path and an env object.
 */
export function resolveTargets(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  plistPath: string,
  saved: SavedConnection | null = null,
): WorkerTargets {
  const workerUrl = resolveWorkerUrl({
    flag: flags["worker-url"],
    env: env.SEORAK_WORKER_URL,
    saved: saved?.workerUrl,
    plist: serviceWorkerUrl(plistPath),
  });
  const envOwnsAccess =
    env.SEORAK_READ_KEY !== undefined ||
    env.SEORAK_INGEST_KEY !== undefined;
  const accessToken = envOwnsAccess
    ? resolveEnvAccessToken(env)
    : resolveAccessToken({
        plist:
          saved?.readToken ??
          servicePlistEnv(plistPath, "SEORAK_READ_KEY") ??
          servicePlistEnv(plistPath, "SEORAK_INGEST_KEY"),
      });
  return { workerUrl, ...(accessToken ? { accessToken } : {}) };
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
