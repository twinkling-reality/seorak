# Architecture

Monorepo layout and trust boundaries. Product narrative: [VISION.md](./VISION.md).

---

## Packages and apps

| Path | Role |
|------|------|
| `packages/collector/` | Local daemon, permanent SQLite history, loopback data plane, compact-sync adapter, hooks, Codex tailer, and terminal |
| `packages/types/` | Shared event, entitlement, compact-sync, and API contracts |
| `packages/web/` dashboard tree | The one primary UI: views, widgets, layouts |
| `packages/dashboard/` | That tree, built, as `@seorak/dashboard`. No source of its own; the collector resolves it by name and serves it |
| `packages/web/` marketing tree | Seorak's own website: home, pricing, blog, legal, `/developers`, `/docs`, and the public-projection renderer those routes mount |
| `packages/control-plane/` | OAuth identity→cell binding, billing, durable provision jobs, installed-client authorization; no owner data bindings |
| `packages/worker/` | Cloudflare Worker — ingest, intervention, replay, projections, plus the managed owner-cell control surface |
| `packages/public-directory/` | Public-only immutable publication versions, current projections, channel-filtered web/API/search/MCP; no owner-data binding |
| `packages/push/` | Node APNs dispatcher (HTTP/2 session Worker can't hold) |
| `apps/mobile/` | Expo iOS — Live Activity, push, settings |

**Which of these is public and which is private is recorded once**, in
[`reference/open-core-ownership.json`](./reference/open-core-ownership.json), and
two gates read it: `npm run boundaries:check` and `npm run open-core:check`. It
is a decision, not a description of today, because nothing has been extracted or
published. The decision, its rejected alternatives, the reasoning behind each
placement, and the migration sequence are
[ADR 005](./adr/005-open-core-repository-and-free-ui-packaging.md).

`@mobile-surfaces/*` (MIT) is permitted in `types`, `push`, and `mobile`.
`@seorak/types` declares the surface contract and token packages as optional
peers for its mobile-only subpaths; the collector neither imports nor installs
them.

The publishable-package boundary is executable. `boundaries:check` treats
`types/src` plus `collector/src` and `collector/bin` as production roots, where
only production, optional, and peer dependencies may be imported. Their tests,
build scripts, and package-level source configs may additionally use declared
development dependencies. Every manifest dependency section and dependency
alias is checked for forbidden closed-package edges. Static imports, export
edges, TypeScript import types, dynamic imports, and direct or
`createRequire`-derived loads share the same rule; a computed module name fails
closed because its destination cannot be proven. Package identity is fixed by
policy, self-references must be exported, and covered sources may not shadow
the reserved CommonJS `require` loader.

The Worker type boundary follows the deployed runtime rather than an undated
ambient package. Its typecheck regenerates `worker-configuration.d.ts` with
Wrangler from the committed `compatibility_date = "2024-12-18"` and compatibility
flags before TypeScript runs. The generated file supplies runtime globals only;
`WorkerEnv` remains the reviewed binding, secret, and local-fallback policy, and
the release gate independently proves the production and staging binding
topology. `@cloudflare/workers-types` v5 exposes only the latest runtime surface,
so using it here would authorize APIs newer than the deployed compatibility
contract.

---

## Local-first data flow

```
Claude Code hooks / Codex rollout tailer
                 ↓
       permanent local SQLite
         ├─ local report, dashboard, replay, export
         ├─ compact sessions and hours → D1
         ├─ encrypted coarse archives → R2
         └─ meaningful live transitions → Durable Object
                                              └─ managed delivery → push → APNs → phone

Terminal / web / mobile ← GET /live, /overview, /settings, /interventions

Verified provider event → control-plane billing ledger → operator-only monotonic
entitlement revision → owner-cell D1 → GET /entitlements and sync authorization
```

`history.sqlite` is the complete raw authority. `events.jsonl` is a bounded
compatibility mirror, not the product database. A capture is committed to
SQLite before its JSONL append, and event ids make retries idempotent. Free
stops at the local branches and requires no account.

Compact sync v1 carries no owner, member, workspace, or plan selector. The
worker derives scope from authenticated cell authority and writes owner-scoped
D1 rows and R2 keys. Sessions and complete hour aggregates are bounded; raw tool
event count is absent from the hosted write equation. Archives are gzip plus
AES-256-GCM ciphertext, encrypted with a mode-0600 machine-local key. The
service never receives plaintext or the key.

Billing authority is separate from client data. The control plane verifies and
deduplicates provider events, then reconciles only canonical plan, state, and
revision into the isolated cell. The cell derives its owner id, ignores stale
revisions, and fails hosted capability closed if D1 authority cannot be read.
Every local capability remains true in that failure mode.
In product posture, an authenticated capability gate protects legacy ingest,
remote data reads, hosted replay, push registration, and background jobs. It is
not active for self-host or dogfood posture, where the infrastructure owner is
also the operator and subscription enforcement would be fictitious.

**The hosted capability matrix is a published contract, and every consumer must
be able to reconstruct it.** It lives in `@seorak/types`, which is the package
CLAUDE.md rule 2 keeps free of scoring, evaluation, and extraction, so its
placement is stated here rather than left to a per-symbol exception. The matrix
maps a plan and an account state to a fixed set of hosted capabilities. It is a
contract table, not a measurement: nothing about a developer's work reaches it.

It is published because **both directions of one wire contract need the same
table**. The issuing cell constructs the `hosted` block from it, and a client
that receives an entitlement refuses the payload when the block disagrees with
what that plan and state should yield. That refusal is the point: it stops a cell
handing a client more authority than its plan carries. Holding the table in one
place is what makes the check meaningful, and holding it in two would mean any
drift silently refuses every hosted entitlement payload, with the client and the
server each convinced the other is wrong.

This is the same principle that keeps a catalog's encoder and decoder together:
a contract's two halves belong in the package both of its consumers depend on,
because that is the only place a test can see both at once.

One exact pending wire batch is persisted with an installation sequence and
previous-batch hash before upload. A matching receipt atomically advances local
projection checkpoints and activates compact v1. Before activation, an old
worker may receive `/events`. After activation, the collector fails hosted sync
closed and never falls back to raw ingest. Local capture is unaffected.

The architecture decision and open-core split are recorded in
[ADR 001](./adr/001-local-first-compact-sync.md). Rollout order belongs to
whoever operates the managed service.

Mobile bundle: `app.seorak.ios`, App Group `group.app.seorak.ios`, iOS 17.2+.

### APNs environment boundary

APNs tokens are bound to the `aps-environment` entitlement of the signed app
that minted them. Mobile reads that entitlement through Expo Application at
runtime and includes the resulting `development | production` value with every
startup sync, even when no token is currently available. The observation carries
a SecureStore-backed monotonic authority revision, so a delayed sandbox launch
cannot roll a newer TestFlight installation back or clear its state. Mobile does
not infer the value from an EAS channel, build profile, or JavaScript constant.

`@seorak/types/push` is the shared strict contract for mobile, worker, and push.
One mobile provider owns the upstream ActivityKit token store, persists it in
secure storage, and forwards exact revision/lifecycle observations. The worker
stores signed device authority and raw tokens only in D1. Per-kind token
generations, immutable opaque-revision bindings, and terminal tombstones make
lifecycle order authoritative without trusting client timestamps. Remote starts
also carry an immutable worker live generation that the exact ActivityKit
instance echoes with every per-activity observation, preventing delayed
callbacks from being attached to a newer session. Mobile retains that mapping
until the corresponding rotation or terminal lifecycle is durably acknowledged. A higher
environment authority atomically supersedes older work and removes its tokens
and observed activity state; equal or lower conflicting observations are
rejected.

Notification and Live Activity code writes desired/fire facts first, then
reconciles immutable per-device outbox rows. Delivery attempts have leases,
deadlines, bounded retry, semantic expiry, and stable APNs IDs. A device's
accepted Live Activity projection advances only in the same D1 transaction as a
correlated dispatcher acceptance; a failed update or end preserves the last
accepted state. Token invalidation names an exact revision and generation,
clears the raw token, and retains its digest tombstone, so a late APNs response
cannot erase a rotation or resurrect a dead token.
Live Activity and intervention reconciliation are failure-isolated, so a broken
surface cursor cannot prevent fresh notification facts from reaching the outbox.

The worker has independent dispatcher URL and auth configuration for
development and production. A missing exact target rejects observation with
503; production never falls back to sandbox. Each push process is pinned by its
required `APNS_ENVIRONMENT`, holds no registry, and executes only the strict
operation/token pairing supplied by the worker. Invalid dispatcher credentials
spend both a non-header Node socket-peer budget and an advisory Fly client-IP
budget. A caller can therefore never mint fresh limiter keys by rotating a
request header, while proxied traffic retains per-client precision.

### Event ingest contract

This section documents the legacy `/events` compatibility protocol. It remains
unchanged for old collectors during the explicit expand-and-contract window. It
is not the steady-state managed-sync path for a compact-v1 installation.

`@seorak/types/event-protocol` owns the publish-safe schema version,
compatibility metadata, and closed failure vocabulary.
`@seorak/types/event-validation` owns the strict runtime event boundary and
re-exports that same version. The current collector emits `schemaVersion: 1`,
and the current worker has exactly one real parser, for schema 1. Missing or
differently versioned envelopes are rejected. Event and nested object schemas
are strict, so an unknown field is rejected rather than silently stored.

One request carries at most **128 events** and **524,288 UTF-8 bytes**, whichever
comes first. The collector reads complete JSONL prefixes under both limits and
advances each prefix offset only after a 2xx. A locally malformed or individually
oversized complete record is fsynced to a content-free rejection checkpoint
before the cursor passes it, so one poison record cannot pin later valid work.
The checkpoint keeps exact identities only for the current unacknowledged chunk,
capped at 128 classifications, and aggregates counts and rejected bytes by
closed reason. Generation rollover folds those counters into constant-size
history; status never scans lifetime rows. A 413 or
422 for a locally valid chunk is protocol drift and keeps the offset in place.
Every drain logs the locally rejected records it encountered, and
`seorak status` fails when the active log generation has any distinct
classifications; old generations retain bounded counts and byte totals without
making a repaired capture chain fail forever.
Hook appends and acknowledged rollover share a cross-process owner-token lock.
Each operation resolves one immutable collector path context before it waits, so
a process-global directory change cannot move the eventual write outside the
lock it acquired. Dead owners are recoverable, but age alone never displaces a
live PID, and token-specific release cannot remove a successor lock. A Claude
hook that exhausts its five-second lock budget exits successfully only after
atomically creating bounded, content-free `capture-failure.json` evidence;
`seorak status` fails on that known gap. The marker is separate from
`events.rejections.json` because no byte offset or log generation exists for an
event that never entered the queue.
Claude transcript and session-start git cursors share one versioned SQLite
checkpoint under `SEORAK_DIR`. Transcript rows intentionally survive
`SessionEnd`: Claude can resume the same session id and transcript, and deleting
the last consumed UUID would count the old transcript again. Session git rows
are consumed at end; never-ended sessions remain durable rows rather than
unbounded per-session files. The database transaction serializes concurrent
hook processes, fails closed on unknown schema versions, and losslessly imports
the retired `cursor-*` / `gitcursor-*` layout before removing those files.
Permanent worker rejections remain visibly blocked and retain their offsets, but
the durable scheduler probes them at its 15-minute ceiling so a compatible worker
redeploy self-heals without waiting for another captured event. New file events
remain queued behind that open circuit and cannot bypass its slow floor.
Before reading a queue chunk, the delivery loop checks the worker's bounded
`GET /health` compatibility metadata. A proven empty schema intersection performs
no queue read, POST, or offset write. Missing, malformed, oversized, timed-out,
or legacy metadata stays unknown and permits the POST, which remains
authoritative. The expand-release-contract rules and rollback order are in
[event-ingest-compatibility](./reference/event-ingest-compatibility.md).
Per-event resource caps are shared too: 16 model rows, eight quota windows, and
100 line-survival commit rows. Repository, file, and directory identities are
the collector's current 64-character lowercase salted hashes; event, session,
and device ids are at most 256 characters, basename labels 255, and
agent/version/model identifiers 64.

The worker counts the request stream before JSON parsing, rejects compressed
request bodies, then validates the envelope and every event before any KV, D1,
push, or `waitUntil` work.

A 2xx is a durable acknowledgement of all three ingest truths: the per-session
KV reducer checkpoint, the D1 session projection, and the append-only D1 event
log. The log is persisted before any push delivery intent can advance. If it
fails after projection, the worker returns a non-cacheable 503 and the collector
retains its offset. Replaying the identical batch is safe: the reducer remembers
recent event ids, projection replaces the same session state, and the event log
uses `INSERT OR IGNORE` on `event_id`. Only bounded delivery advancement remains
in `waitUntil` after acceptance.

The launchd daemon keeps its local diagnostic output bounded without changing
the stdout/stderr inode launchd opened before process startup. At startup and
each 30-second heartbeat, a log above 8 MiB has its newest 8 MiB copied to a
durable one-generation archive; only after archive publication succeeds is the
exact current inode truncated in place. Rename rotation is intentionally not
used because launchd would continue appending through its held descriptor to the
renamed inode. Archive failure preserves the current log for a later retry.

### The clock policy

One invariant: **an event cannot have occurred after it arrived**, so `at <=
received_at` for every row this build writes. The boundary
(`readEventIngestRequest`) takes one server instant per request and uses it for
both the check and the `received_at` the log stamps, so the two cannot disagree.

The policy is asymmetric because the two directions are not alike:

| Direction | Rule | Why |
|---|---|---|
| `at` ahead of arrival | Replaced with the arrival instant | Impossible. A fast client clock otherwise inflates today's totals, opens a `dailyTrends` point and an hour bucket for a day that has not happened, and holds `lastEventAt` past the wall clock so the liveness verdicts never fire |
| `at` behind arrival | Never bounded, never rejected | Legitimate and measured: 17.9 hours on the deployed log. An offline laptop, a retry backoff, or a backlog drain all land here |

The tolerance is **0 ms**, which is the physically correct bound rather than an
oversight; `eventIngest.ts` records the measurement behind that choice and the
condition for raising it. A clamp **rewrites, never rejects**: a 422 for skew
would pin the collector's offset forever and lose that machine's whole history
instead of dating it conservatively. Only the envelope `at` moves. `agent.quota`
carries a `resetsAt` that is legitimately in the future and is left alone.

A clamp is recorded, not silent: migration 0011 adds a nullable capture-only
`client_at` holding the claim that was overwritten, so a skew incident stays
diagnosable. NULL means no clamp occurred, which is the ordinary case. Nothing
reads it in an aggregate, because a client assertion about the future is not
evidence.

Windows and retention therefore stay on `at`, which the boundary has made
trustworthy, rather than moving to `received_at`. Rows written before the clamp
may still hold a future `at`, which is why the retention predicate keeps its
`received_at` leg; `retention.ts` states the condition for dropping it. Legacy
rows are deliberately not repaired: rewriting them would desynchronise the
rollups, whose only correct fix is a full replay that would make `/overview`
silently under-report while it caught up.

---

## One primary UI over a modular data plane

There is one product UI. What changes underneath it is the authority it reads,
described by [`packages/types/src/data-plane.ts`](../packages/types/src/data-plane.ts)
and decided in [ADR 003](./adr/003-one-primary-ui-over-a-modular-data-plane.md).

| Authority | Operator | Who runs it | Account | Operator credential |
|---|---|---|---|---|
| `local` | `local-machine` | the user's own computer | none | none |
| `remote` | `self-hosted` | the user, somewhere else | theirs | theirs |
| `remote` | `seorak-managed` | Seorak | Seorak | Seorak-issued |

The reference implementation of the first two rows is the same module:
`packages/collector/src/local-plane.ts` binds loopback with no operator credential, and
binds a routable interface behind a minted credential and TLS it terminates
itself ([hardening](./reference/self-hosted-plane-hardening.md)).

`GET /data-plane` is the single read that says which. The parser enforces three
boundaries. A `local` authority is always `local-machine` and can never demand a
credential, which is what lets the Free product open with no account. A
`ManagedLifecycleWindow` and a `RebaselineDirective` are refused on a
`self-hosted` operator, so that plane is structurally incapable of describing a
billing window. And the **local** plane may carry a lifecycle window, and must:
it is the default authority for every install including Pro, so a lapsed
subscriber is reading locally at exactly the moment the deletion countdown
matters most.

Two rules bind every surface reading a plane:

1. A surface absent from `descriptor.surfaces` is **unavailable, not empty**.
   `planeServes` is the membership test; nothing hand-rolls it.
2. Completeness is a measured claim. `planeReadsAreComplete(status, surface)` is
   per-surface and is the only sanctioned answer to "is this the whole record?".
   `parseManagedSyncCoverage` refuses a payload claiming completeness without a
   caught-up state, an acknowledged instant, a measured empty backlog, and
   nothing pending.

Local loopback authority is the default and is never replaced by a managed
plane; a managed plane is added on top. Lifecycle and recovery authority live in
the control plane rather than the owner cell, because a cell cannot authorize
its own deletion and a recovery grant must outlive the entitlement that just
expired.

The loopback plane is `packages/collector/src/local-plane.ts`. It serves ten of
the twelve declared surfaces; `deliveryHealth` and `publication` answer 501,
which is why they are absent from `LOCAL_PLANE_SURFACES` rather than returning
empty.

Neither absence is a derivation still owed, and that is the point. `deliveryHealth`
reports on a delivery path — no push, no delivery ledger — so there are no
records for it to report on. `publication` needs an operated public directory to
publish to, which a loopback plane is not and will never be; it is on the
contract so the dashboard can withhold the Settings tab honestly rather than
render a control whose every call fails.
Four surfaces have since moved off that list. Two are derivations in
`local-projection.ts` beside the overview: `sessionOutcome`, built from
the session's own `session.delta`, `session.linesurvival`, `tool.call`, and
`session.end` rows, and `developerModel`, the period portrait. The portrait
mirrors the hosted build's rules rather than re-inventing them — the earliest
`session.start` per session so a resumption is not a session, the conditional
cut anchored to the session's start hour rather than the survival sweep's, the
widened two-window start scan that anchor needs, and rates over tool outcomes
taken only from sessions whose tool observes both legs. `identity`,
`conditional`, and `accrual` are omitted rather than zero-filled when the window
measured nothing to put in them.

"Mirrors the hosted build's rules" is a claim, and it is now measured rather
than asserted. `npm run projection-parity:check` drives both implementations
from one event fixture and compares seven `OverviewSnapshot` fields exactly,
declaring the rest with the reason each cannot be compared, so a field that
belongs in neither list fails. It lives in `scripts/` rather than in either
package's suite because it has to import both, and `boundaries:check` rejects a
relative import that leaves the package root in development mode too; `scripts/`
is private in the ownership map, and private may read both halves. Its first run
found the local plane counting a `session.tokens` carrier snapshot as a model
call, which ADR 003 section 2 records.

The third is `interventions`, and it is not a projection but an engine:
`local-intervention.ts` evaluates the live board against the user's configured
watches on a daemon tick and records what crossed into a rolling one-day ledger,
which is what `GET /interventions` reads. It holds the hosted engine's honesty
rules — a null cost is unknown rather than under budget, a signal an agent
cannot supply evidence for never fires, the cadence fallback for `stuck_loop`
stays gated to claude-code, and a fire held by quiet hours is still recorded.

Delivery is `local-notify.ts`, and it is deliberately a separate module called
strictly after recording: a notifier that is missing or refused permission costs
the user the banner and never the history. It posts through `osascript` with the
AppleScript as a CONSTANT that reads its three strings from `argv`, because the
notification carries a repo basename the user chose and building that script by
concatenation would make a directory name an execution vector. macOS is the only
platform with a delivery path today; everywhere else reports
`unsupported-platform` and the fires stay recorded and readable.

The fourth is `integrations`: owner credential management, the four private
HTTP reads, and static-bearer MCP are mounted as one atomic surface on loopback
and the collector's self-hosted binding. The two bindings share the canonical
SQLite query service while keeping their owner-admission rules distinct.

The plane's `index.html` fallback is bounded to the dashboard's own router paths,
so installing a bundle can never turn an unimplemented route into a `200`.

The vocabulary every plane's answer must parse against is
`packages/types/src/data-plane.ts`, and `packages/types/test/data-plane.test.ts`
proves its refusals. The managed lifecycle contract those values serve is a
commercial document held with the service.

---

## Surface data access

### Third-party private reads and public publication

First-party routes remain an internal product contract. Third-party reads use a
separate `v1` DTO family and a separate `srkx_` principal with mandatory expiry,
exact audience, closed scopes, optional project/date restrictions, independent
revocation, and a credential-local budget. Random `ses_`/`prj_` handles and
server-side `cur_` records replace storage identifiers. Each storage authority
owns one canonical query service: worker D1 and collector SQLite adapters do not
import one another, and a cross-authority gate compares their DTO values.

Collector loopback/self-hosted HTTP and MCP accept only separate exact-audience
`srkx_` grants; collector MCP is a static bearer resource and emits no OAuth
discovery. Managed MCP remains separate: the control plane is the OAuth
authorization server, the owner cell is the RFC 9728 resource server, and it
accepts only short-lived exact-audience `srmcp_` tokens.

Public publication is a different data plane. The owner cell extracts an
explicitly allowlisted, frozen publication generation and durably delivers it
through a per-cell publisher credential to `packages/public-directory`. That service has
its own D1 and can read only stored public projections. It cannot query owner
cells, and public request traffic cannot select an owner, workspace, cell,
repository, or session. Web, search, API, and MCP grants are filtered
independently. Whole-generation apply/revoke is atomic and a monotonic tombstone
prevents delayed delivery from resurrecting public state. Contact is an optional
HTTPS URL, never indexed search text.

The accepted decision is
[ADR 002](./adr/002-private-api-mcp-and-public-projection.md). The exact DTO and
publication contracts are held with the services that implement them; the read
contracts anyone needs to build a client are already public in
`packages/types`.

Every surface reads the same worker over plain HTTP. Shared route and read
semantics live in `packages/types/src/api.ts`: route paths (`seorakRoutes`), the
auth header (`bearerHeader`), conditional-GET headers
(`conditionalGetHeaders`), aggregate serve-mode metadata
(`AGGREGATE_CACHE_STATUS_HEADER`), the settings family list
(`SETTINGS_FAMILIES`), what a status means (`classifyWorkerStatus`), and the
closed content-free error codes a surface may use as control state
(`WORKER_ERROR_CODES`). Human-readable worker error prose is never a control
plane. The collector/worker event wire metadata lives separately in the
publish-safe leaf
`event-protocol.ts`. `@seorak/types` is the only package the collector may depend
on, so it is the only place the JavaScript clients can all reach, and none of it
is a secret: the worker's routes are a public API.

There is deliberately **no shared client**. `api.ts` contains no `fetch` call and must never contain one.

### Who reads what

| Route | Terminal | Web | Mobile |
|-------|----------|-----|--------|
| `GET /live` | yes | yes | yes |
| `GET /overview` (ETag + serve mode) | yes | yes | yes |
| `GET /developer-model` (ETag + serve mode) | no | yes | no |
| `GET /sessions` | no | yes | yes |
| `GET /sessions/:id`, `/sessions/:id/outcome` | no | no | yes |
| `GET /replay/:id` | no | yes | yes |
| `GET /interventions` | no | yes | yes |
| `GET /delivery-health` | no | yes | yes |
| `GET /settings` | daemon (capture) | yes | yes |
| `PUT /settings` | no | yes | yes |
| `POST /events` | daemon | no | no |
| `POST /devices`, `/devices/:id/tokens`, `/activity-tap` | no | no | yes |

Push delivery health is a separate, non-cached read model. `GET /delivery-health`
aggregates the durable D1 attempt ledger over the same trailing
30 days retained by the bounded delivery prune, in one aggregate-rate-limited
statement. Development and production are independent records. A record with no
completed attempt is `unobserved` and carries null attempt and failure counts;
only an observed record may report an exact zero terminal-failure count.
`lastAcceptedAt` is an APNs transport acceptance, never proof that the device
displayed the notification or Live Activity.

Cached aggregate bytes and their ETag are one invariant. A FRESH edge entry is
usable only when its stored ETag matches the current aggregate version. An LKG
body is returned without an ETag and with `revalidating` or `stale` serve mode,
so no client can pin old bytes through a 304. Every surface preserves that real
body but marks it stale; a worker or authority change clears the mobile cache
namespace rather than replaying an unrelated validator. Client-facing aggregate
responses, including 304 and retained bodies, are `Cache-Control: private,
no-store`; only the Worker's internal Cache API entries carry edge TTLs.
If stored rollups fall more than the fixed in-memory tail bound behind, a real
LKG body remains available under the same stale contract. A first-ever load has
no product data to preserve, so it returns retryable `503` unavailability and no
aggregate body rather than a partial or zero-filled snapshot.

The aggregate version is a correctness boundary, not a best-effort cache hint.
Event appends, project merges, scheduled session-projection chunks, and
intervention-history insertions and removals commit their product mutation and
version invalidation in the same D1 transaction. A deadline, error, or isolate
teardown therefore commits both facts or neither; it cannot leave obsolete
bytes valid under an unchanged ETag.

### Where validation differs, on purpose

| Surface | Posture | Why |
|---------|---------|-----|
| **Web** | zod parse, strip mode, strict current response | Dashboard and worker deploy together. A malformed refresh preserves the prior snapshot as stale, while a malformed cold load shows a schema error. Narrow element/enum guards may isolate additive future values, but a missing required field never becomes fabricated empty data. Contract-parity tests round-trip a fully populated snapshot and fail on any dropped key |
| **Mobile** | native-free shallow parsers for fields the screen dereferences, no stripping | A field the worker adds reaches the phone with no schema edit, while malformed live/session/intervention/replay bodies become explicit read errors instead of fabricated empty state. Parser and no-strip tests pin both halves in `apps/mobile/test/responseParsers.test.mts` and `workerClient.test.mts` |
| **Terminal** | additive shallow guards for every field its renderers dereference | A malformed successful body degrades like a failed read instead of becoming fabricated empty data or throwing. Unexpected callback failures still restore raw mode, cursor, listeners, timers, and the alternate screen before the session exits |

These are three different answers to the same question and all three are deliberate. The web posture changed from section-level empty substitution because a malformed measured section looked indistinguishable from real zero activity. Do not unify the remaining transport and presentation choices without a STATUS note.

### What stays surface-local

Transport policy: timeouts, retry and backoff, poll cadence, `cache: 'no-store'`,
abort handling, and credential storage. Product web uses a revocable HttpOnly
session after a control-plane OAuth binding and one-time cell handoff; a root
read-key exchange remains emergency compatibility only. Dogfood retains the
legacy `localStorage` bearer. Launchd uses its plist or env. Mobile uses
app-only Keychain authority. Hosted mobile sign-in uses the same control-plane
device + PKCE contract as `seorak login`, but requests a mobile-control/read pair rather than
the collector's ingest/read pair. The secure authentication session returns only through the
exact registered `seorak://auth/complete` callback; the credentials remain in
the polling response and are committed before the client acknowledges it.
Hosted account deletion is not a mobile-bearer route: Settings launches a fresh
provider authentication plus server-side destructive confirmation, and clears
the Keychain only after the control plane durably records the cleanup graph and
returns through `seorak://account/deleted`.
Mobile bearer authority and persisted APNs/ActivityKit tokens are
also after-first-unlock and this-device-only; neither is assigned to an
extension access group. Mobile worker targets require HTTPS except for exact
loopback development hosts, so neither read nor ingest authority can traverse a
LAN in plaintext. Presentation is local by definition.

Product hosting is one isolated owner cell per owner, and the control plane that
binds an identity to a cell is a separate service that holds **no owner data
binding** at all. That separation is the part worth knowing from outside: the
service that knows who you are cannot read what you captured, and the cell that
holds what you captured does not know who you are.

Client authority is least-privilege in both directions. Collector ingest can
write capture routes but cannot mutate mobile settings; mobile control can mutate
notification and device routes but cannot ingest; both clients' read tokens are
read-only, and one authorization id binds each pair so a revocation is atomic and
does not rotate anything else. That is a property of the route contract in
`packages/types`, so any plane implementing it inherits the same shape.

Local purge revokes capture outside the target, drains daemon and hook leases,
and removes only an inode-bound state namespace. Hosted deletion is the managed
service's own procedure and its ordering is held with that service; there is no
public data-lifecycle route in the contract.

### Adding a fourth surface

Depend on `@seorak/types`, build URLs from `seorakRoutes`, send `bearerHeader(token)`, and pick a validation posture from the table above. Do not copy an existing client. `packages/worker/test/route-contract.test.ts` uses an exhaustive builder/method invocation map independent of the Worker policy and pins it against the real router in both directions, so either an undeclared handler or a declaration with no handler fails CI. Authorization intent has its own exhaustive literal `id -> access` census in `auth.test.ts`; bearer behavior is driven from that independent oracle rather than from the policy it audits.

---

## Open-source split

**Trust boundary:** runs on developer machine → open; runs on Seorak servers or App Store → closed.

The boundary is settled in
[ADR 005](./adr/005-open-core-repository-and-free-ui-packaging.md): two
repositories, one direction, no mirror. The public core is
`@seorak/types`, the collector CLI (published as the unscoped `seorak`), and
`@seorak/dashboard`, the last being the built primary UI the collector's loopback
plane serves. The private cloud keeps
identity, billing, entitlement issuance, provisioning, managed cells, APNs, the
operated directory, and Seorak's website. The public core never imports the
private cloud; the private cloud pins exact published versions of the public
packages.

Collector rules (enforce during monorepo phase):

1. Collector talks to worker **only** via public HTTP API — no worker imports.
2. `packages/types/` contains only publish-safe types — no auth secrets, no proprietary algorithms.
3. Collector source depends on `types` + development tooling only, never
   `worker`, `push`, or `web`. Its npm artifact compiles collector-owned source
   into the executables and resolves shared validators through the pinned public
   types release instead of copying that dependency into its own license scope.

The Apache-licensed 0.1.0 package artifacts are publication-ready: both ship
compiled ESM, types ships declarations, exact file allowlists exclude tests and
build configuration, and `publication:check` clean-installs and exercises them.
Public catalogs, default thresholds, and vendor list prices belong in the
shared package because they are already exposed by the wire contract and must
remain identical across consumers. Secrets and the worker's scoring,
evaluation, and extraction implementations do not. Those three words are given
an operational definition in exactly one place,
`scripts/check-types-publish-safety.mjs`, which classifies by code shape and so
authorises the catalogs above by construction rather than by repeating this
list; `npm run types-boundary:check` reports what is placed against it and
[reference/types-boundary-acceptance.json](./reference/types-boundary-acceptance.json)
records why each survivor is still there. The pre-publication
Codex-tail and repo-identity compatibility importers were
retired after every supported local ledger reached its current version; missing,
retired, and future versions now fail closed instead of becoming public package
contracts.
`publish:beta` authenticates through an ephemeral npm config, re-runs the full
publication check, and publishes types before collector. The packages have not
received their first registry release because registry scope authority was not
supplied.

**Two of those three claims do not survive contact with the shipped artifact.**
Nothing packages `packages/web/dist-dashboard` into the collector, and
`scripts/build-package.mjs` throws on any input outside `bin/` and `src/`, so an
npm-installed collector serves the route contract and no dashboard. The
publication gate's required-file list names only the seven bins, so a release
that ships zero UI passes every check. ADR 005 closes both: the built dashboard
becomes `@seorak/dashboard`, an ordinary dependency of the collector, and the
gate gains a required-file assertion for it.

The earlier plan recorded here, a public `seorak-collector` repository with
`packages/web` closed, is superseded by
[ADR 005](./adr/005-open-core-repository-and-free-ui-packaging.md). A collector
that cannot render its own product is not the open core the Free contract
describes.
See [reference/voice-and-scope.md](./reference/voice-and-scope.md) and
[dependency-advisory-posture](./reference/dependency-advisory-posture.md).

---

## Event log retention

D1 is append-only; the bounded retention implementation drops events beyond a
horizon of **400 days**. Every event and rollup delete is limited to 5,000 rows,
with at most 24 chunks shared across an attempt. The horizon sits above the
deepest `/overview` read, which reaches `now - 180d` for a 90-day adjacent-window
comparison. Rows are pruned only when invisible under both `at` and the deferred
`received_at` cutover. Retention runs from real activity rather than a timer, and
its execution state on any deployed instance is a property of that deployment
rather than of this contract.

The **400 days** is the number that matters outside: it is the ceiling ADR 001
records for the hosted log, and it is why the collector's local SQLite, which
prunes nothing, is the permanent authority. A local install is not subject to
any of the above.

Hosted traffic proves the delivery and session-projection cutovers with one
combined D1 statement per request. The result is not retained in module scope:
Cloudflare may reuse an isolate after changing only its bindings, so a latched
success could authorize a newly bound, unverified database. Any missing marker
or read failure therefore fails closed. Session-set reads never enumerate KV:
live sessions keyset-page a partial `(projection_id) WHERE ended = 0` index,
while ended rows are retained and pruned through their separate retention index.

---

## Overview rollups

`/overview` and `/developer-model` read three per-hour rollup tables (migration 0007), keyed `(bucket, session_id, ...)`, in place of the `tool.call` rows behind them. Two bounded reads still touch raw events; one-shot outcomes moved to a dedicated per-session projection in migration 0025.

| Table | Grain | Rows over 60 days |
|---|---|---|
| `rollup_call` | hour, session, agent, tool, verificationKind | 9,020 |
| `rollup_model` | hour, session, agent, model | 1,509 |
| `rollup_file` | hour, session, file | 11,400 |

Reading per-event rows did not fit: 172,988 rows cost 43.5 MB of heap before any payload, and 30d and 90d died with `outcome: exceededMemory`. Three properties keep the aggregates honest across the change, and each is load-bearing rather than incidental:

- **`session_id` is in every key.** Distinct-session counts are not additive, so a grain that stored a session count would multiply one long session by the hours it ran. It is also how every per-repo cut joins (a `tool.call` carries no repoId) and how the per-session capability gate stays expressible.
- **No rate is stored, only its two legs.** A rate needs both legs, so `errored_calls` and `errored_present_calls` are separate columns and the division happens at read time, where an agent that cannot observe a failure can still answer honest-null.
- **No dollar is stored, only tokens.** Cost is re-priced from `@seorak/types/pricing.ts` on every build, so a price correction still moves history on a deploy.

The rollups are a derived cache. `events` stays authoritative,
`foldToolCallRows` is the whole definition, and `resetRollups` drops the tables
and replays. Accepted ingest now folds new events off the durable rowid
high-water before acknowledging the collector. A failure after append returns
503; the collector retries, duplicate inserts are ignored, and the same tail is
folded exactly once. The read path still merges a bounded un-folded tail during
concurrent requests.

The scheduled handler retains its 20-second cooperative deadline and bounded
units for tests and recovery execution, but `wrangler.toml` sets `crons = []`.
One `ActivityScheduler` Durable Object per Worker cell now invokes the same
bounded maintenance phases only when indexed D1 deadlines or recent mutations
require them. The fixed `READ_TAIL_CAP` remains an isolate-memory bound rather
than scaling with traffic; ingest maintenance normally keeps the tail near one
accepted batch.

### Activity-proportional maintenance

D1 is the scheduler source of truth. Migration 0028 adds an expression index
for the earliest live status transition, a partial expiry-ordered outbox index,
and a singleton content-free health row. The Durable Object stores no owner
payload and no competing queue state: it retains only the first dirty time,
next alarm, and consecutive failure count. Hosted mutations that can create or
move maintenance work commit D1 first, then await a `/rearm` call before
acknowledgement. A rearm failure returns 503 so the idempotent caller retries.

The first mutation in a burst guarantees evaluation within ten minutes. Between
bursts, six indexed scalar seeks choose the exact next idle, stuck, abandoned,
pending retry, lease expiry, or semantic expiry deadline. With no candidate and
no dirty timestamp the object deletes its alarm, eliminating an idle request
floor. Six rapid exponential retries preserve transient recovery; later failure
persists `dead_letter` and wakes at a six-hour ceiling or on new activity.
Delivery leases and idempotency remain in D1, so duplicate alarms cannot create
duplicate external effects. `crons = []` remains a hard configuration invariant.

Grain and fold: `packages/worker/src/eventlog/rollupGrain.ts`. Storage and read: `rollupStore.ts`.

### What still reads raw events

Two raw-event reads remain. Rows returned to the isolate per cache-MISS build are
measured against the production-shaped fixture; one-shot is listed separately
because it now reads a session projection rather than `events`:

| Read | Why it is not a bucket read | Rows at 7d / 30d / 90d |
|---|---|---|
| Usage allowances | the rolling 5-hour window needs millisecond bounds; an hour grain would widen it by up to 20% | 1 / 1 / 1 — summed in SQL, one row per agent |
| Un-folded tail | freshness during a concurrent or interrupted ingest fold | 24 / 24 / 24 — fixture tail, hard-capped at `READ_TAIL_CAP` |

Migration 0025 backfills `session_one_shot_outcomes` once. Later appends refresh
each affected session's run count and distinct-tool count inside the event
transaction once that session has ended, including out-of-order calls. Overview
reads 62 / 271 / 817 indexed projection rows at dogfood 7 / 30 / 90 days and
never joins the event log.

The two raw reads total 25 rows at every range. The three bucket reads over the
same ranges are 4,434 / 19,068 / 57,440. Exact raw and bucket totals are pinned by
`packages/worker/test/overview-scale-budget.test.ts`; the one-shot migration and
equality suites prove the projection preserves the prior rule.

### The next grain question

At ten times dogfood volume the 90-day build returned 431,156 rows as 168 MB, of which `rollup_file` alone was 220,237 rows and 100.5 MB — past the 128 MB isolate ceiling by itself. This section previously concluded that closing it required a coarser second rollup or a top-N cut pushed into SQL, and that "both change what is STORED, not how it is read." That framing was wrong, and the reason is worth keeping.

`rollup_file` was read at the *prior*-window bound so the cost delta could compare two windows, but the file legs are only ever consumed over the current window, so half the rows were fetched and discarded. Binding the file grain to the window it is actually consumed over, and collapsing the hour away in SQL (`GROUP BY session_id, file_id, dir_id, file_language, file_category`), is a pure read-path change and needs no new stored table. `session_id` stays in the key, so distinct-session counts remain correct. At external 90 days: 431,156 rows / 168.10 MB → 283,748 rows / 99.04 MB, with `rollup_file` itself 100.5 MB → 31.4 MB. The bind contributes 2.01x and the collapse 1.51x, measured separately.

The two halves are ordered, not independent. Collapsing over the prior window is *unsound*: a session straddling the window boundary folds its pre-window edits into the window total, and the damage cannot be repaired downstream because the collapsed row carries one `MIN(bucket)`, so a later filter drops the row whole rather than trimming it. `assertFileWindowInside` rejects the reversed bound before any read is issued, and `test/rollup-file-window.test.ts` pins the straddling case directly.

What is NOT closed: 99.04 MB is JSON bytes of returned rows, not retained heap. Applying the same per-row object overhead the original measurement used puts the retained set plausibly near 174 MB, so the isolate question is improved but not settled. The honest gain is the object count, 431,156 → 283,748, which is the quantity that produced `exceededMemory`. `rollup_call` at 158,820 rows / 51.5 MB is now the largest single term and must stay at the deeper bound because the cost delta reads that prior leg. That is the next target.

---

## Multi-repo data model

Overview merges all repos in the window. `ProjectRollup` per repo powers Project view and compare. See [specs/multi-repo.md](./specs/multi-repo.md).

Key types: `packages/types/src/overview.ts` → `ProjectRollup`. Worker projection: `packages/worker/src/overview.ts`.

---

## Runbooks

| Task | Doc |
|------|-----|
| Local dev | [../README.md](../README.md) |
| End-user setup | [../SETUP.md](../SETUP.md) |
| Collector + hooks | `packages/collector/README.md` |
| Worker | `packages/worker/README.md` |
| Push / APNs | `packages/push/README.md` |
| iOS | `apps/mobile/README.md` |
