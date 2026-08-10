/**
 * plane-binding.ts — which socket the data plane is on, and what admits a
 * request to it.
 *
 * The plane has always been hardened by POSITION rather than by a secret: it
 * binds 127.0.0.1, requires a loopback `Host`, refuses a cross-origin `Origin`,
 * and sends no CORS header. A non-loopback bind mode destroys every premise of
 * that argument at once, so this module carries the replacement argument rather
 * than bolting a token onto the old one. The full reasoning, including the two
 * properties that are deliberately NOT replaced, is in
 * `docs/reference/self-hosted-plane-hardening.md`.
 *
 * Three things here are load-bearing.
 *
 * ONE POSITIONAL GATE. `admitRequestPosition` returns the Host/Origin verdict
 * for BOTH bindings before the request target, credentials, or history are
 * inspected. The closed classifier then chooses operator or integration
 * authority. What makes the check trustworthy is that no handler can be
 * reached around it, not any one route-specific test.
 *
 * ALL OR NOTHING. `resolveSelfHostedBinding` either returns a binding with an
 * origin, a credential, and TLS material, or it throws. There is no degraded
 * remote plane to arrive at by accident: a bind address without TLS, TLS without
 * a credential, or a credential file anyone else on the box can read each refuse
 * to bind at all.
 *
 * NEVER AMBIENT. The credential is read from `Authorization: Bearer` and from
 * nowhere else. The loopback plane can skip CSRF verification because a
 * cross-site write would need a CORS preflight the plane never answers; that
 * argument survives the move to a routable socket only while the credential
 * cannot ride along on its own, which rules out a cookie.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import { isAbsolute } from "node:path";

/** 32 random bytes, base64url, which is exactly 43 characters. */
export const SELF_HOSTED_CREDENTIAL_BYTES = 32;
const CREDENTIAL_MIN_LENGTH = 43;
const CREDENTIAL_MAX_LENGTH = 512;
const CREDENTIAL_SHAPE = new RegExp(
  `^[A-Za-z0-9_-]{${CREDENTIAL_MIN_LENGTH},${CREDENTIAL_MAX_LENGTH}}$`,
);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export interface LoopbackBinding {
  readonly mode: "loopback";
}

export interface SelfHostedBinding {
  readonly mode: "self-hosted";
  /** The exact public origin, e.g. `https://seorak.example:8443`. */
  readonly origin: string;
  /** `Host` values that name that origin. */
  readonly authorities: ReadonlySet<string>;
  /** Interface address to listen on. */
  readonly bindAddress: string;
  /** Listen port, always the origin's port. */
  readonly port: number;
  /**
   * SHA-256 of the credential. The raw value is read at bind time and dropped:
   * a fixed-length digest is also what makes `timingSafeEqual` usable without
   * the presented length becoming its own oracle.
   */
  readonly credentialDigest: Buffer;
  readonly tls: { readonly cert: Buffer; readonly key: Buffer };
}

export type PlaneBinding = LoopbackBinding | SelfHostedBinding;

export const LOOPBACK_BINDING: LoopbackBinding = Object.freeze({
  mode: "loopback",
});

/* -------------------------------------------------------------------------- */
/* Admission                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `not-local` is a POSITIONAL refusal (403) and `unauthenticated` is a missing
 * or wrong credential (401). They are distinct so the plane can answer a browser
 * the way it expects, and they are checked in that order so a request arriving
 * under the wrong name learns nothing about the credential.
 */
export type Admission = "admitted" | "not-local" | "unauthenticated";

export type PositionalAdmission =
  | { readonly admitted: true; readonly origin: string }
  | { readonly admitted: false };

/** The `Host` authority, lowercased, with an https default port dropped so
 *  `example.test` and `example.test:443` name the same origin. */
function authorityOf(header: string | undefined): string | null {
  if (header === undefined) return null;
  const value = header.trim().toLowerCase();
  if (value === "") return null;
  return value.endsWith(":443") ? value.slice(0, -4) : value;
}

