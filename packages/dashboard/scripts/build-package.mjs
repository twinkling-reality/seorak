import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Stage the published `@seorak/dashboard` artifact.
 *
 * THIS PACKAGE IS BUILT ASSETS, NOT SOURCE. Its source is the dashboard entry of
 * `packages/web` (`vite.config.ts`, `dashboard/index.html`, `src/main.tsx`),
 * which B4 split away from Seorak's marketing site. This script runs that entry's
 * build and stages what it emitted, so there is exactly one dashboard build in
 * the repository and this package cannot drift from it.
 *
 * WHY THE PACKAGE EXISTS AT ALL. `npm i -g @seorak/collector`, the collector's
 * name before it was renamed to the unscoped `seorak`, shipped no
 * interface: the collector's plane probed two package-relative directories that
 * are empty in an npm install and printed "no dashboard bundle installed with
 * this collector". The complete Free UI existed only in a source checkout. ADR
 * 005 decision 3 closes that by making the built dashboard a versioned package
 * the collector depends on and resolves by name.
 *
 * WHAT THIS SCRIPT REFUSES TO STAGE, AND WHY IT IS NOT A PREFERENCE.
 * Any font binary that cannot be shown to be one this package licences.
 * `assertNoUnlicensedFontBinary` reads the staged tree by MAGIC BYTES rather
 * than by path or extension, and requires every font it finds to be
 * byte-identical to a file one of the pinned OFL-1.1 font packages ships. A
 * licensed face arriving through any route fails, whatever it is called.
 *
 * WHY THAT REPLACED A PATH EXCLUSION. Until stage B5 this script excluded the
 * `fonts` directory by name, because it held the four TT Commons Pro binaries:
 * TypeType LLC property under a EULA this repository cannot evidence, and
 * commercial webfont licences are as a class non-sublicensable, so an npm
 * tarball was a redistributed copy. The cost was that the artifact carried NO
 * product sans and rendered in the platform fallback stack, which B6 measured
 * against a real offline install and which is the defect B5 exists to close.
 * B5 substituted Figtree, which is OFL-1.1 and may travel, so the directory
 * ships and the identity check is what keeps it honest. The exclusion list is
 * now empty on purpose: adding an entry back is a licensing decision.
 */

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(packageRoot));
const webPackage = join(repositoryRoot, "packages", "web");
const webArtifact = join(webPackage, "dist-dashboard");
const outdir = join(packageRoot, "dist");

/**
 * What the web dashboard build emits that this package must not carry.
 *
 * EMPTY, and adding an entry is a licensing decision rather than a build tweak.
 * Everything the entry emits is either the application itself or third-party
 * content the `LICENSES/` directory carries the text for: the CC0-1.0 stack
 * icons, and the OFL-1.1 IBM Plex Mono and Figtree cuts.
 */
export const EXCLUDED_FROM_PACKAGE = Object.freeze([]);

/**
 * Files the artifact is useless without. A release that ships no UI must fail
 * here rather than pass quietly, which is the behaviour ADR 005 records as the
 * defect this whole stage exists to delete.
 *
 * `assets/dashboard-icon.svg` is the tab icon the entry document links. B6 had
 * `assets/favicon.svg` here and reported the placement rather than settling it:
 * the entry linked Seorak's mark, the ownership map classifies that file private
 * ("Seorak brand"), and dropping it would 404 the tab icon. C0 answered it the
 * way ADR 005's brand slot already answers the in-app mark, with a neutral
 * default this repository owns, because the private file made the dashboard
 * unbuildable from the public file set. The brand placement itself is untouched
 * and still contested inside ADR 005.
 */
export const REQUIRED_ARTIFACT_FILES = Object.freeze([
  "index.html",
  "data-plane-protocol.json",
  "assets/dashboard-icon.svg",
]);

/** The protocol manifest the dashboard entry's build plugin emits. */
export const PROTOCOL_MANIFEST = "data-plane-protocol.json";

