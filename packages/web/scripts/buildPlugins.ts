import { createHash } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DATA_PLANE_PROTOCOL_VERSION } from "@seorak/types/data-plane";
import type { Plugin } from "vite";
import {
  DIRECTORY_EXPERIENCE_ENABLED,
  DIRECTORY_PRODUCT_NOTE_PATH,
} from "../src/lib/directoryExperience.js";

/**
 * Build plugins both entries share. `vite.config.ts` builds the dashboard and
 * `vite.site.config.ts` builds Seorak's website; the byte ceilings and the CSP
 * hash are the same MECHANISM with different numbers, so the mechanism lives
 * once here and each config supplies its own numbers.
 */

export interface ChunkBudget {
  /**
   * What a visitor waits on before anything renders, keyed on the ENTRY chunk
   * rather than on a name: a build can emit several chunks called `index` and a
   * name-keyed ceiling silently applies to all of them, so a failure would not
   * identify which one grew.
   */
  entry: number;
  /** Named non-entry chunks, by rollup chunk name. */
  chunks?: Record<string, number>;
}

/**
 * Fails the build when a budgeted chunk exceeds its ceiling. Reports every
 * violation at once, with the measured size and the overage, so one build tells
 * you the whole story instead of one chunk at a time.
 *
 * `SEORAK_CHUNK_BUDGET=report` downgrades the failure to a warning. Exactly one
 * caller sets it — owner-cell provisioning in `packages/worker/scripts/
 * guarded-web-build.mjs`, which builds this bundle only because the cell serves
 * it as static assets. A dashboard size budget must not be able to make a
 * customer's private API and MCP surface unprovisionable. Every other build,
 * including CI and the repository owner's own deploy, still fails, so an overage
 * is never quietly accepted; it just cannot hold someone else's cell hostage.
 *
 * All sizes measured here are what this plugin sees, which for an ENTRY chunk is
 * roughly 900 bytes below its final on-disk size: Vite rewrites the preload
 * dependency array after `generateBundle`. Compare against the number in the
 * failure message, not against `ls`.
 */
export function chunkBudget(budget: ChunkBudget): Plugin {
  const enforced = process.env.SEORAK_CHUNK_BUDGET !== "report";
  const named = budget.chunks ?? {};
  return {
    name: "seorak-chunk-budget",
    generateBundle(_options, bundle) {
      const over: string[] = [];
      // How many chunks each named ceiling actually matched. A ceiling that
      // lands on two different chunks is not a ceiling on either of them, and
      // the only thing worse than a budget that fails is one that passes for a
      // reason nobody can see.
      const matched = new Map<string, number>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const entry = output.isEntry;
        const ceiling = entry ? budget.entry : named[output.name];
        if (ceiling === undefined) continue;
        const label = entry ? `entry:${output.name}` : output.name;
        matched.set(label, (matched.get(label) ?? 0) + 1);
        const bytes = Buffer.byteLength(output.code, "utf8");
        if (bytes > ceiling) {
          over.push(
            `  ${label} (${output.fileName}): ${bytes} bytes exceeds its ${ceiling} ceiling by ${bytes - ceiling}`,
          );
        }
      }
      for (const [label, count] of matched) {
        if (count > 1) {
          over.push(
            `  ${label}: ${count} chunks share this ceiling, so it bounds none of them. Give the budgeted chunk a distinct name.`,
          );
        }
      }
      if (over.length === 0) return;
      const report = `chunk byte budget exceeded:\n${over.join("\n")}\n`;
      if (enforced) {
        this.error(
          report + "Shrink the chunk, or raise the ceiling in the entry's vite config and say why.",
        );
      }
      this.warn(
        report +
          "SEORAK_CHUNK_BUDGET=report: continuing so this cannot block provisioning. " +
          "Every enforcing build still fails until it is shrunk or the ceiling is raised.",
      );
    },
  };
}

