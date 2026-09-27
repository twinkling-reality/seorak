# Seorak

Performance tracking for agentic development.

**This repository is the public core.** It holds everything needed to capture,
store, understand, and read your own agentic-development record on your own
machine: the collector, the shared wire contracts, and the primary dashboard.
Seorak's managed cloud, its website, and its mobile app are developed in a
separate private repository and are not here. Which is which is
[`docs/reference/open-core-ownership.json`](docs/reference/open-core-ownership.json);
why, is [`docs/adr/005`](docs/adr/005-open-core-repository-and-free-ui-packaging.md).

**Documentation:** start with [`docs/VISION.md`](docs/VISION.md). The map is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); shipped versus planned is
[`docs/STATUS.md`](docs/STATUS.md). If you are changing something,
[`CONTRIBUTING.md`](CONTRIBUTING.md) is the shorter road in.

---

## Hard rules for agents

Numbered as they are cited: several gates and documents in this tree name these
rules by number, so the numbers are stable even where a rule's wording is not.

1. **Collector boundary** — `packages/collector` reaches a data service over
   HTTP only; it depends on `packages/types` and Node builtins, and carries zero
   third-party npm in production. It never imports a service implementation.
2. **Types boundary** — `packages/types` is publish-safe only: no secrets and no
   scoring, evaluation, or extraction implementation. Public wire catalogs,
   default settings, and vendor list prices may live there when every consumer
   needs the same contract. What counts as scoring, evaluation, or extraction is
   defined once, in `scripts/check-types-publish-safety.mjs`
   (`npm run types-boundary:check`); do not restate it here.
3. **Honesty** — stats fire on real measurements; honest-empty over zero-fill; no
   fabricated interventions or trends. A surface that cannot answer says so
   rather than rendering an empty chart that reads as a measured zero.
4. **Scope** — solo developer product; user is buyer; not DX/HR/enterprise. Full
   list: [`docs/reference/voice-and-scope.md`](docs/reference/voice-and-scope.md).
5. **Copy** — user-facing **stat**, not "signal"; equal surfaces, not
   phone-first.
6. **Open-core boundary** — nothing in the public core reads the private cloud.
   Which paths are which is recorded once, in
   [`docs/reference/open-core-ownership.json`](docs/reference/open-core-ownership.json)
   (`npm run open-core:check`, `npm run boundaries:check`); do not restate it
   here or in ADR 005. Adding a workspace, a path, or a visibility class is an
   edit to that file. The map deliberately names private paths this repository
   does not contain: that is what lets one map be checked from either side, and
   the gates report a rule that matches nothing here rather than failing on it.

---

## Repo map (one line each)

| Path | Role |
|------|------|
| `packages/collector/` | Hooks, daemon, loopback and self-hosted data plane, terminal (`seorak`); the npm name is the unscoped `seorak` |
| `packages/dashboard/` | The built primary UI as a package, `@seorak/dashboard` |
| `packages/types/` | Shared schemas |
| `packages/web/` | The primary UI's source. A **mixed** workspace: the dashboard half is here, Seorak's website is not |
| `scripts/` | The gates `npm run check` runs, including both boundary gates |

`@seorak/types@0.1.0`, `@seorak/collector@0.1.1`, and `@seorak/dashboard@0.1.0` published to npm with provenance attesting to this repository. The CLI package
has since been renamed from `@seorak/collector` to the unscoped `seorak`, so
`@seorak/collector@0.1.1` is the last release under the old name.
`seorak@0.2.0` published to npm on 2026-08-16 with provenance attesting to this
repository.

Detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), which describes the whole
product including the parts kept private, and says which is which.

---

## Product (pointers only)

Three jobs: period clarity · developer model · away oversight (nudges shipped;
agent control out of scope, [ADR 008](docs/adr/008-seorak-observes-and-does-not-control-agents.md)).

The local product is complete and account-free: capture, history, the primary
dashboard, reports, replay, export, and local intervention all run from this tree
with no account, no key, and no network. A managed remote service is a separate
commercial product Seorak operates; the branches that reach for it are in this
tree and are honestly unavailable without it. It is not sold yet and billing is
not live. Ship status: [`docs/STATUS.md`](docs/STATUS.md). Local and protocol
specs: [`docs/specs/`](docs/specs/).
