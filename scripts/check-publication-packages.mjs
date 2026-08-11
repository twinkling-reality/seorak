import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function isMain() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Only the command needs a scratch directory; importing the helpers must not
// leave one behind.
const temporary = isMain()
  ? mkdtempSync(join(tmpdir(), "seorak-publication-"))
  : "";

function fail(message) {
  throw new Error(`publication package check failed: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function pack(relativePackage) {
  const packageDirectory = join(root, relativePackage);
  const output = execFileSync(
    "npm",
    [
      "pack",
      "--dry-run",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      temporary,
    ],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const reports = JSON.parse(output);
  if (!Array.isArray(reports) || reports.length !== 1) {
    fail(`${relativePackage} produced an ambiguous npm pack report`);
  }
  return reports[0];
}

function buildPackage(relativePackage) {
  execFileSync("npm", ["run", "build:publish"], {
    cwd: join(root, relativePackage),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertCollectorCutoverComplete() {
  const dist = join(root, "packages/collector/dist");
  for (const file of readdirSync(dist, { recursive: true })) {
    if (typeof file !== "string" || !file.endsWith(".mjs")) continue;
    const source = readFileSync(join(dist, file), "utf8");
    if (
      source.includes("events.rejected.jsonl") ||
      source.includes("LEGACY_REJECTION_CUTOVER_PENDING")
    ) {
      fail(
        `collector ${file} still contains the pre-publication rejection-journal importer`,
      );
    }
  }
}

const publishedCitationAllowlist = new Set([
  "ARCHITECTURE.md",
  "CLAUDE.md",
  "NEWS.md",
  "README.md",
  "SETUP.md",
  "STATUS.md",
]);

function assertNoPrivateDesignCitations(relativeDirectory) {
  const directory = join(root, relativeDirectory);
  for (const entry of readdirSync(directory, { recursive: true })) {
    if (
      typeof entry !== "string" ||
      (!entry.endsWith(".ts") && !entry.endsWith(".mjs"))
    ) {
      continue;
    }
    const source = readFileSync(join(directory, entry), "utf8");
    for (const match of source.matchAll(/\b[A-Z][A-Z0-9-]+\.md\b/g)) {
      if (!publishedCitationAllowlist.has(match[0])) {
        fail(
          `${relativeDirectory}/${entry} cites private design file ${match[0]}`,
        );
      }
    }
    if (source.includes(".port/")) {
      fail(`${relativeDirectory}/${entry} cites gitignored .port material`);
    }
  }
}

/**
 * npm refuses to publish a version the registry already carries, and says so
 * even under --dry-run. Since 2026-08-10 all three packages are published at
 * 0.1.0, so that refusal is the normal answer here and says nothing about the
 * package: it is a fact about the release, not a defect.
 *
 * Treating it as a pass keeps the coverage that matters. npm packs the tarball,
 * reads and normalises the manifest, and emits any auto-correction warning
 * (`lib/commands/publish.js`, pack/getContents) BEFORE it compares versions
 * against the registry, so the manifest-rewrite guard below still runs on a
 * fully processed manifest. Only the JSON report is lost, because npm throws
 * before printing it.
 */
const ALREADY_PUBLISHED = /You cannot publish over the previously published versions/i;

function assertPublishDryRun(relativePackage) {
  const result = spawnSync(
    "npm",
    ["publish", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: join(root, relativePackage),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const alreadyPublished =
    result.status !== 0 && ALREADY_PUBLISHED.test(result.stderr);
  if (result.status !== 0 && !alreadyPublished) {
    fail(
      `${relativePackage} npm publish dry run failed: ${result.stderr.trim()}`,
    );
  }
  if (/auto-corrected|invalid and removed/i.test(result.stderr)) {
    fail(
      `${relativePackage} npm publish rewrote its manifest: ${result.stderr.trim()}`,
    );
  }
  if (alreadyPublished) {
    return;
  }
  const reports = Object.values(JSON.parse(result.stdout));
  if (reports.length !== 1) {
    fail(`${relativePackage} produced an ambiguous npm publish report`);
  }
  const [report] = reports;
  if (report.name === undefined || report.version === undefined) {
    fail(`${relativePackage} produced an invalid npm publish report`);
  }
}

/**
 * Every file a manifest promises a consumer: the `exports` map (each condition
 * leaf, so `types` is checked beside `import`), plus `main`, `types`, and every
 * `bin` target.
 *
 * This exists because `exports` and the built artifact are maintained in two
 * different places. A declared subpath whose target is never emitted resolves
 * to nothing at runtime, and file counts, dependency closures, and a publish
 * dry run all pass anyway.
 */
export function declaredArtifactTargets(manifest) {
  const targets = [];
  const add = (kind, subpath, condition, value) => {
    if (typeof value !== "string") return;
    targets.push({
      kind,
      subpath,
      condition,
      target: value.replace(/^\.\//, ""),
      pattern: value.includes("*"),
    });
  };

  for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
    if (typeof entry === "string") {
      add("exports", subpath, "default", entry);
      continue;
    }
    for (const [condition, value] of Object.entries(entry ?? {})) {
      add("exports", subpath, condition, value);
    }
  }
  add("main", ".", "main", manifest.main);
  add("types", ".", "types", manifest.types);
  for (const [command, value] of Object.entries(manifest.bin ?? {})) {
    add("bin", command, "bin", value);
  }
  return targets;
}

/**
 * An `exports` subpath pattern as a regular expression.
 *
 * Node treats the FIRST `*` as the wildcard and any later one as a literal, and
 * the wildcard spans path separators. `@seorak/dashboard` declares `./dist/*`
 * over a tree of hashed asset names, so a pattern is the only way it can promise
 * its artifact at all.
 */
function patternToRegExp(target) {
  const star = target.indexOf("*");
  const escape = (part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escape(target.slice(0, star))}(.+)${escape(target.slice(star + 1))}$`,
  );
}

/**
 * Which declared targets are absent from the set of paths actually shipped.
 *
 * A wildcard target is present when at least one shipped path matches it. It
 * used to be exempt, on the reasoning that a pattern cannot be resolved
 * statically; that is true of resolving it to ONE file and false of the question
 * this gate is asking, which is whether the subpath resolves to anything at all.
 * A `./dist/*` over an empty `dist` is exactly the defect the non-wildcard half
 * of this function exists to catch.
 */
export function missingArtifactTargets(manifest, shippedPaths) {
  const shipped = [...new Set(shippedPaths)];
  const present = new Set(shipped);
  return declaredArtifactTargets(manifest)
    .filter((entry) =>
      entry.pattern
        ? !shipped.some((path) => patternToRegExp(entry.target).test(path))
        : !present.has(entry.target),
    )
    .map((entry) => ({
      kind: entry.kind,
      subpath: entry.subpath,
      condition: entry.condition,
      target: entry.target,
    }));
}

/** Export subpaths that a plain consumer can `import` with no optional peer. */
export function importableExportSubpaths(manifest, options = {}) {
  const skip = new Set(options.skip ?? []);
  return Object.entries(manifest.exports ?? {})
    .filter(([subpath, entry]) => {
      if (skip.has(subpath) || subpath.includes("*")) return false;
      return typeof entry === "string" || typeof entry?.import === "string";
    })
    .map(([subpath]) => subpath.replace(/^\./, ""));
}

export function dependencyMetadataProblems(manifest, expected) {
  const problems = [];
  for (const field of ["name", "version", "license"]) {
    if (expected[field] !== undefined && manifest[field] !== expected[field]) {
      problems.push(
        `${field} is ${String(manifest[field])}, expected ${String(expected[field])}`,
      );
    }
  }
  if (
    expected.versionPattern !== undefined &&
    (typeof manifest.version !== "string" ||
      !expected.versionPattern.test(manifest.version))
  ) {
    problems.push(
      `version is ${String(manifest.version)}, expected ${String(expected.versionPattern)}`,
    );
  }
  if (
    expected.nodeEngine !== undefined &&
    manifest.engines?.node !== expected.nodeEngine
  ) {
    problems.push(
      `engines.node is ${String(manifest.engines?.node)}, expected ${expected.nodeEngine}`,
    );
  }
  return problems;
}

export function hasLicenseFile(entries) {
  return entries.some(
    (entry) =>
      typeof entry === "string" && /^licen[cs]e(?:\..*)?$/i.test(entry),
  );
}

function assertDeclaredTargetsShipped(name, manifest, report) {
  const missing = missingArtifactTargets(
    manifest,
    report.files.map((file) => file.path),
  );
  if (missing.length > 0) {
    fail(
      `${name} declares ${missing.length} target${missing.length === 1 ? "" : "s"} its tarball never ships: ` +
        missing
          .map(
            (entry) =>
              `${entry.kind} ${entry.subpath} (${entry.condition}) -> ${entry.target}`,
          )
          .join(", "),
    );
  }
}

function assertPack(report, options) {
  const paths = new Set(report.files.map((file) => file.path));
  for (const required of options.required) {
    if (!paths.has(required)) {
      fail(`${report.name} tarball is missing ${required}`);
    }
  }
  for (const { prefix, why } of options.forbidden ?? []) {
    const found = [...paths].filter((path) => path.startsWith(prefix));
    if (found.length > 0) {
      fail(
        `${report.name} tarball ships ${found.length} file(s) under ${prefix}: ${found.join(", ")}. ${why}`,
      );
    }
  }
  for (const path of paths) {
    if (
      path === "tsconfig.json" ||
      path === "vitest.config.ts" ||
      path.startsWith("test/")
    ) {
      fail(`${report.name} tarball leaked development file ${path}`);
    }
  }
  if (report.entryCount !== paths.size) {
    fail(`${report.name} pack report contains duplicate paths`);
  }
}

function packTarball(relativePackage) {
  const output = execFileSync(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      temporary,
    ],
    {
      cwd: join(root, relativePackage),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [report] = JSON.parse(output);
  if (!report?.filename) fail(`${relativePackage} did not produce a tarball`);
  return join(temporary, report.filename);
}

function dependencyNames(tree) {
  const names = new Set();
  function walk(node) {
    for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
      names.add(name);
      walk(dependency);
    }
  }
  walk(tree);
  return names;
}

function installedPackage(installDirectory, packageName) {
  return existsSync(
    join(installDirectory, "node_modules", ...packageName.split("/")),
  );
}

function assertInstalledDependencyMetadata(
  installDirectory,
  packageName,
  expected,
) {
  const packageDirectory = join(
    installDirectory,
    "node_modules",
    ...packageName.split("/"),
  );
  const manifestPath = join(packageDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    fail(`collector install closure is missing ${packageName}`);
  }
  const problems = dependencyMetadataProblems(readJson(manifestPath), expected);
  if (problems.length > 0) {
    fail(`${packageName} installed metadata is invalid: ${problems.join("; ")}`);
  }
  if (!hasLicenseFile(readdirSync(packageDirectory))) {
    fail(`${packageName} installed package carries no LICENSE file`);
  }
}

function assertProductionAudit(installDirectory, packageName) {
  const result = spawnSync(
    "npm",
    ["audit", "--omit=dev", "--audit-level=low", "--json"],
    {
      cwd: installDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const report = JSON.parse(result.stdout);
  const total = report.metadata?.vulnerabilities?.total;
  if (result.status !== 0 || total !== 0) {
    fail(
      `${packageName} production install has ${String(total ?? "unknown")} npm advisories`,
    );
  }
}

/** An ephemeral port nothing is bound to, so the smoke below cannot collide. */
async function freePort() {
  const server = createServer();
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address();
  await new Promise((closed) => server.close(closed));
  return port;
}

/**
 * The check this repository did not have: an INSTALLED collector, asked for the
 * dashboard, over HTTP, from an install directory that is the only place the
 * bundle could have come from.
 *
 * Everything else in this file inspects manifests and file lists. A manifest can
 * promise an interface a tarball does not carry — that is exactly what it did —
 * and a file list can carry one the plane cannot serve, which is how a missing
 * `.woff` content type made every local dashboard render in a fallback face for
 * weeks while the same bundle rendered correctly from a worker. Both defects
 * survive every static check and neither survives one request.
 *
 * So this fetches three things: the document, the module the document loads, and
 * a font the stylesheet names. Status AND content type on each, because a 200
 * with the wrong type is the failure mode that looks like a bundler bug.
 */
async function assertInstalledCollectorServesDashboard(installDirectory, stateDir) {
  const port = await freePort();
  const child = spawn(
    join(installDirectory, "node_modules/.bin/seorak"),
    ["local", "dashboard", "--port", String(port)],
    {
      cwd: installDirectory,
      env: { ...process.env, SEORAK_DIR: stateDir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${port}`;
  try {
    let document = null;
    for (let attempt = 0; attempt < 100 && document === null; attempt += 1) {
      await delay(100);
      try {
        const response = await fetch(`${base}/dashboard`);
        if (response.status === 200) document = response;
      } catch {
        // Not listening yet.
      }
    }
    if (document === null) {
      fail(
        `installed collector never served /dashboard on ${base}. Output: ${output.trim()}`,
      );
    }
    if (output.includes("no dashboard bundle installed")) {
      fail(
        "installed collector printed the no-bundle sentence while serving a bundle: " +
          output.trim(),
      );
    }
    if (!document.headers.get("content-type")?.includes("text/html")) {
      fail(
        `installed collector served /dashboard as ${document.headers.get("content-type")}`,
      );
    }
    const html = await document.text();
    if (!html.includes('id="root"')) {
      fail("installed collector served a document that is not the dashboard entry");
    }
    const script = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
    if (script === undefined) {
      fail("the served dashboard document loads no module from /assets");
    }
    const module = await fetch(`${base}${script}`);
    if (
      module.status !== 200 ||
      !module.headers.get("content-type")?.includes("text/javascript")
    ) {
      fail(
        `installed collector served ${script} as ${module.status} ${module.headers.get("content-type")}`,
      );
    }
    // The font the bundle actually embeds, fetched through the plane. An
    // unmapped extension is a 404 here, not a guessed type, so this is the one
    // check that would have caught the missing `.woff` mapping.
    const assets = join(
      installDirectory,
      "node_modules/@seorak/dashboard/dist/assets",
    );
    const font = readdirSync(assets).find((entry) => entry.endsWith(".woff2"));
    if (font === undefined) {
      fail("the installed dashboard carries no woff2, so its mono face cannot load");
    }
    const served = await fetch(`${base}/assets/${font}`);
    if (
      served.status !== 200 ||
      served.headers.get("content-type") !== "font/woff2"
    ) {
      fail(
        `installed collector served ${font} as ${served.status} ${served.headers.get("content-type")}`,
      );
    }
    // THE PRODUCT SANS, over the same plane, and this is the check B6's finding
    // asked for. The mono above always loaded; what the offline install actually
    // did was 404 four `/fonts/*.woff` on every page load and fall through to
    // `-apple-system`, because the licensed face could not travel in a tarball.
    // Fetching one by the URL `app.css` names is what makes "renders in the
    // product face" a gate rather than a screenshot somebody took once.
    const sansDirectory = join(
      installDirectory,
      "node_modules/@seorak/dashboard/dist/fonts",
    );
    const sans = readdirSync(sansDirectory).find((entry) => entry.endsWith(".woff"));
    if (sans === undefined) {
      fail(
        "the installed dashboard carries no .woff under dist/fonts, so its product sans cannot load and every surface renders in the platform fallback face",
      );
    }
    const sansServed = await fetch(`${base}/fonts/${sans}`);
    if (
      sansServed.status !== 200 ||
      sansServed.headers.get("content-type") !== "font/woff"
    ) {
      fail(
        `installed collector served ${sans} as ${sansServed.status} ${sansServed.headers.get("content-type")}`,
      );
    }
    return { port, files: readdirSync(assets).length };
  } finally {
    child.kill("SIGTERM");
  }
}

// The gate below packs, dry-run publishes, and installs real tarballs, so it
// runs only as a command. Importing this module gets the pure helpers alone.
if (isMain()) {
  await runPublicationGate();
}

async function runPublicationGate() {
try {
  const typesManifest = readJson(join(root, "packages/types/package.json"));
  const collectorManifest = readJson(
    join(root, "packages/collector/package.json"),
  );
  const dashboardManifest = readJson(
    join(root, "packages/dashboard/package.json"),
  );
  for (const [name, manifest] of [
    ["@seorak/types", typesManifest],
    ["@seorak/collector", collectorManifest],
    ["@seorak/dashboard", dashboardManifest],
  ]) {
    if (manifest.private === true) fail(`${name} is still private`);
    if (manifest.license !== "Apache-2.0") {
      fail(`${name} does not declare Apache-2.0`);
    }
    if (manifest.engines?.node !== ">=22.18.0") {
      fail(`${name} does not declare the supported Node floor`);
    }
  }
  if (collectorManifest.dependencies?.["@seorak/types"] !== "^0.1.0") {
    fail("collector does not pin its publishable types dependency");
  }
  if (
    collectorManifest.dependencies?.["@modelcontextprotocol/server"] !==
    "2.0.0"
  ) {
    fail("collector does not exactly pin @modelcontextprotocol/server 2.0.0");
  }
  if (
    collectorManifest.devDependencies?.["@modelcontextprotocol/client"] !==
    "2.0.0"
  ) {
    fail("collector does not exactly pin its MCP protocol client at 2.0.0");
  }
  if (
    collectorManifest.dependencies?.["@modelcontextprotocol/client"] !==
    undefined
  ) {
    fail("collector ships the test-only MCP client as a production dependency");
  }
  // THE PIN IS EXACT, and this is the assertion that keeps it so. A caret would
  // let npm resolve a dashboard built against a different protocol than the one
  // this collector speaks, which is the failure ADR 005 decision 3 describes:
  // `parseDataPlaneStatus` returns null, the app reads the authority as unknown,
  // and the account-free product renders a sign-in wall over the user's own
  // history. The startup refusal in `local-plane.ts` catches it at runtime; this
  // stops it being resolvable in the first place.
  if (collectorManifest.dependencies?.["@seorak/dashboard"] === undefined) {
    fail(
      "collector declares no @seorak/dashboard dependency, so the published collector would ship no user interface. " +
        "That is the defect ADR 005 opens on, and it is what this gate exists to keep closed.",
    );
  }
  if (
    collectorManifest.dependencies["@seorak/dashboard"] !==
    dashboardManifest.version
  ) {
    fail(
      `collector pins @seorak/dashboard as ${collectorManifest.dependencies["@seorak/dashboard"]}, ` +
        `which is not the exact version ${dashboardManifest.version}`,
    );
  }
  // The dashboard itself resolves no runtime code. The collector's official
  // MCP SDK closure is checked after installation below, independently of the
  // UI asset package.
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    if (Object.keys(dashboardManifest[field] ?? {}).length > 0) {
      fail(`@seorak/dashboard declares ${field}; it must resolve nothing at install time`);
    }
  }
  // Two subpaths and no more: the manifest, and the artifact under it. A
  // consumer resolves the first and derives the asset root from where it landed,
  // which is what survives npm nesting and Yarn PnP alike.
  const dashboardExports = JSON.stringify(dashboardManifest.exports);
  if (
    dashboardExports !==
    JSON.stringify({ "./package.json": "./package.json", "./dist/*": "./dist/*" })
  ) {
    fail(`@seorak/dashboard declares unexpected exports: ${dashboardExports}`);
  }
  if (dashboardManifest.main !== undefined) {
    fail("@seorak/dashboard declares a main entry; it is static assets, not a module");
  }
  if (
    collectorManifest.main !== undefined ||
    Object.keys(collectorManifest.exports ?? {}).length !== 0
  ) {
    fail("collector exposes a library import instead of its command boundary");
  }
  // The token package is deliberately NOT a peer: `src/push.ts` owns the wire
  // contract rather than importing `@mobile-surfaces/tokens/wire`, because that
  // import resolved the whole Expo and React Native toolchain through
  // non-optional peers of the token package's own dependency. Declaring a peer
  // nothing imports would put the edge back in the manifest with nothing to
  // justify it, so this asserts its absence.
  if (typesManifest.peerDependencies?.["@mobile-surfaces/tokens"] !== undefined) {
    fail("@seorak/types declares a mobile token peer it does not import");
  }
  if (
    typesManifest.peerDependenciesMeta?.[
      "@mobile-surfaces/surface-contracts"
    ]?.optional !== true
  ) {
    fail("mobile surface integration is not an optional types peer");
  }

  assertNoPrivateDesignCitations("packages/types/src");
  assertNoPrivateDesignCitations("packages/collector/src");
  assertNoPrivateDesignCitations("packages/collector/bin");
  buildPackage("packages/types");
  buildPackage("packages/collector");
  // Runs the web dashboard entry's build and stages what it emitted. It refuses
  // the licensed face by name and then re-checks the staged tree by magic bytes,
  // so this call is also where an unlicensed binary fails the gate.
  buildPackage("packages/dashboard");
  assertCollectorCutoverComplete();
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await import("./packages/types/dist/push.js");',
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assertPublishDryRun("packages/types");
  assertPublishDryRun("packages/collector");
  assertPublishDryRun("packages/dashboard");
  const typesReport = pack("packages/types");
  assertPack(typesReport, {
    required: [
      "package.json",
      "README.md",
      "LICENSE",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/event-protocol.js",
      "dist/event-protocol.d.ts",
      "dist/event-validation.js",
      "dist/event-validation.d.ts",
    ],
  });
  const collectorReport = pack("packages/collector");
  assertPack(collectorReport, {
    required: [
      "package.json",
      "README.md",
      "NEWS.md",
      "LICENSE",
      "dist/seorak.mjs",
      "dist/daemon.mjs",
      "dist/hook-session-start.mjs",
      "dist/hook-tool-use.mjs",
      "dist/hook-session-end.mjs",
      "dist/hook-notification.mjs",
      "dist/hook-user-prompt.mjs",
    ],
  });
  const dashboardReport = pack("packages/dashboard");
  assertPack(dashboardReport, {
    // THE REQUIRED-FILE ASSERTION ADR 005 DECISION 3 ASKS FOR. A release that
    // ships no UI has to fail here rather than pass silently, which is what it
    // did before this stage: the collector's manifest promised a dashboard its
    // tarball never contained, and every other check in this file was green.
    //
    // The licence texts are required for the same reason they are in the `files`
    // array at all. OFL-1.1 clause 2 binds the REDISTRIBUTED COPY, and an npm
    // tarball is one; a licence that stayed behind in the git tree would not
    // travel with the bytes it governs.
    required: [
      "package.json",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "LICENSES/OFL-1.1-Figtree.txt",
      "LICENSES/OFL-1.1-IBM-Plex-Mono.txt",
      "LICENSES/CC0-1.0-Simple-Icons.txt",
      "dist/index.html",
      "dist/data-plane-protocol.json",
      // THE PRODUCT SANS, REQUIRED RATHER THAN FORBIDDEN, AND THAT INVERSION IS
      // STAGE B5. Before it, this list forbade `dist/fonts/` because the four
      // binaries there were TT Commons Pro, which this repository can evidence
      // no licence for. B6 then measured the cost against a real offline
      // install: the packed dashboard rendered in the platform fallback face and
      // 404'd four fonts on every load. Figtree is OFL-1.1 and may travel, so
      // the four cuts are now something the tarball must CARRY, and a release
      // that drops them fails here instead of shipping an unstyled product.
      "dist/fonts/Figtree-Light.woff",
      "dist/fonts/Figtree-Regular.woff",
      "dist/fonts/Figtree-Medium.woff",
      "dist/fonts/Figtree-SemiBold.woff",
    ],
    forbidden: [
      {
        prefix: "dist/fonts/TTCommonsPro",
        why:
          "TT Commons Pro is TypeType LLC property under a EULA this repository cannot evidence, commercial webfont licences are as a class non-sublicensable, " +
          "and a published tarball is a redistribution. Stage B5 replaced it with Figtree; this entry keeps the licensed face from returning by any route.",
      },
    ],
  });
  // Every declared export condition, main, types, and bin target must be a file
  // the tarball actually contains. The required-file lists above are a
  // hand-maintained floor; this is derived from the manifest, so a new subpath
  // cannot be declared and left unbuilt.
  assertDeclaredTargetsShipped("@seorak/types", typesManifest, typesReport);
  assertDeclaredTargetsShipped(
    "@seorak/collector",
    collectorManifest,
    collectorReport,
  );
  assertDeclaredTargetsShipped(
    "@seorak/dashboard",
    dashboardManifest,
    dashboardReport,
  );

  // The version the ARTIFACT declares, checked against the one this repository's
  // types hold. The dashboard's own build asserts the same thing at staging
  // time; asserting it again over the packed tree is what makes it a property of
  // the tarball rather than of one machine's build directory.
  const { DATA_PLANE_PROTOCOL_VERSION } = await import(
    pathToFileURL(join(root, "packages/types/dist/data-plane.js")).href
  );
  const declaredProtocol = readJson(
    join(root, "packages/dashboard/dist/data-plane-protocol.json"),
  ).dataPlaneProtocolVersion;
  if (declaredProtocol !== DATA_PLANE_PROTOCOL_VERSION) {
    fail(
      `@seorak/dashboard declares data-plane protocol ${String(declaredProtocol)} ` +
        `but @seorak/types declares ${DATA_PLANE_PROTOCOL_VERSION}`,
    );
  }

  // THREE TARBALLS, installed together. The collector's exact pin names a
  // version no registry carries yet, so an install that offered only two would
  // fail to resolve it; offering all three is what proves the manifest the
  // collector publishes is satisfiable by the set that publishes with it.
  const typesTarball = packTarball("packages/types");
  const collectorTarball = packTarball("packages/collector");
  const dashboardTarball = packTarball("packages/dashboard");
  const collectorInstall = join(temporary, "collector-install");
  mkdirSync(collectorInstall);
  writeFileSync(
    join(collectorInstall, "package.json"),
    '{"name":"seorak-publication-smoke","private":true}\n',
    "utf8",
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      typesTarball,
      collectorTarball,
      dashboardTarball,
    ],
    {
      cwd: collectorInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assertProductionAudit(collectorInstall, "@seorak/collector");
  const tree = JSON.parse(
    execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
      cwd: collectorInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const dependencies = dependencyNames(tree);
  const externalDependencies = [...dependencies]
    .filter(
      (name) =>
        !name.startsWith("@seorak/") &&
        installedPackage(collectorInstall, name),
    )
    .sort();
  if (
    JSON.stringify(externalDependencies) !==
    JSON.stringify([
      "@modelcontextprotocol/core",
      "@modelcontextprotocol/server",
      "zod",
    ])
  ) {
    fail(
      `collector production external dependency closure is ${externalDependencies.join(", ")}`,
    );
  }
  assertInstalledDependencyMetadata(
    collectorInstall,
    "@modelcontextprotocol/server",
    {
      name: "@modelcontextprotocol/server",
      version: "2.0.0",
      license: "MIT",
      nodeEngine: ">=20",
    },
  );
  assertInstalledDependencyMetadata(
    collectorInstall,
    "@modelcontextprotocol/core",
    {
      name: "@modelcontextprotocol/core",
      version: "2.0.0",
      license: "MIT",
      nodeEngine: ">=20",
    },
  );
  assertInstalledDependencyMetadata(collectorInstall, "zod", {
    name: "zod",
    versionPattern: /^4\./,
    license: "MIT",
  });
  if (installedPackage(collectorInstall, "@modelcontextprotocol/client")) {
    fail(
      "collector production install closure contains the test-only MCP client",
    );
  }
  for (const forbidden of [
    "@mobile-surfaces/surface-contracts",
    "@mobile-surfaces/tokens",
    "@mobile-surfaces/live-activity",
    "expo",
    "expo-secure-store",
    "react-native",
  ]) {
    if (
      dependencies.has(forbidden) &&
      installedPackage(collectorInstall, forbidden)
    ) {
      fail(`collector install closure contains ${forbidden}`);
    }
  }

  const help = execFileSync(
    join(collectorInstall, "node_modules/.bin/seorak"),
    ["--help"],
    {
      cwd: collectorInstall,
      env: {
        ...process.env,
        SEORAK_DIR: join(temporary, "state"),
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (!help.includes("usage:")) {
    fail("installed collector CLI did not render its help contract");
  }
  const settingsPath = join(temporary, "installed-settings.json");
  const init = spawnSync(
    join(collectorInstall, "node_modules/.bin/seorak"),
    [
      "init",
      "--no-service",
      "--worker-url",
      "http://127.0.0.1:9",
    ],
    {
      cwd: collectorInstall,
      env: {
        ...process.env,
        SEORAK_DIR: join(temporary, "state"),
        SEORAK_SETTINGS: settingsPath,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    },
  );
  if (
    init.status !== 1 ||
    !init.stdout.includes("hooks installed") ||
    init.stderr.includes("hook install failed")
  ) {
    fail("installed collector could not initialize its packaged hooks");
  }
  const installedSettings = readJson(settingsPath);
  for (const [event, hook] of [
    ["SessionStart", "hook-session-start.mjs"],
    ["PostToolUse", "hook-tool-use.mjs"],
    ["PostToolUseFailure", "hook-tool-use.mjs"],
    ["SessionEnd", "hook-session-end.mjs"],
    ["Notification", "hook-notification.mjs"],
    ["UserPromptSubmit", "hook-user-prompt.mjs"],
  ]) {
    const expectedPath = join(
      collectorInstall,
      "node_modules/@seorak/collector/dist",
      hook,
    );
    const groups = installedSettings.hooks?.[event];
    const commands = Array.isArray(groups)
      ? groups.flatMap((group) =>
          Array.isArray(group?.hooks)
            ? group.hooks.map((entry) => entry?.command)
            : [],
        )
      : [];
    if (
      !existsSync(expectedPath) ||
      !commands.some(
        (command) =>
          typeof command === "string" && command.includes(expectedPath),
      )
    ) {
      fail(`installed collector did not bind packaged ${event} hook`);
    }
  }
  for (const hook of [
    "seorak-hook-session-start",
    "seorak-hook-tool-use",
    "seorak-hook-session-end",
    "seorak-hook-notification",
    "seorak-hook-user-prompt",
  ]) {
    const output = execFileSync(
      join(collectorInstall, "node_modules/.bin", hook),
      [],
      {
        cwd: collectorInstall,
        env: {
          ...process.env,
          SEORAK_DIR: join(temporary, "state"),
        },
        input: "{}\n",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    if (output !== "") fail(`installed ${hook} emitted output for empty input`);
  }
  const daemon = spawnSync(
    join(collectorInstall, "node_modules/.bin/seorak-collector"),
    [],
    {
      cwd: collectorInstall,
      env: {
        ...process.env,
        SEORAK_DIR: join(temporary, "daemon-state"),
        SEORAK_WORKER_URL: "http://127.0.0.1:65534",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 500,
      killSignal: "SIGTERM",
    },
  );
  if (
    daemon.error?.code !== "ETIMEDOUT" ||
    /SyntaxError|ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(
      daemon.stderr,
    )
  ) {
    fail(
      "installed collector daemon did not remain healthy for its smoke window: " +
        JSON.stringify({
          status: daemon.status,
          signal: daemon.signal,
          error: daemon.error?.code,
          stderr: daemon.stderr.trim(),
        }),
    );
  }

  const dashboardServed = await assertInstalledCollectorServesDashboard(
    collectorInstall,
    join(temporary, "state"),
  );

  const typesInstall = join(temporary, "types-install");
  mkdirSync(typesInstall);
  writeFileSync(
    join(typesInstall, "package.json"),
    '{"name":"seorak-types-smoke","private":true,"type":"module"}\n',
    "utf8",
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      typesTarball,
    ],
    {
      cwd: typesInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assertProductionAudit(typesInstall, "@seorak/types");
  const typesTree = JSON.parse(
    execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
      cwd: typesInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  for (const forbidden of [
    "@mobile-surfaces/tokens",
    "@mobile-surfaces/live-activity",
    "expo",
    "expo-secure-store",
    "react-native",
  ]) {
    if (
      dependencyNames(typesTree).has(forbidden) &&
      installedPackage(typesInstall, forbidden)
    ) {
      fail(`types core install closure contains ${forbidden}`);
    }
  }
  const typesProbe = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import { EVENT_BATCH_SCHEMA_VERSION } from "@seorak/types"; ' +
        'if (EVENT_BATCH_SCHEMA_VERSION !== 1) process.exit(1);',
    ],
    {
      cwd: typesInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (typesProbe !== "") fail("types import wrote unexpected output");
  // Derived from the manifest rather than hand-listed, so a declared subpath is
  // proved to resolve from a clean install instead of being trusted. `./push`
  // is excluded here only because it needs an optional peer, and it gets its own
  // install below.
  const importableSubpaths = importableExportSubpaths(typesManifest, {
    skip: ["./push"],
  });
  if (importableSubpaths.length < Object.keys(typesManifest.exports).length - 1) {
    fail("types export map lost importable subpaths between declaration and check");
  }
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await Promise.all([" +
        importableSubpaths
          .map((subpath) => `import("@seorak/types${subpath}")`)
          .join(",") +
        "]);",
    ],
    {
      cwd: typesInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  writeFileSync(
    join(typesInstall, "smoke.ts"),
    'import { EVENT_BATCH_SCHEMA_VERSION, type EventBatch } from "@seorak/types";\n' +
      'import { parseSessionEvent } from "@seorak/types/event-validation";\n' +
      "const batch: EventBatch = { schemaVersion: EVENT_BATCH_SCHEMA_VERSION, collectorVersion: \"smoke\", deviceId: \"device\", events: [] };\n" +
      "void batch; void parseSessionEvent;\n",
    "utf8",
  );
  writeFileSync(
    join(typesInstall, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  execFileSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    {
      cwd: typesInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const pushTypesInstall = join(temporary, "push-types-install");
  mkdirSync(pushTypesInstall);
  writeFileSync(
    join(pushTypesInstall, "package.json"),
    '{"name":"seorak-push-types-smoke","private":true,"type":"module"}\n',
    "utf8",
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      typesTarball,
      "@mobile-surfaces/surface-contracts@9.0.0",
    ],
    {
      cwd: pushTypesInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const installedContracts = readJson(
    join(
      pushTypesInstall,
      "node_modules/@mobile-surfaces/surface-contracts/package.json",
    ),
  );
  if (installedContracts.version !== "9.0.0") {
    fail("push types smoke installed the wrong mobile surface peer");
  }
  // The declared peer is the whole install, and it must stay that way: this is
  // the consumer scenario that proves importing `/push` does not drag a mobile
  // toolchain onto a user's machine.
  for (const forbidden of ["@mobile-surfaces/tokens", "expo", "react-native"]) {
    if (existsSync(join(pushTypesInstall, "node_modules", forbidden))) {
      fail(`push types smoke installed ${forbidden}`);
    }
  }
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await import("@seorak/types/push");',
    ],
    {
      cwd: pushTypesInstall,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  console.log(
    `Publication packages passed: ${typesReport.entryCount} types files, ` +
      `${collectorReport.entryCount} collector files, ${dashboardReport.entryCount} dashboard files ` +
      `at data-plane protocol ${declaredProtocol} and no licensed face, core closure excludes ` +
      "mobile runtime peers, carries the official MCP SDK with installed MIT license texts, " +
      "excludes optional push peer imports, and the installed collector served the " +
      `dashboard document, its module, and its font over loopback (${dashboardServed.files} assets).`,
  );
} finally {
  rmSync(join(root, "packages/collector/dist"), {
    recursive: true,
    force: true,
  });
  rmSync(temporary, { recursive: true, force: true });
}
}
