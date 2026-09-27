#!/usr/bin/env node

/**
 * Resource-seam gate for the mounted collector MCP server.
 *
 * The focused suite exercises the released SDK and the real SQLite/F2 seams.
 * The source invariant makes its highest-risk fact explicit: the resource must
 * authorize only its canonical `/mcp/private` audience, never an API audience.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const RESOURCE_SOURCE = resolve(
  REPO_ROOT,
  "packages/collector/src/local-private-mcp-resource.ts",
);
const COLLECTOR_MANIFEST = resolve(REPO_ROOT, "packages/collector/package.json");

export class LocalPrivateMcpCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalPrivateMcpCheckError";
  }
}

export function checkLocalPrivateMcpSource(
  source = readFileSync(RESOURCE_SOURCE, "utf8"),
) {
  const problems = [];
  if (!source.includes("authorizeLocalIntegrationCredential(authorization")) {
    problems.push("resource server does not call the persistent integration authority");
  }
  if (!/audience:\s*resourceServerUrl\.toString\(\)/.test(source)) {
    problems.push("resource authorization is not bound to the canonical MCP resource URL");
  }
  if (!/scope:\s*classification\.requiredScope/.test(source)) {
    problems.push("resource authorization is not bound to the classified tool scope");
  }
  if (!/routeClass:\s*classification\.routeClass/.test(source)) {
    problems.push("resource authorization is not bound to the classified route budget");
  }
  if (source.includes("/api/v1")) {
    problems.push("collector MCP resource source contains an API audience path");
  }
  if (problems.length > 0) {
    throw new LocalPrivateMcpCheckError(problems.join("; "));
  }
}

export function checkLocalPrivateMcpDependencies(
  manifest = JSON.parse(readFileSync(COLLECTOR_MANIFEST, "utf8")),
) {
  if (manifest.dependencies?.["@modelcontextprotocol/server"] !== "2.0.0") {
    throw new LocalPrivateMcpCheckError(
      "collector must depend exactly on @modelcontextprotocol/server 2.0.0",
    );
  }
  if (manifest.devDependencies?.["@modelcontextprotocol/client"] !== "2.0.0") {
    throw new LocalPrivateMcpCheckError(
      "collector verifier must use @modelcontextprotocol/client 2.0.0",
    );
  }
}

export function runLocalPrivateMcpFocusedSuite() {
  const result = spawnSync(
    "npm",
    [
      "--workspace",
      "seorak",      "exec",
      "vitest",
      "run",
      "test/local-private-mcp.test.ts",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1_024 * 1_024,
    },
  );
  if (result.status !== 0) {
    throw new LocalPrivateMcpCheckError(
      `focused collector MCP suite failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

export function checkLocalPrivateMcp(options = {}) {
  checkLocalPrivateMcpSource(options.source);
  checkLocalPrivateMcpDependencies(options.manifest);
  if (options.runFocusedSuite !== false) runLocalPrivateMcpFocusedSuite();
}

function isMain() {
  return process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    checkLocalPrivateMcp({ runFocusedSuite: false });
    console.log(
      "Local private MCP foundation: exact resource authority and official SDK pins are green.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
