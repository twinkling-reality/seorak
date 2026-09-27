# Seorak

Performance tracking for agentic development.

Seorak watches Claude Code and Codex on your machine, commits every event to
SQLite in your home directory, and answers questions about it: what a session
cost, what it produced, and what your own record says about how you work. No
account, no key, no Seorak service connection, and no product-data upload.

This repository is the **public core**, Apache-2.0. It is the whole local
product: capture, the permanent local history, the primary dashboard, the
terminal, reports, replay, export, and local intervention. A managed remote
service is planned alongside it, to be sold only once managed operations and an
approved payment path are proven; that service is built in a private repository
and is not here. What is where, and why:
[`docs/adr/005`](docs/adr/005-open-core-repository-and-free-ui-packaging.md).

**Set it up from npm** with one temporary package run and no global install:

```bash
npx seorak setup
```

The CLI's npm package is the unscoped `seorak`, renamed from
`@seorak/collector` so the command you type names the product rather than one of
its internal parts. The directory in this tree stays `packages/collector`.

`@seorak/types@0.2.0` and `seorak@0.3.0` published to npm on 2026-09-27 with provenance attesting to this
repository, so the command above resolves. `seorak@0.2.0` published on 2026-08-16. `@seorak/collector@0.1.1` is the last
release under the old name.
Setup keeps the background runtime under Seorak's own state so hooks and capture
do not depend on npm's temporary execution cache.

Building from this tree still works, and the rest of this page describes it.

---

## Run it from this tree

Node **22.18 or newer**. npm workspaces; no other package manager is configured.

```bash
npm install
```

That installs every workspace and builds `@seorak/types`, which the others
resolve against.

```bash
npm run build:dashboard
```

That builds the primary dashboard into `packages/web/dist-dashboard`. The
collector looks for exactly that sibling directory when the built
`@seorak/dashboard` package has not been staged, so this is the step that makes
the dashboard appear.

```bash
npm run link:cli
seorak setup
```

`seorak setup` installs the Claude Code hooks, registers the background
collector, and starts recording. `seorak init` remains a supported compatibility
alias. Codex capture needs no extra step: the daemon tails `~/.codex/sessions`
if that directory exists. It asks for no account, connects to no Seorak service,
and a local-only install is a healthy install. Restart Claude Code so the hooks
load.

Then do some work, and read it:

```bash
seorak                              # the live board in your terminal
seorak local dashboard              # opens http://127.0.0.1:4317/dashboard
seorak local report                 # the period read, in prose
seorak local sessions               # every session, as JSON for a script to read
seorak local replay <session-id>    # the keyframes worth reviewing
seorak status                       # every line is a check, every failure prints its remedy
```

The dashboard on loopback is the **primary** dashboard, with the customizable
widget layout, Compare, and the project views. It is not a simplified second
interface, which is
[ADR 003](docs/adr/003-one-primary-ui-over-a-modular-data-plane.md).

Most stats stay honest-empty until you have accumulated sessions, commits, and
days. That is the product being truthful rather than a bug.

Full install, self-hosting, and configuration: [`SETUP.md`](SETUP.md).

---

## What is in here

| Path | Role |
|------|------|
| `packages/collector/` | Hooks, daemon, the loopback and self-hosted data plane, the `seorak` terminal |
| `packages/types/` | The wire contracts every surface agrees on |
| `packages/web/` | The dashboard's source. A mixed workspace: the dashboard is here, Seorak's website is not |
| `packages/dashboard/` | The built dashboard as a package, `@seorak/dashboard`, which the collector resolves by name |
| `scripts/` | The gates, including the two that keep this boundary honest |

`packages/web` builds one thing here, the dashboard entry. The marketing site,
the blog, the pricing and legal pages, and the discovery documents are Seorak's
own website and stay private, so `npm run build:dashboard` is the whole web build
in this repository.

---

## Working on it

```bash
npm run dev:web        # Vite, proxying /api to the collector's plane on 127.0.0.1:4317
npm run dev:collector  # the daemon in the foreground, reloading on change
npm run check          # typecheck, then the full gate set and every suite
```

`npm run check` is not just unit tests: `npm run test` inside it is the whole gate
set, including the boundary gates, the copy contract, the dependency-advisory
policy, the governance files, vendored-asset provenance, and a publication gate
that packs the tarballs and installs them. CI runs the same content as separately
named steps, and fails if this repository's `test` script grows a gate the
workflow does not run. [`CONTRIBUTING.md`](CONTRIBUTING.md) lists the gates you
are most likely to trip and what each refuses.

---

## Documents

| Document | For |
|---|---|
| [`docs/VISION.md`](docs/VISION.md) | what the product is for |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | package boundaries and data flow |
| [`docs/STATUS.md`](docs/STATUS.md) | shipped versus planned, per surface |
| [`docs/specs/`](docs/specs/) | the local and protocol contracts |
| [`docs/adr/`](docs/adr/) | the decisions this repository is built on |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | how to change it, and what a change has to pass |
| [`SECURITY.md`](SECURITY.md) | reporting a vulnerability, and the window you get |
| [`LICENSING-POLICY.md`](LICENSING-POLICY.md) | the inbound licence and the sign-off |
| [`TRADEMARK.md`](TRADEMARK.md) | the name and the mark, which the code licence does not cover. Draft |

---

## Licence

Apache-2.0. Each published package carries its own `LICENSE`:
`packages/collector`, `packages/types`, and `packages/dashboard`. Third-party
notices travel with the artifact that embeds them: `@seorak/dashboard` bundles
two OFL-1.1 typefaces and a CC0-1.0 icon set, so its tarball carries
`THIRD_PARTY_NOTICES.md` and `LICENSES/`, and a gate fails the release if either
is missing. A licence has to reach whoever receives the bytes, not only whoever
reads the tree.

Contributions are accepted under Apache-2.0, certified by a `Signed-off-by`
line. [`LICENSING-POLICY.md`](LICENSING-POLICY.md) is the only agreement
involved, and it is short.
