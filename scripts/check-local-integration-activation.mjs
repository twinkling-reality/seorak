#!/usr/bin/env node

/**
 * Atomic collector-integration activation gate.
 *
 * The foundation gates prove F1/F2/F3 independently. This gate proves the
 * product plane actually mounts all three families behind one positional gate
 * on both loopback and real self-hosted TLS before declaring `integrations`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(import.meta.dirname, "..");
export const PLANE_PATH = "packages/collector/src/local-plane.ts";
export const ROUTES_PATH = "packages/collector/src/local-plane-routes.ts";
export const BINDING_PATH = "packages/collector/src/plane-binding.ts";

const read = (path) => readFileSync(resolve(REPO_ROOT, path), "utf8");

export class LocalIntegrationActivationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalIntegrationActivationError";
  }
}

function handleRequestBody(source) {
  const start = source.indexOf("async function handleRequest(");
  const end = source.indexOf("\nfunction isDashboardAppPath", start);
  return start < 0 ? "" : source.slice(start, end < 0 ? undefined : end);
}

export function checkLocalIntegrationActivationSource({
  plane = read(PLANE_PATH),
  routes = read(ROUTES_PATH),
  binding = read(BINDING_PATH),
} = {}) {
  const problems = [];
  const handler = handleRequestBody(plane);
  const position = handler.indexOf("admitRequestPosition(binding, req)");
  const classify = handler.indexOf("classifyLocalPlaneRequestTarget(req.url, req.method)");
  const operator = handler.indexOf("admitOperatorRequest(binding, req)");
  if (!(position >= 0 && classify > position && operator > classify)) {
    problems.push("request position must precede closed classification and operator authority");
  }
  if (!/LOCAL_PLANE_SURFACES[^=]*=\s*\[[\s\S]*?["']integrations["']/.test(plane)) {
    problems.push("local descriptor does not declare the atomic integrations surface");
  }
  for (const seam of [
    "handleIntegrationManagement(",
    "handleLocalPrivateApi(",
    "integrations.serveMcp(",
  ]) {
    if (!handler.includes(seam)) problems.push(`mounted handler is missing ${seam}`);
  }
  if (plane.includes('sendUnavailable(binding, res, "integrations")')) {
    problems.push("mounted plane still refuses integrations as an absent surface");
  }
  for (const closedPath of [
    'path === "/integrations"',
    'path === "/integrations/projects"',
    'path === "/api/v1/period-summary"',
    'path === "/api/v1/sessions"',
    'path === "/mcp/private"',
    '"/.well-known/oauth-protected-resource/mcp/private"',
    '"/.well-known/oauth-authorization-server"',
    '"/.well-known/openid-configuration"',
  ]) {
    if (!routes.includes(closedPath)) problems.push(`closed classifier is missing ${closedPath}`);
  }
  if (!binding.includes('presented?.startsWith("srkx_") ? "unauthenticated"')) {
    problems.push("loopback operator authority can widen an integration bearer");
  }
  if (!plane.includes('new URL("/api/v1", `${position.origin}/`).toString()')) {
    problems.push("HTTP API audience is not derived from the trusted positional origin");
  }
  if (!plane.includes('new URL("/mcp/private", `${origin}/`).toString()')) {
    problems.push("MCP audience is not derived from the trusted positional origin");
  }
  if (problems.length > 0) {
    throw new LocalIntegrationActivationError(problems.join("; "));
  }
}

export function runLocalIntegrationActivationSuite() {
  const result = spawnSync(
    "npm",
    [
      "--workspace",
      "seorak",      "exec",
      "vitest",
      "run",
      "test/local-plane-routes.test.ts",
      "test/local-integrations-plane.test.ts",
      "test/self-hosted-plane.test.ts",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1_024 * 1_024,
    },
  );
  if (result.status !== 0) {
    throw new LocalIntegrationActivationError(
      `mounted collector integration suite failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

export function checkLocalIntegrationActivation(options = {}) {
  checkLocalIntegrationActivationSource(options);
  if (options.runFocusedSuite !== false) runLocalIntegrationActivationSuite();
}

function isMain() {
  return process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    checkLocalIntegrationActivation({ runFocusedSuite: false });
    console.log(
      "Local integration activation: positional authority, closed mounts, and source tripwires are green.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