function canonicalOriginHeader(value: string): string | null {
  if (value === "null") return null;
  try {
    const origin = new URL(value);
    if (
      origin.username !== "" ||
      origin.password !== "" ||
      origin.pathname !== "/" ||
      origin.search !== "" ||
      origin.hash !== "" ||
      origin.origin !== value
    ) {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

/**
 * The loopback positional verdict. A `Host` naming some other name is the
 * DNS-rebinding shape, and a cross-origin `Origin` is a page on the web reaching
 * for this port. Both are refused before any handler touches local history.
 *
 * The admitted origin is always the canonical 127.0.0.1 authority at the
 * trusted socket's actual port, never a Host or Origin spelling supplied by the
 * caller. The request may use one loopback alias, but Host and Origin must use
 * the SAME alias and actual port.
 */
function admitLoopbackPosition(req: IncomingMessage): PositionalAdmission {
  const host = req.headers.host;
  const localPort = req.socket.localPort;
  if (!host || localPort === undefined) return { admitted: false };
  let requested: URL;
  try {
    requested = new URL(`http://${host}`);
  } catch {
    return { admitted: false };
  }
  if (
    requested.username !== "" ||
    requested.password !== "" ||
    requested.pathname !== "/" ||
    requested.search !== "" ||
    requested.hash !== "" ||
    requested.host !== host ||
    !LOOPBACK_HOSTS.has(requested.hostname) ||
    Number(requested.port || "80") !== localPort
  ) {
    return { admitted: false };
  }
  const servedOrigin = new URL(`http://127.0.0.1:${localPort}`).origin;
  const origin = req.headers.origin;
  if (origin === undefined) return { admitted: true, origin: servedOrigin };
  return canonicalOriginHeader(origin) === requested.origin
    ? { admitted: true, origin: servedOrigin }
    : { admitted: false };
}

/** The presented bearer, or null. `Authorization` is the ONLY place a credential
 *  is read from; see the module header for why a cookie is not one of them. */
function presentedBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
  return match === null ? null : match[1]!;
}

function digestOf(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * The same positional checks as loopback, re-anchored from "loopback" to the
 * origin the operator declared. The `Host` test is still the DNS-rebinding
 * guard: an attacker who resolves their own name to this address gets an
 * authority the operator never declared.
 */
function admitSelfHostedPosition(
  binding: SelfHostedBinding,
  req: IncomingMessage,
): PositionalAdmission {
  const authority = authorityOf(req.headers.host);
  if (authority === null || !binding.authorities.has(authority)) {
    return { admitted: false };
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (canonicalOriginHeader(origin) !== binding.origin) {
      return { admitted: false };
    }
  }
  return { admitted: true, origin: binding.origin };
}

/**
 * The one unavoidable path-independent gate. Callers receive the canonical
 * served origin only after both Host and Origin have passed. No credential is
 * inspected here, which lets the closed route classifier choose between the
 * operator and integration principals without moving positional checks.
 */
export function admitRequestPosition(
  binding: PlaneBinding,
  req: IncomingMessage,
): PositionalAdmission {
  return binding.mode === "loopback"
    ? admitLoopbackPosition(req)
    : admitSelfHostedPosition(binding, req);
}

/** Operator ownership for ordinary and management routes, after position. */
export function admitOperatorRequest(
  binding: PlaneBinding,
  req: IncomingMessage,
): "admitted" | "unauthenticated" {
  const presented = presentedBearer(req);
  if (binding.mode === "loopback") {
    // Position is the loopback owner's authority, but an integration bearer is
    // an explicit request to act as the narrower principal. Never let it widen
    // back into owner management or an ordinary first-party route.
    return presented?.startsWith("srkx_") ? "unauthenticated" : "admitted";
  }
  if (presented === null) return "unauthenticated";
  return timingSafeEqual(digestOf(presented), binding.credentialDigest)
    ? "admitted"
    : "unauthenticated";
}

export function admitRequest(
  binding: PlaneBinding,
  req: IncomingMessage,
): Admission {
  const position = admitRequestPosition(binding, req);
  if (!position.admitted) return "not-local";
  return admitOperatorRequest(binding, req);
}

/* -------------------------------------------------------------------------- */
/* The credential                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mint the credential, replacing any existing one.
 *
 * The plane generates it rather than accepting one the operator invented,
 * because a weak chosen secret fails silently and there is no way to tell one
 * from a strong one after the fact. Written through a temporary file at mode
 * 0600 so a reader can never observe it at a wider mode, not even for the
 * instant between create and chmod.
 */
export function mintSelfHostedCredential(path: string): string {
  const credential = randomBytes(SELF_HOSTED_CREDENTIAL_BYTES).toString("base64url");
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${credential}\n`, { encoding: "utf8", mode: 0o600 });
  // `writeFileSync`'s mode applies only when it CREATES the file; an existing
  // temporary from an interrupted rotation would keep its old permissions.
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  return credential;
}

/**
 * Load the credential, or throw. Every refusal here is a bind-time refusal: the
 * plane does not open a routable socket with a credential it is not willing to
 * stand behind.
 */
export function readSelfHostedCredential(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `self-hosted plane credential missing at ${path}; run \`seorak remote credential\` to mint one`,
    );
  }
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `self-hosted plane credential at ${path} is readable beyond its owner (mode ${mode.toString(8)}); chmod 600 it`,
    );
  }
  const credential = readFileSync(path, "utf8").trim();
  if (!CREDENTIAL_SHAPE.test(credential)) {
    throw new Error(
      `self-hosted plane credential at ${path} is not a minted credential; run \`seorak remote credential --rotate\``,
    );
  }
  return credential;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The environment the four settings are read from. An index signature rather
 * than four optional keys, so `process.env` satisfies it directly: a type whose
 * properties are all optional matches nothing structurally, and the four names
 * below are the only ones ever read.
 */
