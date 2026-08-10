import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXCLUDED_FROM_PACKAGE,
  PROTOCOL_MANIFEST,
  REQUIRED_ARTIFACT_FILES,
  filesUnder,
  looksLikeFont,
} from "../scripts/build-package.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);

test("the package promises only what a static artifact can keep", () => {
  assert.equal(manifest.name, "@seorak/dashboard");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.main, undefined);
  assert.equal(manifest.types, undefined);
  assert.equal(manifest.bin, undefined);
  // ADR 005 decision 3, in terms: two subpaths, so a consumer resolves the
  // manifest and derives the asset root from it.
  assert.deepEqual(manifest.exports, {
    "./package.json": "./package.json",
    "./dist/*": "./dist/*",
  });
});

test("zero runtime dependencies, so the collector's audit closure is unchanged", () => {
  // ADR 005 decision 3 rests on this: the collector's production install has to
  // stay at zero advisories, and it cannot if this package brings a tree.
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  assert.equal(manifest.optionalDependencies, undefined);
});

test("the licences that must travel with the bytes are in the files array", () => {
  for (const required of ["THIRD_PARTY_NOTICES.md", "LICENSES", "LICENSE", "dist"]) {
    assert.ok(
      manifest.files.includes(required),
      `${required} is not packed, so it would not travel with a published tarball`,
    );
  }
  for (const path of [
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "LICENSES/OFL-1.1-IBM-Plex-Mono.txt",
    "LICENSES/CC0-1.0-Simple-Icons.txt",
  ]) {
    assert.ok(existsSync(join(packageRoot, path)), `${path} does not exist`);
  }
});

test("OFL-1.1 clause 2 is satisfied by the whole licence, not a copyright dump", () => {
  const text = readFileSync(
    join(packageRoot, "LICENSES/OFL-1.1-IBM-Plex-Mono.txt"),
    "utf8",
  );
  for (const marker of [
    "SIL OPEN FONT LICENSE Version 1.1",
    "PERMISSION & CONDITIONS",
    "TERMINATION",
    "DISCLAIMER",
  ]) {
    assert.ok(text.includes(marker), `the OFL text is missing ${marker}`);
  }
});

test("nothing the entry emits is withheld, and an exclusion would name its reason", () => {
  // This asserted `["fonts"]`, for TT Commons Pro. B5 substituted the licensed
  // face for OFL-1.1 Figtree, whose text travels in LICENSES/, so the artifact
  // now carries everything the build emits and the list is empty. The rule that
  // survives the change is the one worth testing: an entry may only appear with
  // a licensing reason attached.
  assert.deepEqual(EXCLUDED_FROM_PACKAGE, []);
  for (const entry of EXCLUDED_FROM_PACKAGE) {
    assert.match(entry.why, /ADR 005 decision 6/);
  }
});

test("font containers are recognised by magic bytes, not by extension", () => {
  // ADR 005 section 6 measured eight files named `.ttf` in this repository that
  // are WOFF containers. An extension test passes all eight.
  assert.equal(looksLikeFont(Buffer.from("wOFF", "latin1")), true);
  assert.equal(looksLikeFont(Buffer.from("wOF2", "latin1")), true);
  assert.equal(looksLikeFont(Buffer.from("OTTO", "latin1")), true);
  assert.equal(looksLikeFont(Buffer.from("ttcf", "latin1")), true);
  assert.equal(looksLikeFont(Buffer.from("true", "latin1")), true);
  assert.equal(looksLikeFont(Buffer.from([0x00, 0x01, 0x00, 0x00])), true);
  assert.equal(looksLikeFont(Buffer.from("<svg", "latin1")), false);
  assert.equal(looksLikeFont(Buffer.from("<!do", "latin1")), false);
});

test("the required-file list names the document and the protocol manifest", () => {
  assert.ok(REQUIRED_ARTIFACT_FILES.includes("index.html"));
  assert.ok(REQUIRED_ARTIFACT_FILES.includes(PROTOCOL_MANIFEST));
});

test("a staged artifact, when one is present, keeps every promise above", (t) => {
  const dist = join(packageRoot, "dist");
  if (!existsSync(join(dist, "index.html"))) {
    t.skip("no staged artifact; `npm run build:publish` stages one");
    return;
  }
  const files = filesUnder(dist);
  for (const required of REQUIRED_ARTIFACT_FILES) {
    assert.ok(files.includes(required), `staged artifact is missing ${required}`);
  }
  // EVERY FONT THE ARTIFACT CARRIES TRAVELS WITH ITS LICENCE. This asserted the
  // artifact carried no `fonts/` at all, which was right while the face was TT
  // Commons Pro and `EXCLUDED_FROM_PACKAGE` named it. B5 substituted OFL-1.1
  // Figtree, so the fonts SHIP now, and the promise that survives is ADR 005
  // decision 6's: the licence text goes with the redistributed bytes.
  const fonts = files.filter((file) =>
    looksLikeFont(readFileSync(join(dist, file)).subarray(0, 4)),
  );
  for (const licence of ["LICENSES/OFL-1.1-Figtree.txt", "LICENSES/OFL-1.1-IBM-Plex-Mono.txt"]) {
    assert.ok(
      !fonts.length || existsSync(join(packageRoot, licence)),
      `the artifact carries ${fonts.length} font container(s) and the package does not carry ${licence}`,
    );
  }
  const declared = JSON.parse(
    readFileSync(join(dist, PROTOCOL_MANIFEST), "utf8"),
  ).dataPlaneProtocolVersion;
  assert.equal(typeof declared, "number");
});
