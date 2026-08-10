# Contributing to Seorak

Seorak measures how agentic development actually goes: what a session cost, what
it produced, and what the developer's own record says about how they work. It is
a solo-developer product, and the person using it is the person buying it.

This file describes **what this repository can do today**, on the date at the
bottom. Where something is planned and not built, it says so and names the stage
that builds it. If you find a statement here that the tree does not support,
that is a bug in this file and worth reporting on its own.

---

## Before anything else

- Contributions are accepted under **Apache-2.0**, certified by a
  `Signed-off-by` line. Read [LICENSING-POLICY.md](LICENSING-POLICY.md) once; it
  is short and it is the only agreement involved.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies. Enforcement reaches one
  person's inbox, and that file says so plainly.
- Security issues do not go in a pull request or a public issue. Follow
  [SECURITY.md](SECURITY.md).
- The name and the mark are not covered by the code licence. See
  [TRADEMARK.md](TRADEMARK.md), which is a draft.

---

## What is actually in the public core

This is the part most likely to surprise you, so it comes first.

| Component | State today |
|---|---|
| `packages/types` (`@seorak/types`) | public, Apache-2.0, its own `LICENSE` |
| `packages/collector` (`@seorak/collector`) | public, Apache-2.0, its own `LICENSE` |
| the dashboard, in `packages/web/src` | public as source, and built into `packages/dashboard` (`@seorak/dashboard`), Apache-2.0 |
| everything else | private, and not in this list by accident |

`packages/web` is a **mixed** workspace: the dashboard is the public core's
primary UI and the marketing site in `packages/web/src/marketing` is Seorak's own
website, which stays private. The split runs file by file and the map is
[`docs/reference/open-core-ownership.json`](docs/reference/open-core-ownership.json),
which two gates read. That file is the answer to "is this file public", and
there is deliberately only one copy of that answer.

**Nothing is published yet, so there is no `npm i -g @seorak/collector` to
run.** The dashboard bundle a published collector used to lack is now
`@seorak/dashboard`, which the local plane resolves by name, but neither package
has been published: that is the last phase of the open-core work and it has not
run. **The complete product exists in a source checkout.**

The practical consequence for you: build from this tree, not from npm.

---

## What you can build and run today

Node 22.18 or newer. npm workspaces; no other package manager is configured.

```bash
npm install
```

That installs every workspace and builds `@seorak/types`, which the others
resolve against.

**The dashboard.** Builds and runs from source:

```bash
npm run build:dashboard   # into packages/web/dist-dashboard
npm run dev:web           # Vite dev server, proxying the collector's plane on 127.0.0.1:4317
```

`packages/web` has two entry points and only one of them is here. The dashboard
entry builds into `packages/web/dist-dashboard`; the site entry, which builds
Seorak's website into `packages/web/dist`, is private along with the marketing
source it compiles, so the dashboard build is the whole web build in this
repository. It emits no marketing page, no blog, and none of the discovery
documents.

**The collector and the local plane.** `seorak init` installs the hooks and the
background daemon and needs no account, no key, and no network. The plane serves
the same public route contract the hosted worker serves, read from your own
`history.sqlite` on `127.0.0.1:4317`.

A source checkout is wired for this: the collector looks for a sibling
`packages/web/dist-dashboard` when `@seorak/dashboard` has not been staged, so
`npm run build:dashboard` is what makes the dashboard appear at
`http://127.0.0.1:4317/dashboard`. `SEORAK_WEB_DIST` overrides that with an
absolute path if you keep your build somewhere else. An npm install needs neither:
the collector depends on `@seorak/dashboard` exactly and resolves it by name.

**Tests.**

```bash
npm run test --workspace @seorak/collector
npm run test --workspace @seorak/types
npm run test --workspace @seorak/web
```

**What you cannot run from the public tree, at all:** the worker, the control
plane, the public directory, the push dispatcher, and the iOS app. They are
private. A change that needs one of them is a change this repository cannot
accept yet, and saying so early saves you the work.

---

## What a change has to pass

Run the whole thing before you open anything:

```bash
npm run check
```

That is `npm run typecheck` followed by `npm run test`, and `npm run test` is the
full gate set, not just unit tests. The ones you are most likely to trip:

