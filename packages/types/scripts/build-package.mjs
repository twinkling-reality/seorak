import {
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

import { writeBuildStamp } from "./build-stamp.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(packageRoot, "dist");
const entries = [
  "index",
  "mobile",
  "api",
  "event-protocol",
  "events",
  "event-validation",
  // Declared in package.json `exports`. An entry missing here builds no file,
  // so the subpath resolves to nothing in the published artifact.
  "entitlements",
  "compact-sync",
  "data-plane",
  "push",
  "session",
  "intervention",
  "summary",
  "projections",
  "widgets",
];

rmSync(outdir, { recursive: true, force: true });
await build({
  absWorkingDir: packageRoot,
  entryPoints: Object.fromEntries(
    entries.map((entry) => [entry, `src/${entry}.ts`]),
  ),
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  packages: "external",
  sourcemap: false,
});
execFileSync(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
    "--project",
    join(packageRoot, "tsconfig.publish.json"),
  ],
  { cwd: packageRoot, stdio: "inherit" },
);

for (const entry of readdirSync(outdir, { recursive: true })) {
  if (typeof entry !== "string" || !entry.endsWith(".d.ts")) continue;
  const path = join(outdir, entry);
  const declaration = readFileSync(path, "utf8");
  const rewritten = declaration.replace(
    /(["'])(\.\.?\/[^"']+)\.ts\1/g,
    (_match, quote, specifier) => `${quote}${specifier}.js${quote}`,
  );
  if (rewritten !== declaration) writeFileSync(path, rewritten, "utf8");
}

// Last, and only on a build that got this far. `dist/` is gitignored and is
// rebuilt only by `postinstall`, `npm run typecheck` and `prepack`, none of which
// a developer runs while changing a file, so a checkout that changes `src/`
// leaves every consumer importing the previous contract. The stamp is what
// `types-dist:check` compares `src/` against;
// `build-stamp.mjs` says why it is a content hash and not an mtime.
writeBuildStamp(packageRoot);
