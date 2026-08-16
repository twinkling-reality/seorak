# @seorak/dashboard

Seorak's primary dashboard, built. This package is **static assets**, not source
and not a library: there is nothing here to import and no code to call.

Its one runtime consumer is [`seorak`](https://www.npmjs.com/package/seorak), the
collector CLI, which serves it from the local data plane on your own machine.
Installing the collector installs this, and `seorak local dashboard` opens it.

```bash
npx seorak setup
npx seorak local dashboard
```

No account, no key, and no Seorak service connection after the package download.
The dashboard reads the plane that served it. `seorak init` remains a supported
compatibility alias for existing global installs and scripts.

The CLI package was renamed from `@seorak/collector` to the unscoped `seorak`,
and the commands above require `seorak@0.2.0`, which this repository prepares but
does not publish. `@seorak/collector@0.1.1` remains the last registry release
under the old name.

## What is in it

`dist/` is the artifact:

| Path | What |
|---|---|
| `index.html` | the entry document, and the single-page fallback a plane serves for any in-app route |
| `assets/` | the application bundle, its lazy view chunks, stylesheets, and the stack iconography |
| `data-plane-protocol.json` | the data-plane protocol version this bundle was built against |
| `_headers` | the Content-Security-Policy for a static host, with the script hash computed from the emitted document |

## Resolving it

There is no `main` and no default export. The package declares exactly two
subpaths:

```json
{ "exports": { "./package.json": "./package.json", "./dist/*": "./dist/*" } }
```

A consumer locates the asset root from the resolved manifest:

```js
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const manifest = createRequire(import.meta.url).resolve("@seorak/dashboard/package.json");
const assets = join(dirname(manifest), "dist");
```

**Not by walking sibling paths.** A `../dashboard/dist` probe serves the wrong
copy the moment npm nests the dependency, and it cannot work at all under Yarn
PnP. Resolution is the package manager's answer, and asking it is one line.

## Protocol version

`dist/data-plane-protocol.json` declares the `DATA_PLANE_PROTOCOL_VERSION` this
bundle was compiled against. A plane serving it must speak the same version.

This matters more than a version file usually does. The dashboard freezes its
copy of `@seorak/types` at build time and a plane resolves its own at runtime;
the two are compared with a strict `!==`, so a mismatched bundle does not degrade
gracefully. It reads the plane's descriptor as unparseable, concludes the
authority is unknown, and shows a sign-in screen instead of the machine's own
history. A serving plane should read this file and refuse a mismatch by name; the
collector does.

## Licence

Apache-2.0, in [`LICENSE`](./LICENSE).

Redistributed third-party content and its terms are in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md), with full texts under
[`LICENSES/`](./LICENSES). This package declares **zero runtime dependencies**.

Apache-2.0 section 6 grants no trademark rights. The Seorak name and mark are not
covered by the licence above.

## Building it

The source is the dashboard entry of `packages/web` in the Seorak repository.

```bash
npm run build:publish --workspace @seorak/dashboard
```

That runs the web dashboard build and stages what it emitted. The staged tree is
checked before it can be packed: the required files must exist, the declared
protocol version must match the repository's types, and every font binary must be
byte-identical to a cut of the OFL-1.1 face this package licences.