/**
 * The first four bytes of every font container format, so the check reads the
 * FILE and not its name. ADR 005 section 6 measured eight files named `.ttf` in
 * this repository that are in fact WOFF containers; an extension allowlist would
 * have passed all eight.
 */
const FONT_MAGIC = Object.freeze([
  Buffer.from("wOFF", "latin1"),
  Buffer.from("wOF2", "latin1"),
  Buffer.from("OTTO", "latin1"),
  Buffer.from("true", "latin1"),
  Buffer.from("ttcf", "latin1"),
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
]);

function fail(message) {
  throw new Error(`@seorak/dashboard build failed: ${message}`);
}

/** Does this buffer begin with a font container's magic bytes? */
export function looksLikeFont(head) {
  return FONT_MAGIC.some((magic) => head.subarray(0, magic.length).equals(magic));
}

/** Every file under a root, repo-relative and slash-separated, sorted. */
export function filesUnder(root) {
  const found = [];
  for (const entry of readdirSync(root, { recursive: true })) {
    if (typeof entry !== "string") continue;
    if (!statSync(join(root, entry)).isFile()) continue;
    found.push(entry.split(sep).join("/"));
  }
  return found.sort();
}

/**
 * The pinned OFL-1.1 font packages whose bytes this artifact may redistribute,
 * each with the licence text that travels beside it.
 *
 * Figtree is the product sans and display face; IBM Plex Mono is the mono. Both
 * are resolved from `packages/web`, which is the workspace that declares them
 * and whose build embedded or copied the bytes.
 */
const LICENSED_FONT_PACKAGES = Object.freeze([
  { specifier: "@fontsource/figtree", licence: "LICENSES/OFL-1.1-Figtree.txt" },
  { specifier: "@fontsource/ibm-plex-mono", licence: "LICENSES/OFL-1.1-IBM-Plex-Mono.txt" },
]);

/**
 * Every font binary in the staged artifact must be byte-identical to one a
 * pinned OFL-1.1 font package ships.
 *
 * Identity against the dependency, rather than a recorded hash list, is what
 * makes this self-verifying: the licence texts in `LICENSES/` are those
 * packages' own, the versions are pinned by the lockfile, and there is no second
 * place to update when a pin moves. Anything else that is a font fails, whatever
 * it is called and wherever in the build it came from — which is what lets the
 * `fonts` directory ship now that the face in it is one this repository can
 * evidence a licence for.
 */
function assertNoUnlicensedFontBinary(root) {
  // Resolved from packages/web, which is the workspace that declares the
  // dependency and whose build embedded these bytes. Named `resolver` rather
  // than `require`, because shadowing that identifier is what the boundary gate
  // forbids in a public workspace: the module graph has to stay statically
  // readable.
  const resolver = createRequire(join(webPackage, "package.json"));
  const licensed = new Set();
  for (const { specifier } of LICENSED_FONT_PACKAGES) {
    let directory;
    try {
      directory = join(dirname(resolver.resolve(`${specifier}/package.json`)), "files");
    } catch {
      fail(
        `cannot locate ${specifier}, so no font binary in this artifact can be shown to be the OFL-1.1 one it claims to be`,
      );
    }
    for (const entry of readdirSync(directory)) {
      licensed.add(
        createHash("sha256").update(readFileSync(join(directory, entry))).digest("hex"),
      );
    }
  }
  // The licence text has to travel with the bytes, so a package whose cuts are
  // staged and whose LICENSE is not is the same defect in the other direction.
  for (const { specifier, licence } of LICENSED_FONT_PACKAGES) {
    if (!existsSync(join(packageRoot, licence))) {
      fail(`${specifier} cuts may be staged but ${licence} is missing from this package`);
    }
  }
  const unlicensed = [];
  for (const file of filesUnder(root)) {
    const bytes = readFileSync(join(root, file));
    if (bytes.length < 4 || !looksLikeFont(bytes.subarray(0, 4))) continue;
    if (licensed.has(createHash("sha256").update(bytes).digest("hex"))) continue;
    unlicensed.push(file);
  }
  if (unlicensed.length > 0) {
    fail(
      `the staged artifact carries ${unlicensed.length} font binary file(s) that are not cuts of the OFL-1.1 packages this package licences ` +
        `(${LICENSED_FONT_PACKAGES.map((p) => p.specifier).join(", ")}): ${unlicensed.join(", ")}. ` +
        "ADR 005 decision 6: a published tarball is a redistribution, and this repository can evidence no licence for any other face.",
    );
  }
}

