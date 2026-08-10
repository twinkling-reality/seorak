# Ship status

What is built vs planned. Update here when status changes. Detail lives in [specs/](./specs/). Product intent: [VISION.md](./VISION.md).

## Current release decision

Launch readiness for the **managed** service, which is what "release" gates on,
is an operational record of that service: provider credentials, hosted account
telemetry, storage budgets and recovery points, and app-store distribution. It is
held by whoever operates the service and is not part of the open core.

Nothing below is gated on it. The local product ships from this repository, and
the collector, the dashboard, and the shared contracts are released on their own
terms.

---

## Product bets

| Priority | Bet | Stance |
|----------|-----|--------|
| **1** | Period clarity across projects and agents | **Shipped (v1)** — terminal prose; web Overview = customizable board + opt-in Summary fade read |
| **2** | Developer model (honest, period-scoped) | **Active** — finish measured identity/payoff; no peer norms |
| **Long-term 1** | Versioned read-only API/query contract | **Implemented and release-gated** — distinct scoped authority, external refs/cursors, grounded period/session/outcome/Replay projections, mounted v1 HTTP reads, and owner UI for one-time secret issuance, scopes, expiry, project/date limits, inventory, and revoke; a production Personal cell has not yet been provisioned for hosted proof |
| **Long-term 2** | Private MCP | **Implemented and mounted** — four read-only tools share the private DTO boundary. Collector loopback/self-hosted MCP uses a distinct exact-audience static `srkx_` bearer and no OAuth discovery; managed owner cells keep authorization code + PKCE, refresh rotation/replay revocation, RFC 9728/8707 discovery, `srmcp_` tokens, durable revoke retry, and content-free audit. The released official TypeScript client passes locally and over real self-hosted TLS; hosted OAuth awaits the still-unprovisioned control-plane Worker and real IdP credentials |
| **Long-term 3** | Public developer profile and project gallery | **Implemented, isolated directory hosted and verified** — owner-controlled extraction, frozen activity/streak and project evidence, durable ordered delivery with privacy-prioritized revoke supersession, independent web/search/API/MCP grants, signed-out profile/project/activity API and MCP reads, account-deletion retirement, revoke/non-resurrection, and HTTPS contact only. General availability still waits for the production control plane and a real Personal owner-cell rollout |
| — | Away control plane (phone act + multi-session cockpit) | **Parked** |
| beta gate | Paid Pro tier | Free and Pro contain the same product capabilities; Pro sells Seorak-operated infrastructure and adds no exclusive feature. US-only Stripe test-mode Checkout, Portal, webhook reconciliation, and billing UI are code-complete at $12/month or $120/year. A product cell now provisions its own R2 archive bucket and live-sync namespace, `/health` reports the stores it binds and provisioning refuses a cell missing any, a verified billing decision reaches the cell through a durable outbox drained on the existing cron, grants are keyed by provider so one cannot revoke another, and both configured Stripe prices are verified against Stripe before a checkout with the button labels derived from that fetch. Five recorded defects are now closed in engineering terms: region is decided before the charge and re-checked on renewal, one open checkout per identity replaces two cadence forms, the Customer Portal switches cadence through a verified configuration that cannot offer quantity, a refused provider event is dead-lettered and replayable through operator routes instead of disabling the endpoint, and the dashboard reads a worker's data plane. Test-mode Product and Price objects exist and a real test Checkout with verified webhooks is recorded for both cadences on 2026-08-03; the four billing closures listed above (region, one open checkout, portal cadence, dead-letter) merged on 2026-08-04 and are not covered by that run (the gap). Live billing is not enabled and no owner has been charged ([ADR 004](./adr/004-per-cell-archive-and-live-sync-topology.md)) |

---

## Shipped

