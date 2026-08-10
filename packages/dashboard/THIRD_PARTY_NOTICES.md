# Third-party notices

What this **tarball** redistributes, and under what terms. Licences travel with
the artifact, not only with the git tree, which is why they are in the package's
`files` array rather than left in the repository.

The source tree's own record, covering files this artifact does not carry, is
`packages/web/THIRD_PARTY_NOTICES.md`. This file is about the built bytes.

---

## Figtree — OFL-1.1

**Source:** `@fontsource/figtree` (upstream: The Figtree Project Authors)
**Licence:** SIL Open Font License 1.1
**Full text:** [`LICENSES/OFL-1.1-Figtree.txt`](./LICENSES/OFL-1.1-Figtree.txt)

The product sans and display face. Four `.woff` cuts under `dist/fonts/` — 300
Light, 400 Regular, 500 Medium, 600 SemiBold — named by the `@font-face` block in
`packages/web/src/app.css` and byte-identical to the files the pinned
`@fontsource/figtree` ships. They are copied into `packages/web/public/fonts/`
under stable names rather than imported through the bundler, because the control
plane serves that same `public/` directory and its own stylesheet has to be able
to name the URLs.

The file above is the upstream package's own `LICENSE`, copied verbatim: the
copyright block plus the complete licence through TERMINATION and DISCLAIMER, as
OFL-1.1 clause 2 requires of any redistributed copy. The mobile surface carries
the same face from `@expo-google-fonts/figtree`, whose own
`LICENSE_FONT` differs from this text only in its copyright line and one trailing
space.

## IBM Plex Mono — OFL-1.1

**Source:** `@fontsource/ibm-plex-mono` (upstream: IBM Corp.)
**Licence:** SIL Open Font License 1.1
**Full text:** [`LICENSES/OFL-1.1-IBM-Plex-Mono.txt`](./LICENSES/OFL-1.1-IBM-Plex-Mono.txt)

`src/main.tsx` imports the Fontsource latin 400 and 500 stylesheets, so the build
embeds the font binaries and this package redistributes them. Four files under
`dist/assets/`, two `.woff2` and two `.woff`. OFL-1.1 clause 2 requires the
licence text to travel with any redistributed copy; the file above is the
upstream package's own `LICENSE`, copied verbatim, and it carries the copyright
block plus the complete licence through TERMINATION and DISCLAIMER.

The build asserts this rather than assuming it: every font binary in the staged
artifact must be byte-identical to a file the pinned `@fontsource/ibm-plex-mono`
ships, and anything else fails the build by magic bytes rather than by extension.

## Simple Icons — CC0-1.0

**Source:** [simple-icons/simple-icons](https://github.com/simple-icons/simple-icons) v15.0.0
**Licence:** CC0-1.0
**Notice:** [`LICENSES/CC0-1.0-Simple-Icons.txt`](./LICENSES/CC0-1.0-Simple-Icons.txt)

72 SVGs under `dist/assets/stack/`, identifying detected languages, frameworks,
package managers, file categories, and branch work. Descriptive use. Individual
logo trademarks remain with their respective owners.

## Application dependencies

The bundled JavaScript and CSS are compiled from this repository's dashboard
source together with its npm dependencies (React, zod, zustand, dnd-kit, clsx and
their transitive closure), each under its own permissive licence as declared in
`packages/web/package.json` and the repository lockfile. This package declares
**zero runtime dependencies**: nothing is resolved at install time, so a consumer
installs bytes rather than a dependency tree.

---

## What this artifact does NOT carry, and why

**No licensed face, and nothing whose licence this repository cannot evidence.**
Every font binary in the staged tree must be byte-identical to a cut of one of
the two pinned OFL-1.1 packages above. The build reads the staged files by MAGIC
BYTES rather than by name or extension, because eight files in this repository
named `.ttf` were in fact WOFF containers and an extension allowlist passed all
eight.

**What this replaced.** Until stage B5 the dashboard's `--sans` and `--display`
tokens named TT Commons Pro, TypeType LLC property under a EULA this repository
cannot evidence, and the build excluded the whole `fonts` directory rather than
redistribute it. The measured cost, against a real offline global install, was
four 404s on `/fonts/*.woff` per page load and every surface rendering in the
platform fallback stack the same tokens name after the product face
(`-apple-system`, `BlinkMacSystemFont`, `SF Pro`, `sans-serif`). B5 substituted
Figtree, so the directory ships and that gap is closed.