/** The data-plane protocol version this repository's `@seorak/types` declares. */
async function typesProtocolVersion() {
  const module = await import("@seorak/types/data-plane");
  const version = module.DATA_PLANE_PROTOCOL_VERSION;
  if (typeof version !== "number") {
    fail("@seorak/types declares no numeric DATA_PLANE_PROTOCOL_VERSION");
  }
  return version;
}

/**
 * The bundle declares the protocol version it was BUILT against, and the
 * collector refuses to serve a bundle that disagrees with the version it speaks.
 * This asserts the declaration the web build emitted is the one this
 * repository's types actually hold, so the file cannot go stale between the two
 * builds.
 */
async function assertProtocolManifest(root) {
  let declared;
  try {
    declared = JSON.parse(readFileSync(join(root, PROTOCOL_MANIFEST), "utf8"))
      .dataPlaneProtocolVersion;
  } catch (error) {
    fail(`${PROTOCOL_MANIFEST} is missing or unreadable: ${error.message}`);
  }
  const expected = await typesProtocolVersion();
  if (declared !== expected) {
    fail(
      `${PROTOCOL_MANIFEST} declares data-plane protocol ${String(declared)} but @seorak/types declares ${expected}`,
    );
  }
  return expected;
}

async function stagePackage() {
  execFileSync("npm", ["run", "build:dashboard", "--workspace", "@seorak/web"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!existsSync(join(webArtifact, "index.html"))) {
    fail(
      `the web dashboard entry emitted no document at ${relative(repositoryRoot, webArtifact)}`,
    );
  }

  const excluded = new Set(EXCLUDED_FROM_PACKAGE.map((entry) => entry.entry));
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const skipped = [];
  for (const entry of readdirSync(webArtifact)) {
    if (excluded.has(entry)) {
      skipped.push(entry);
      continue;
    }
    cpSync(join(webArtifact, entry), join(outdir, entry), { recursive: true });
  }
  if (skipped.length !== EXCLUDED_FROM_PACKAGE.length) {
    // An exclusion naming something the build no longer emits is how a stale
    // prohibition outlives its subject. Say so instead of passing.
    fail(
      `the exclusion list names ${EXCLUDED_FROM_PACKAGE.map((entry) => entry.entry).join(", ")}, ` +
        `but the web artifact emitted only ${skipped.join(", ") || "none of them"}. ` +
        "Remove the entry, or find out why the build stopped emitting it.",
    );
  }

  for (const required of REQUIRED_ARTIFACT_FILES) {
    if (!existsSync(join(outdir, required))) {
      fail(`the staged artifact is missing ${required}`);
    }
  }
  const protocolVersion = await assertProtocolManifest(outdir);
  assertNoUnlicensedFontBinary(outdir);

  const staged = filesUnder(outdir);
  const bytes = staged.reduce(
    (total, file) => total + statSync(join(outdir, file)).size,
    0,
  );
  console.log(
    `@seorak/dashboard staged ${staged.length} files, ${bytes} bytes, ` +
      `data-plane protocol ${protocolVersion}, ` +
      (skipped.length > 0 ? `without ${skipped.join(", ")}.` : "excluding nothing."),
  );
}

// Importing this module gets the pure helpers alone; only the command builds.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await stagePackage();
}