export type SelfHostedEnv = Readonly<Record<string, string | undefined>>;

const SELF_HOSTED_KEYS = [
  "SEORAK_SELF_HOSTED_ORIGIN",
  "SEORAK_SELF_HOSTED_BIND",
  "SEORAK_SELF_HOSTED_TLS_CERT",
  "SEORAK_SELF_HOSTED_TLS_KEY",
] as const;

function present(env: SelfHostedEnv, key: (typeof SELF_HOSTED_KEYS)[number]): string | null {
  const raw = env[key];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

function parseOrigin(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SEORAK_SELF_HOSTED_ORIGIN is not a URL: ${raw}`);
  }
  // TLS is not a recommendation on this path. The credential travels on every
  // request, so a plaintext origin would publish it to every hop.
  if (url.protocol !== "https:") {
    throw new Error("SEORAK_SELF_HOSTED_ORIGIN must be an https origin");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
      url.username !== "" || url.password !== "") {
    throw new Error(
      "SEORAK_SELF_HOSTED_ORIGIN must be a bare origin with no path, query, or credentials",
    );
  }
  return url;
}

function readTlsMaterial(path: string, variable: string): Buffer {
  if (!isAbsolute(path)) {
    throw new Error(`${variable} must be an absolute path`);
  }
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(`${variable} could not be read at ${path}: ${(error as Error).message}`);
  }
}

export interface SelfHostedResolution {
  /** Absolute path to the credential file. */
  credentialPath: string;
  /** The loopback plane's port, refused as a remote port. */
  loopbackPort: number;
}

/**
 * The self-hosted binding, or null when remote access was never asked for.
 *
 * Null means "no setting was present". Anything BETWEEN null and complete throws,
 * because a partially configured remote plane is the one outcome this stage must
 * not produce: it is how an operator ends up with a routable socket they believe
 * is protected by a setting they mistyped.
 */
export function resolveSelfHostedBinding(
  env: SelfHostedEnv,
  resolution: SelfHostedResolution,
): SelfHostedBinding | null {
  const declared = SELF_HOSTED_KEYS.filter((key) => present(env, key) !== null);
  if (declared.length === 0) return null;
  const missing = SELF_HOSTED_KEYS.filter((key) => present(env, key) === null);
  if (missing.length > 0) {
    throw new Error(
      `self-hosted plane is partially configured; ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } also required`,
    );
  }

  const origin = parseOrigin(present(env, "SEORAK_SELF_HOSTED_ORIGIN")!);
  const port = origin.port === "" ? 443 : Number(origin.port);
  if (port === resolution.loopbackPort) {
    throw new Error(
      `SEORAK_SELF_HOSTED_ORIGIN port ${port} collides with the loopback plane's port`,
    );
  }
  const credential = readSelfHostedCredential(resolution.credentialPath);
  const tls = {
    cert: readTlsMaterial(
      present(env, "SEORAK_SELF_HOSTED_TLS_CERT")!,
      "SEORAK_SELF_HOSTED_TLS_CERT",
    ),
    key: readTlsMaterial(
      present(env, "SEORAK_SELF_HOSTED_TLS_KEY")!,
      "SEORAK_SELF_HOSTED_TLS_KEY",
    ),
  };
  return {
    mode: "self-hosted",
    origin: origin.origin,
    // `origin.host` already omits the https default port; `authorityOf` drops an
    // explicit `:443` from the request, so both spellings land on one entry.
    authorities: new Set([origin.host.toLowerCase()]),
    bindAddress: present(env, "SEORAK_SELF_HOSTED_BIND")!,
    port,
    credentialDigest: digestOf(credential),
    tls,
  };
}