| Area | Note |
|------|------|
| Claude Code capture | Hooks + daemon; durable queue; compatibility gates ([event compatibility](./reference/event-ingest-compatibility.md)) |
| Codex capture | Rollout tailer; tokens, estimated cost, quota ratio; no session end → outcome legs honest-null ([multi-tool](./specs/multi-tool.md)) |
| Worker ingest + aggregates | Session projection, event log, retention, fail-closed cutover |
| Intervention (8 stats + push) | Engine, delivery, and cell-local alarm scheduler deployed to dogfood; production APNs and clean one-day/seven-day scheduler timing remain unverified |
| Notification settings | Global web + mobile; per-project threshold overrides mobile-only for now |
| Web dashboard | Overview (customizable widgets + Summary fade read), Project, Compare, Agents, Replay, Model, Settings |
| Compare | Period-first all-work or one-project adjacent windows; explicit repo A/B secondary mode; stable repo ids; honest-empty prior legs |
| Agents compare | Always in sidebar; honest-empty until 2+ agents; fair cells only |
| Terminal (`seorak`) | Narrative + door to dashboard; conditional `/overview` |
| Mobile | Apple/GitHub/Google device sign-in contract, least-privilege mobile/read credentials, atomic Personal/Shared selection and change-home revocation, identity-bound reauthenticated deletion, Home / Projects / Settings, explicit offline/stale/malformed states, notification authorization recovery, warm/cold push routing, shared settings truth, live + watches; local/simulator proof only, no stat rooms |
| Per-repo `dailyTrends` | On `ProjectRollup`; honest-empty like global trends |
| Replay | Keyframes + review console; capacity-bounded |
| Line survival / ship rate | Claude Code only |
| Surface data access | Shared freshness / LKG / unavailable contract ([ARCHITECTURE](./ARCHITECTURE.md#surface-data-access)) |
| Observability | First-party client path; its acceptance record is held with the managed service |
| Hosted owner cells | Product posture, control-plane binding, provision and account-cleanup jobs, session handoff, and collector/mobile pairing are code-complete; external deploy unverified |
| Shared workspaces | Personal cells plus isolated workspace cells, 2–5 member invites, member-bound capture, responsible-person intervention routing, collector home selection, web home switcher, and one-at-a-time mobile Personal/Shared selection are code-complete; external deploy unverified |
| Dashboard auth | Apple + GitHub + Google OAuth control plane; one-time cell handoff; no normal pasted-token UX |
| Collector install | Global npm package path, `seorak login` device PKCE, packaged hooks, and clean-install smoke are code-complete; first npm publish awaits scope credentials |
| Project identity repair | Root-commit ledger; historical merges explicit in web settings |
| Account-free local plane | `seorak init` succeeds with no worker; the collector's loopback plane on 4317 serves the **primary** dashboard over the public route contract with no operator credential. Ten of twelve surfaces are served. The two that answer 501 are not owed derivations: `deliveryHealth` reports on a delivery path the collector does not have, and `publication` needs an operated directory to publish to ([ADR 003](./adr/003-one-primary-ui-over-a-modular-data-plane.md)). `integrations` atomically serves owner management, four HTTP reads, and static-bearer MCP; `sessionOutcome`, `developerModel`, and `interventions` are also derived from local history |
| Self-hosted plane | The same collector plane also binds a routable interface behind a minted credential and TLS it terminates itself, reporting `remote` / `self-hosted` with no lifecycle window. Off unless four settings and a minted credential are all present, and a partial configuration refuses to bind ([hardening](./reference/self-hosted-plane-hardening.md)). Exercised over real TLS in `self-hosted-plane.test.ts`, including every surface the descriptor declares; not yet operated on a routable host |

## Code-complete, deployment unverified

| Area | Note |
|------|------|
| Public web + installed-client beta | Local contracts prove all three provider paths, Apple token verification/revocation, repeat identity binding, browser session revoke, collector login, package init, scoped ingest, mobile callback/redemption, pair revocation, deletion scheduling/finalization, and Shared-member purge. Provider credentials, Apple configuration, Google production publishing, Cloudflare, npm, and signed physical iOS proof remain external gates |
| Live Activity / Dynamic Island | Needs production Fly dispatcher, production worker binding, and signed physical-device proof |
| App Store submission | Sign in with Apple and exact-identity deletion are code-complete; candidate metadata is versioned, and unsigned structure passes. Production provider/deletion proof, Apple Distribution archive, App Store Connect record/numeric `ascAppId`, TestFlight, review metadata/decision, and physical-iPhone proof remain |

## In progress

| Area | Note |
|------|------|
| Developer model | Identity, conditional payoff, project scope and accrual ship on web. Web only by decision, not omission ([introspection](./specs/introspection.md)) |

## Planned (product)

| Area | Note |
|------|------|
| Project % / token thresholds | Catalog is USD and time today |
| Public `/capture` coverage page | From capability registry |
| Web editor for per-project threshold overrides | Additive UI; worker already resolves |

## Implemented locally or not wired

| Area | Note |
|------|------|
| Grounded stat chat | Local stub only; no model; spend guard built and unwired |
| Paid entitlements | Canonical Free/Pro/Teams capabilities, bounded server grants, a provider-keyed grant ledger with a derived winner, and a test-only Stripe adapter with Checkout, Portal, signed webhook reconciliation, status UI, deduplication, stale-event protection, verified price amounts, and a durable cell-sync outbox are implemented; purchasing fails closed without configuration and no live product is configured |
| Local-first history | Permanent SQLite capture, local dashboard/report/replay/export, idempotent legacy import, and private local archive key are implemented |
| Local and managed lifecycle | `packages/types/src/data-plane.ts` defines the plane descriptor, managed coverage, lifecycle window, 30-day recovery window, published archive allowance, and rebaseline handshake, and `packages/types/test/data-plane.test.ts` proves the refusals. Web Settings renders the plan, the exact remote-service-end and hosted-deletion dates, and managed-copy coverage from that contract (`ManagedPlanSection`, `managedPlanCopy`). Whether a plane reports those values, the customer recovery export, and the wired rebaseline are separate work |
| Compact managed sync | Versioned encrypted collector protocol plus owner-scoped D1, R2, and Durable Object adapters are implemented locally; production resources, migrations, and deploy remain approval-gated |
| Private integrations | **In an owner cell and on the local plane.** Collector loopback and self-hosted bindings mount secret-free owner inventory, issue/revoke, four `/api/v1` reads, and `/mcp/private` together. They use separate exact-audience static `srkx_` API/MCP grants with mandatory expiry, scopes, restrictions, persistent budgets, opaque refs/cursors, honest-empty DTOs, and bounded content-free audit; operator and integration credentials never cross. The dashboard offers static MCP only on local/self-hosted and displays each raw token once. Managed owner cells retain their separate `srmcp_` OAuth authority and durable revoke outbox; hosted OAuth is not claimed before the control plane and real IdPs are provisioned ([ADR 002](./adr/002-private-api-mcp-and-public-projection.md)) |
| Public developer directory | Separate public-only D1, database-enforced generation ordering, web/API reads including activity, bounded search, anonymous projection-only MCP, owner extraction/durable retry, revoke supersession, management UI, public UI, per-cell provisioning, and account-deletion retirement are wired. The isolated directory is hosted and synthetic apply/read/revoke/non-resurrection proof passes; the production identity/owner-cell chain is not yet deployed |

---

## Open questions

- **Surface allocation** — unvalidated with users. Mobile bet: live + interrupts on phone, retrospective on web ([surfaces](./specs/surfaces.md)). The developer model is the first pillar to ship web-only *on that bet* rather than by omission; if the bet resolves the other way it is the first thing to revisit.
- **Distribution launch** — architecture and package path are decided; the open
  gate is operational publication/deployment under the real npm, IdP,
  Cloudflare, and DNS accounts.

- **Managed storage allowance** — published as 2 GB new archive per month and
  20 GB retained per home, asserted against the modelled economics by
  `scripts/hosted-cost-model.test.mjs`. It has never been tested against real
  cohort usage, because no managed home exists yet.
- **Open core** — [ADR 005](./adr/005-open-core-repository-and-free-ui-packaging.md)
  is **accepted, 2026-08-04**. Phases A, B, and C0–C1f are done in this
  repository; nothing has been pushed to a public repo or published to npm yet.
  The decision remains the complete primary UI in the public core, two
  repositories with a one-way dependency, Apache-2.0, and **publication last**.
  The publication strategy is a single reviewed initial commit (no private
  history travels), so licensed-face history no longer gates publication; P2
  gates the App Store app alone. **C2 is done** (2026-08-10): private repo is
  `twinkling-reality/seorak-internal`, remotes retargeted, so the rename that
  frees the public name has landed. **What is left is C3**: create public
  `twinkling-reality/seorak`, push the reviewed initial commit, and publish to
  npm. C3 is irreversible. Engineering gates for C3 are green on the post-C2 tip
  (public lock refreshed; owner-run hardened for the rename redirect and LICENSE
  placement). It still waits on the owner decision and `AUTHORIZE_C3_*` flags to
  run `docs/handoff/open-core-c3-owner-run.sh` (ROADMAP Track 1). C4 prep gates
  refuse reduction until one green publish/pin/deploy evidence file exists.
- **90-day range** — least used, most expensive to build; product call whether it stays. Capacity may `413` before plan policy does.
- **Activity-proportional scheduling** — rollups advance on ingest and the local
  and deployed dogfood release uses one Durable Object alarm per isolated cell
  for delivery retry, live-session aging, and retention. Exact-version telemetry
  and a clean one-hour D1 query-shape window are within budget; one-day/seven-day rows, requests, duration,
  retries, and idle behavior still must be measured before claiming hosted
  readiness.
- **Mobile parse vs web zod** — deliberate; parity tests hold the seam ([ARCHITECTURE](./ARCHITECTURE.md#surface-data-access)).

Deploy/install open items: [SETUP](../SETUP.md#open-questions).