/**
 * Copy an EXPLICIT list of static files into the artifact, instead of the whole
 * `public/` directory.
 *
 * `public/` holds three different things: icons the dashboard renders, the
 * licensed font binaries, and Seorak's own brand and social-card artwork. Vite's
 * `publicDir` copies all of it, so a dashboard artifact built that way would
 * carry the marketing site's Open Graph image and logo files, which the
 * ownership map places private. Naming what the dashboard needs is the only way
 * the artifact can be checked against that map rather than assumed to match it.
 *
 * A missing entry throws. Silently shipping an artifact with no icons is the
 * outcome this is meant to prevent.
 */
export function publicAssets(sourceDir: string, include: readonly string[]): Plugin {
  let outDir = "dist";
  return {
    name: "seorak-public-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      for (const entry of include) {
        const from = resolve(sourceDir, entry);
        const to = resolve(outDir, entry);
        await mkdir(dirname(to), { recursive: true });
        await cp(from, to, { recursive: true, errorOnExist: false });
      }
    },
  };
}

/** The file name the dashboard artifact declares its protocol version in. */
export const PROTOCOL_MANIFEST_FILE = "data-plane-protocol.json";

/**
 * Write the data-plane protocol version this bundle was BUILT against into the
 * artifact, so a consumer can read it without executing the bundle.
 *
 * WHY A BUNDLE HAS TO DECLARE THIS. The dashboard freezes its copy of
 * `@seorak/types` at build time; the collector resolves its own at runtime. The
 * two constants are compared with a strict `!==` inside `parseDataPlaneStatus`,
 * so a bundle built against a different protocol does not degrade, it returns
 * null, and `dataPlane.ts` reads that as "unknown authority" and leaves the app
 * on its sign-in path. The account-free product would silently become a sign-in
 * wall, with nothing in any log saying why.
 *
 * A version the artifact carries turns that into a named refusal the collector
 * makes before it serves a byte. It is emitted here, from the build that
 * resolved the module, rather than hand-written in a manifest: a number a person
 * maintains beside a build is a number that goes stale exactly once and then
 * lies.
 */
export function dataPlaneProtocol(): Plugin {
  let outDir = "dist";
  return {
    name: "seorak-data-plane-protocol",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      await writeFile(
        resolve(outDir, PROTOCOL_MANIFEST_FILE),
        JSON.stringify(
          {
            dataPlaneProtocolVersion: DATA_PLANE_PROTOCOL_VERSION,
            note: "GENERATED by scripts/buildPlugins.ts. The data-plane protocol this bundle was built against. A plane serving it must speak the same version; see packages/collector/src/local-plane.ts.",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    },
  };
}

/**
 * The response headers Cloudflare's asset system applies, written per entry with
 * the CSP script hash COMPUTED FROM THAT ENTRY'S EMITTED DOCUMENT.
 *
 * WHY THIS IS GENERATED. `public/_headers` used to be a committed file pinning
 * one `sha256-...` to the one inline pre-paint theme script, and its comment
 * asserted "Seorak is ONE single-page app". That is exactly the assumption the
 * entry split breaks: there are two documents now, their theme scripts differ
 * (the site's has to ask which half of the site it is on, the dashboard's does
 * not), and so their hashes differ.
 *
 * A hand-maintained hash is the worst kind of wrong. A stale one fails NOTHING
 * at build time and then fails silently in a browser: the script is blocked, the
 * page first-paints unstyled, and the only evidence is a console violation
 * nobody is watching. Deriving it from the bytes that were actually emitted
 * removes the failure mode rather than documenting it.
 *
 * Written in `writeBundle` with the emitted html in hand, so it hashes what the
 * browser will hash and not what the source said before Vite touched it.
 */
export function cspHeaders(): Plugin {
  let outDir = "dist";
  return {
    name: "seorak-csp-headers",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle(_options, bundle) {
      const documents: string[] = [];
      const hashes = new Set<string>();
      for (const [fileName, output] of Object.entries(bundle)) {
        if (!fileName.endsWith(".html")) continue;
        if (output.type !== "asset") continue;
        const html =
          typeof output.source === "string"
            ? output.source
            : Buffer.from(output.source).toString("utf8");
        documents.push(fileName);
        for (const script of inlineScripts(html)) {
          hashes.add(`'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`);
        }
      }
      if (documents.length === 0) {
        this.error(
          "[csp-headers] this build emitted no html document, so there is nothing to hash. " +
            "A _headers file written anyway would pin a policy to a page that does not exist.",
        );
      }
      await writeFile(resolve(outDir, "_headers"), headersFile([...hashes]), "utf8");
    },
  };
}

/**
 * The contents of every inline `<script>` in a document, in source order.
 *
 * `src=` scripts are skipped: nothing hashes them, `'self'` allows them. So are
 * data blocks — a `type` a browser will not execute, such as the
 * `application/ld+json` structured data `build:discovery` injects into every
 * marketing route. A browser neither runs nor fetches those, so hashing them
 * would widen `script-src` for something that was never a script.
 *
 * What remains is hashed over the bytes between the tags exactly, which is what
 * a browser hashes.
 */
const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

export function inlineScripts(html: string): string[] {
  const bodies: string[] = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\stype\s*=\s*"([^"]*)"/i)?.[1] ?? "").trim().toLowerCase();
    if (!EXECUTABLE_SCRIPT_TYPES.has(type)) continue;
    const body = match[2] ?? "";
    if (body.trim() === "") continue;
    bodies.push(body);
  }
  return bodies;
}

