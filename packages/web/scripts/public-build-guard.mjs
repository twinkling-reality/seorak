#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, "..");

/**
 * Browser builds are public artifacts. Keep this list narrow and explicit so a
 * future public identifier is not rejected merely because its name contains
 * "key". Add entries only for values that confer private authority.
 */
export const DENYLISTED_PUBLIC_ENV = Object.freeze([
  "VITE_SEORAK_INGEST_KEY",
]);

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function forbiddenEntries(env) {
  return DENYLISTED_PUBLIC_ENV
    .filter((name) => nonempty(env[name]))
    .map((name) => ({ name, value: env[name] }));
}

/**
 * Reject a public build before Vite can substitute a credential into JavaScript.
 * Diagnostics name variables only. Values must never reach logs or exceptions.
 */
export function assertNoForbiddenPublicEnv(env) {
  const entries = forbiddenEntries(env);
  if (entries.length === 0) return;

  const names = entries.map(({ name }) => name).join(", ");
  throw new Error(
    `[web-build-guard] Refusing public build because ${names} is nonempty. ` +
      "Settings writes use the authenticated runtime owner token; no value was logged.",
  );
}

async function walkFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function outputCandidates(env) {
  const candidates = DENYLISTED_PUBLIC_ENV.map((name) => ({
    name,
    value: name,
    kind: "variable reference",
  }));

  for (const { name, value } of forbiddenEntries(env)) {
    candidates.push({ name, value, kind: "configured value" });
  }
  return candidates;
}

/**
 * Scan emitted files byte-for-byte for both denylisted variable references and
 * their configured values. Callers receive only the variable name, match kind,
 * and relative file path, never the matched bytes.
 */
export async function findForbiddenOutputMatches(outputRoot, env) {
  const candidates = outputCandidates(env).map((candidate) => ({
    ...candidate,
    bytes: Buffer.from(candidate.value),
  }));
  const matches = [];

  for (const file of await walkFiles(outputRoot)) {
    const body = await readFile(file);
    for (const candidate of candidates) {
      if (body.indexOf(candidate.bytes) === -1) continue;
      matches.push({
        name: candidate.name,
        kind: candidate.kind,
        file: relative(outputRoot, file),
      });
    }
  }
  return matches;
}

export async function assertNoForbiddenPublicOutput(outputRoot, env) {
  const matches = await findForbiddenOutputMatches(outputRoot, env);
  if (matches.length === 0) return;

  const locations = matches
    .map(({ name, kind, file }) => `${name} ${kind} in ${file}`)
    .join(", ");
  throw new Error(
    `[web-build-guard] Refusing public artifact because it contains ${locations}. ` +
      "Matched values were not logged.",
  );
}

/**
 * Vite gives existing process variables precedence over .env files. Overlay
 * explicitly as well so `VITE_SEORAK_INGEST_KEY=` is a reliable safe override
 * for CI and local remediation builds.
 */
export function loadPublicBuildEnv(mode = "production", processEnv = process.env) {
  const env = loadEnv(mode, WEB_ROOT, "");
  for (const name of DENYLISTED_PUBLIC_ENV) {
    if (Object.prototype.hasOwnProperty.call(processEnv, name)) {
      env[name] = processEnv[name] ?? "";
    }
  }
  return env;
}

async function main() {
  // `--out=<dir>` names which artifact to scan, relative to the package root.
  // There are two since the entry split: `dist` is Seorak's site and
  // `dist-dashboard` is the dashboard. Each build scans the directory it just
  // wrote, so a scan can never report clean by having read the other one.
  const args = process.argv.slice(2);
  const outFlag = args.find((arg) => arg.startsWith("--out="));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const phase = positional[0];
  const mode = positional[1] ?? "production";
  const env = loadPublicBuildEnv(mode);

  if (phase === "pre") {
    assertNoForbiddenPublicEnv(env);
    console.log("[web-build-guard] public-build preflight passed");
    return;
  }

  if (phase === "post") {
    if (outFlag === undefined) {
      throw new Error(
        "[web-build-guard] post needs --out=<dir>: there are two artifacts and " +
          "scanning the wrong one passes without proving anything.",
      );
    }
    const outRoot = resolve(WEB_ROOT, outFlag.slice("--out=".length));
    await assertNoForbiddenPublicOutput(outRoot, env);
    assertNoForbiddenPublicEnv(env);
    console.log(`[web-build-guard] public artifact scan passed (${outFlag.slice(6)})`);
    return;
  }

  throw new Error("[web-build-guard] Expected phase: pre or post");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "[web-build-guard] Build guard failed";
    console.error(message);
    process.exitCode = 1;
  });
}