| Gate | Refuses |
|---|---|
| `npm run boundaries:check` | a workspace importing across a boundary it does not own |
| `npm run open-core:check` | a public file reading a private one, and any file no ownership rule places |
| `npm run copy:check` | user-facing copy breaking the product's copy rules |
| `npm run types-boundary:check` | scoring, evaluation, or extraction landing in `@seorak/types` |
| `npm run advisories:check` | a dependency advisory with no dated, falsifiable acceptance |
| `npm run governance:check` | a governance file whose stated facts stopped being true, and the sign-off policy in [LICENSING-POLICY.md](LICENSING-POLICY.md) |
| `npm run vendored-assets:check` | a third-party asset that changed, or one nothing declares the provenance of |

**A new file with no ownership rule is a hard failure, not a warning.** That is
deliberate: adding a directory should be a decision somebody made, not a silent
omission that surfaces when the tree is filtered for publication. If
`open-core:check` says your file matches no rule, add the rule to
`docs/reference/open-core-ownership.json` with a `why`.

**One gate is enforced from the other side and you cannot run it here.** A scan
refuses a Seorak-only hostname or infrastructure identifier in any file that
ships publicly, and it lives in the private repository, because a list of strings
that must never be published cannot itself be published. What it means for you is
a rule rather than a command: do not hardcode an origin. Take it from runtime
configuration with an honest fallback, or leave the feature visibly absent.
Renaming it to a different hardcoded host is not a fix, and that is the one thing
the scan is built to say.

---

## The rules that are not style preferences

Four of these come from [CLAUDE.md](CLAUDE.md), which is the repository's own
standing contract with anyone changing it.

1. **The collector talks to a worker over HTTP only.** It depends on
   `@seorak/types` and Node builtins, and on nothing else. It carries zero
   third-party npm dependencies in production, and the gate keeps it that way.
2. **`@seorak/types` is publish-safe.** No secrets, and no scoring, evaluation,
   or extraction implementation. What counts as those is defined once, in
   `scripts/check-types-publish-safety.mjs`.
3. **Honesty.** Stats fire on real measurements. Missing data stays missing:
   honest-empty over zero-fill, no fabricated trends, no inferred "why". If a
   surface cannot answer, it says it cannot answer rather than rendering an empty
   chart that reads as a measured zero. This is the rule most likely to make a
   reviewer reject an otherwise good change.
4. **Nothing in the public core reads the private cloud.** Not by import, not by
   asset binding, not by a stylesheet `url()`.

And one that is not from CLAUDE.md but is load-bearing: **Seorak sends no
telemetry and makes no phone-home call.** Not for usage counts, not for version
checks, not for release notes. A change that adds a network call the user did not
ask for will be rejected regardless of how it is configured or defaulted.

---

## Commits and pull requests

Commit messages follow what is already in `git log`:

- **One line.** No body paragraphs, no bullet lists in the message.
- **A conventional prefix with a scope that matches what you touched:**
  `feat(worker):`, `fix(collector):`, `docs:`, `test(web):`.
- **No em dash** in the subject, and no `--` standing in for one.
- **No `Co-authored-by:` trailer.**
- **Why over what.** `fix(collector): align daemon settings sync with read key
  fallback`, not `update capture-settings.ts`.
- **Sign off:** `git commit -s`. See
  [LICENSING-POLICY.md](LICENSING-POLICY.md).

One commit per logical unit. A pull request that does two things is two pull
requests, unless doing them separately would leave the tree broken in between.

For anything larger than a bug fix, open an issue first. The product has a
deliberately narrow scope, and the fastest way to waste a weekend on it is to
build something well that is out of scope. What is out of scope is written down
in [`docs/reference/voice-and-scope.md`](docs/reference/voice-and-scope.md).

---

## Where to read next

| Document | For |
|---|---|
| [`docs/VISION.md`](docs/VISION.md) | what the product is for |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | package boundaries and data flow |
| [`docs/STATUS.md`](docs/STATUS.md) | shipped versus planned, per surface |
| [`docs/reference/agent-standards.md`](docs/reference/agent-standards.md) | the quality bar a change is reviewed against |
| [`docs/adr/005-open-core-repository-and-free-ui-packaging.md`](docs/adr/005-open-core-repository-and-free-ui-packaging.md) | why the public and private halves are where they are |

ADR 005 is published in a **redacted** form: it argues for the split by naming
what stays private, so the evidence sections that enumerate private modules and
infrastructure identifiers are not in the public copy. It says so at the top and
marks each removal in place, so nothing is missing silently.

Several documents under `docs/` still link to documents that are private and
therefore absent here. Those links are dead rather than misleading, and closing
them is its own pass.

---

*Accurate as of 2026-08-05. The statement here most likely to age is that nothing
has been published to a registry.*
