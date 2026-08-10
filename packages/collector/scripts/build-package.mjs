import { rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(packageRoot, "dist");
const bins = [
  "seorak.mjs",
  "hook-session-start.mjs",
  "hook-tool-use.mjs",
  "hook-session-end.mjs",
  "hook-notification.mjs",
  "hook-user-prompt.mjs",
  "daemon.mjs",
];

rmSync(outdir, { recursive: true, force: true });
const result = await build({
  absWorkingDir: packageRoot,
  entryPoints: Object.fromEntries(
    bins.map((entry) => [
      basename(entry, extname(entry)),
      `bin/${entry}`,
    ]),
  ),
  outdir,
  outExtension: { ".js": ".mjs" },
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  metafile: true,
  sourcemap: false,
});

const foreignInputs = Object.keys(result.metafile.inputs).filter((input) => {
  const normalized = input.replaceAll("\\", "/");
  return !normalized.startsWith("bin/") && !normalized.startsWith("src/");
});
if (foreignInputs.length > 0) {
  throw new Error(
    `collector publication build copied foreign package inputs: ${foreignInputs.join(", ")}`,
  );
}
