# Third-party notices (web assets)

Seorak vendors the product typeface and semantic SVGs for dashboard display.
Icons identify detected stack/toolchain values in Compare and related views —
descriptive use, not product endorsement.

## Figtree (product sans and display)

**Source:** [erikdkennedy/figtree](https://github.com/erikdkennedy/figtree) via
`@fontsource/figtree 5.3.0` (web) and `@expo-google-fonts/figtree 0.4.1`
(mobile, loaded from the package at runtime rather than vendored here)
**License:** [OFL-1.1](https://openfontlicense.org/), full text at
[`packages/dashboard/LICENSES/OFL-1.1-Figtree.txt`](../dashboard/LICENSES/OFL-1.1-Figtree.txt)
**Vendored:** 2026-08-04
**Verified against upstream:** 2026-08-04, all four files byte-identical to the
pinned package

**Four `.woff` cuts** under `public/fonts/` at 300 / 400 / 500 / 600, named by
the `@font-face` block in `src/app.css`. That is the whole vendored set.

Re-sync: `node packages/web/scripts/sync-fonts.mjs`

**Why one container now.** Four `.ttf` cuts of the same family used to sit under
`apps/menubar/Sources/SeorakMenuBar/Resources/Fonts`, because the menu bar
resolved faces through CoreText, which cannot register a WOFF container, and
`@fontsource/*` ships woff and woff2 only. That surface was removed on
2026-08-10 and its TrueType copies went with it. Mobile loads the face from
`@expo-google-fonts/figtree` directly, so nothing in this repository vendors a
second container. The files that TrueType set had replaced were WOFF containers
named `.ttf`, which is why every check below reads magic bytes rather than
extensions.

**Why the web copies are vendored rather than imported.** The mono below is
imported through the bundler and lands under a content hash. The product sans
cannot be, because `packages/control-plane` serves this package's `public/`
directory as its `[assets]` root and writes its own `@font-face` block naming
`/fonts/*.woff` literally.

**This is checked, not just recorded.** Every copy is byte-identical to a file
its pinned package ships;
[`docs/reference/vendored-assets.json`](../../docs/reference/vendored-assets.json)
records a digest over each collection and `npm run vendored-assets:check`
recomputes it offline. `packages/dashboard/scripts/build-package.mjs` asserts the
same relation before it will stage any font binary at all, reading the staged
files by magic bytes rather than by extension.

## IBM Plex Mono (values, commands, chrome labels)

**Source:** IBM Corp. via `@fontsource/ibm-plex-mono`
**License:** [OFL-1.1](https://openfontlicense.org/), full text at
[`packages/dashboard/LICENSES/OFL-1.1-IBM-Plex-Mono.txt`](../dashboard/LICENSES/OFL-1.1-IBM-Plex-Mono.txt)

Imported at 400 and 500 by `src/main.tsx` and `src/marketing/main.tsx`, so the
bundler embeds the binaries under `dist/assets/`. Nothing is vendored for it and
there is no copy in this repository to drift.

## Simple Icons (stack badges)

**Source:** [simple-icons/simple-icons](https://github.com/simple-icons/simple-icons) v15.0.0  
**Collection license:** [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)  
**Vendored:** 2026-07-06 (full registry sync)  
**Verified against upstream:** 2026-08-04, all 72 files byte-identical to v15.0.0

**72 icons** under `public/assets/stack/` — languages (24), frameworks (22), package managers (14), file categories (7), branch work (5).

Re-sync: `node packages/web/scripts/sync-stack-icons.mjs`

Slug aliases (enum id → Simple Icons slug) are documented in `packages/web/scripts/sync-stack-icons.mjs`.

Individual logo trademarks remain with their respective owners. Per-icon license: [simpleicons.org](https://simpleicons.org).

**This version is checked, not just recorded.** `simple-icons` is a dependency of
no manifest here; these files were fetched and committed, so until B7 the version
above was a claim about one afternoon that no later edit could falsify.
[`docs/reference/vendored-assets.json`](../../docs/reference/vendored-assets.json)
now records a digest over all 72 files and `npm run vendored-assets:check`
recomputes it, so editing a vendored icon, adding one, or removing one fails
offline. It also fails if this file and that record disagree about the version or
the sync date.

The digest proves the bytes are the ones verified on 2026-08-04. Confirming they
still match upstream needs the re-sync command above and a network; that limit is
stated rather than papered over.

## AI coding tools: removed, and what they actually were

**There are no vendored AI-tool marks under `public/assets/` any more, and
`src/lib/toolMeta.ts` renders a colored letter for every tool instead.**

Thirteen files used to sit here, recorded as coming from Simple Icons and
"vendored manually (no version pin recorded)". ADR 005 section 6 flagged them for
qualified legal review as third-party trademarks, and its `packages/web` section
set the condition for keeping them: stage B7 re-syncs all thirteen from a pinned
`simple-icons` version and records the version and date, or `toolMeta.ts` falls
back to a text glyph and no vendored marks go public.

**B7 measured each file against upstream on 2026-08-04 and the re-sync is not
achievable.** The provenance line was also wrong in both directions: most of
these were never Simple Icons content, and two were third-party marks from a
source nobody recorded.

| File | Tool | What it actually was |
|---|---|---|
| `claude-code.svg` | Claude Code | Simple Icons `anthropic`, byte-identical at v15.0.0 |
| `windsurf.svg` | Windsurf | Simple Icons `windsurf`, byte-identical at v15.0.0 |
| `jetbrains.svg` | JetBrains | Simple Icons `jetbrains`, byte-identical at v15.0.0 |
| `github-copilot.svg` | GitHub Copilot | Simple Icons `githubcopilot`, byte-identical at v15.0.0 |
| `cursor.svg` | Cursor | Simple Icons `cursor`, byte-identical at **master**, and absent at v15.0.0 |
| `vscode.svg` | VS Code | a Visual Studio Code mark. Simple Icons carries no `visualstudiocode` at v15.0.0 or at master. **Source unrecorded** |
| `codex.svg` | Codex | an OpenAI Codex mark, in a different format entirely: `viewBox="0 0 158.7128 157.296"`, no `role="img"`, no `<title>`. Not Simple Icons output. **Source unrecorded** |
| `warp.svg` | Warp | a hand-drawn glyph. Simple Icons `warp` exists and is a different image |
| `zed.svg` | Zed | a hand-drawn glyph. Simple Icons `zedindustries` exists and is a different image |
| `cline.svg` | Cline | a hand-drawn glyph. Simple Icons `cline` exists at master and is a different image |
| `aider.svg` | Aider | a hand-drawn glyph. Simple Icons has no such slug |
| `amazon-q.svg` | Amazon Q | a hand-drawn glyph with hardcoded fills. Simple Icons has no such slug |
| `continue.svg` | Continue | a hand-drawn glyph. Simple Icons has no such slug |

Comparison method: fetch `raw.githubusercontent.com/simple-icons/simple-icons/<ref>/icons/<slug>.svg`
at `15.0.0` and at `master`, compare content ignoring a trailing newline.

**Five of thirteen were genuine Simple Icons content, one of those only at a
version the record does not name, and six were original artwork drawn in this
repository that the notices file attributed to a third party.** A collection
cannot be pinned to a version that does not contain it, so options (a) and (b)
in the stage brief — re-sync from a pin, or take the dependency — are unavailable
for eight of the thirteen whatever version is chosen.

Taking the fallback also **removes the legal question rather than deferring it**:
precondition P2 asks outside counsel whether vendoring thirteen third-party
trademarks in a public Apache-2.0 repository is acceptable, and with nothing
vendored there is nothing for that half of the review to rule on. P2's other
half, the six agent brand-mark PNGs under `apps/mobile/assets/agents`, is
untouched by this and remains open.

**Restoring any of these is a deliberate decision, not a correction.** It needs a
collection entry in
[`docs/reference/vendored-assets.json`](../../docs/reference/vendored-assets.json)
with an upstream source, a version, a sync date, and a digest, and it needs P2
answered. `npm run vendored-assets:check` refuses an undeclared file under
`public/assets`, so the shortcut is closed rather than discouraged.

## Seorak brand assets

`logo-mark.svg`, `favicon.svg`, `seorak-icon.svg`, `og-image.svg`,
`og-image.png` — original Seorak product assets, not third-party content and not
covered by the licences above. Apache-2.0 section 6 grants no trademark rights;
see [TRADEMARK.md](../../TRADEMARK.md), which is a draft.