/**
 * The header rules, with `script-src` carrying the measured hashes.
 *
 * `connect-src 'self'` holds for BOTH entries and is not an oversight: the
 * dashboard reads the origin that served it, and the site's API is on its own
 * origin. Neither is allowed to reach a third party, which is the property worth
 * having in a file that is easy to widen by accident.
 */
/**
 * `X-Robots-Tag: noindex` for the addresses the hidden Directory used to serve
 * whose response a `<meta>` tag cannot reach.
 *
 * The enumerable HTML addresses get a real document with `noindex` in the head
 * (`RETIRED_DIRECTORY_ROUTES` in src/marketing/discovery.ts). These are the rest,
 * and they need a HEADER rather than a tag for two different reasons:
 *
 *   - `/@/<slug>` is unbounded. No build can emit a document per profile, so no
 *     build can put a tag in one.
 *   - `openapi.json`, `llms*.txt` and the generated `.md` reads are not HTML.
 *     A robots meta tag inside a JSON or text body is just bytes; the header is
 *     the only channel a crawler reads for a non-HTML response.
 *
 * A header is also correct for the HTML ones, so the rules deliberately overlap
 * the documents rather than carving around them: two independent signals asking
 * for the same removal, neither of which can break a route, which is the whole
 * point after `run_worker_first` took the data plane down.
 *
 * Empty while the Directory is enabled — these are live addresses then.
 */
function retiredDirectoryHeaders(): string {
  if (DIRECTORY_EXPERIENCE_ENABLED) return "";
  const paths = [
    "/developers",
    "/docs",
    "/docs/*",
    "/@/*",
    "/openapi.json",
    "/llms.txt",
    "/llms-full.txt",
    DIRECTORY_PRODUCT_NOTE_PATH,
  ];
  return `
# The public Directory is hidden. These addresses were indexed while it shipped,
# so they ask to be dropped rather than going quiet. They are NOT disallowed in
# robots.txt: a crawler that is forbidden to fetch them never reads this header.
${paths.map((path) => `${path}\n  X-Robots-Tag: noindex\n`).join("")}`;
}

export function headersFile(scriptHashes: readonly string[]): string {
  const scriptSrc = ["'self'", ...scriptHashes].join(" ");
  return `# GENERATED by scripts/buildPlugins.ts during the build. Do not edit; edit the plugin.
#
# Written at the artifact root, where Workers Static Assets (and Cloudflare Pages)
# parse it and apply the rules to static-asset responses.
#
# script-src carries a sha256 for every inline script in THIS entry's emitted
# document, computed from the emitted bytes. Each entry therefore has its own
# hash, and a hash cannot go stale, which is the failure a committed _headers had
# no way to catch: a blocked pre-paint theme script does not fail a build, it
# fails as an unstyled first paint in someone's browser.

/*
  Content-Security-Policy: default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'self'; object-src 'none'
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  # TODO: when partner IDE-embed origins are confirmed, append them to
  # frame-ancestors above (space-separated, e.g. "frame-ancestors 'self' https://partner.example").
${retiredDirectoryHeaders()}`;
}
