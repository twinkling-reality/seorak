# ADR 003: One primary UI over a modular data plane

Status: accepted for implementation. Production activation of the managed plane
remains gated by [ADR 001](./001-local-first-compact-sync.md) and by the
managed service's own rollout order.

Date: 2026-08-02. Amended 2026-08-06: sections 4b, 4c, 4d, and 4e. Section 4's
slice table is superseded and its removal condition is no longer the operative
decision; section 2's parity sentence is corrected. 4c decides for
machine-checked parity over extraction and 4e records that landing. Amendments
are marked in place rather than folded in, so the document stays the record of
what was believed when.

Supersedes nothing. Builds on ADR 001, which made local SQLite the permanent raw
authority and defined the compact-sync protocol. This ADR is about what the
person actually looks at, and who is allowed to decide that their managed copy
should end.

## Context

ADR 001 settled where the record lives. It did not settle how many products read
it, and the repository drifted into two:

- the primary web app, which assumes a reachable worker; and
- `seorak local dashboard`, a separate simplified loopback interface that the
  account-free path is currently pushed toward.

That split puts the Free user on the lesser of the two. It also creates two
honesty regimes, because every rule about honest-empty, unavailable surfaces,
and partial-copy labeling has to be re-implemented and re-tested in whichever
interface was built second. Meanwhile the settled product contract is the
opposite: Free and Pro contain the same capabilities, and the only difference is
who operates the infrastructure for remote access.

The managed side brought a second unanswered question. A downgrade produces a
read-only copy, a 30-day recovery window, a customer export, an eventual
deletion, and possibly a later rebuild from local history. Something has to be
authoritative for those dates and grants, and the obvious candidate, the owner's
own cell, is exactly the resource the lifecycle is deleting.

## Decision

### 1. One primary UI reads a modular data plane

There is one product UI. It reads a plane described by
[`packages/types/src/data-plane.ts`](../../packages/types/src/data-plane.ts),
and the three legal planes are the same route contract:

| Authority | Operator | Default for |
|---|---|---|
| `local` | `local-machine` | every install, including Pro, at the machine that captured the work |
| `remote` | `self-hosted` | a Free user who operates their own service |
| `remote` | `seorak-managed` | an entitled Pro user |

Local loopback authority is the default and needs no operator credential; the
parser refuses a local plane that demands one, because an operator credential
gate in front of the Free product would be a login by another name. Distinct
exact-audience integration grants authorize only the private API or MCP
resource. A managed remote authority is added on top when entitled and never
replaces the local one.

`ManagedSyncCoverage` makes a partial remote copy legible, and
`planeReadsAreComplete` is the only sanctioned completeness answer. The
vocabulary and its refusals are in `packages/types/src/data-plane.ts`, which is
where every plane's answer has to parse; the managed lifecycle contract those
values serve is a commercial document and is not here.

### 2. The collector re-implements local projections; it does not import worker code

Local session, hour, transition, report, replay, and dashboard projections are
implemented inside the collector, against the shared contracts in
`@seorak/types`, rather than by importing `packages/worker`. That
implementation is `packages/collector/src/local-projection.ts`: 3,051 lines and
58 functions as of 2026-08-06, including `fileHeat`, `dirHeat`, `fileRework`,
`lineSurvival`, `verificationRollups`, `toolRollups`, and `modelRollups`. It
read 2,248 lines and 51 functions when this ADR was written on 2026-08-02; the
duplication has grown by a third in four days, which is the cost of the
arrangement compounding rather than holding steady.

**Measured again on 2026-08-06, that compounding is one-sided, which is a
different and more useful fact than "the duplication grew".** The fourteen
modules below still total exactly 4,161 lines: the hosted pure layer did not
change by a line in those four days. All 803 added lines are on the local side,
and 731 of them landed on 2026-08-04 alone, in `5ffdeffc`, `62b19109`,
`aaffaf7e`, and `115d667a` — local `sessionOutcome`, the developer-model
portrait, local intervention evaluation, and the outcome-scan bound. **Read that
as one burst, not as a rate**: four days is too short an interval to extrapolate
from, and pretending otherwise would be the kind of number this document exists
to refuse. What the interval does establish is the DIRECTION. The two halves are
not drifting apart symmetrically under shared maintenance; the local plane is
acquiring derivations the hosted layer does not have. Section 4c is where that
gets priced, because it means the extraction's target is stationary and its
consumer is not.

This is the ADR 001 open-core boundary, restated where it costs something. The
collector is the package intended to open; the worker is not. Importing worker
code into the collector would pull hosted implementation into a publishable
package, and it would pull D1, KV, Durable Object, and cell-identity assumptions
onto a laptop that has none of them. The collector already depends only on
`@seorak/types` plus npm, and that rule is what makes the local product runnable
with no account and no service to operate.

**The boundary does not force this duplication, and this ADR should not pretend
it does.** The pure and D1-bound halves of the worker's projection layer are
already cleanly separated. Every D1 statement lives in `overviewReads.ts`,
`eventlog/rows.ts`, and `eventlog/rollupStore.ts`. Measured directly, these
fourteen modules contain zero occurrences of `.prepare(`, `D1Database`, or
`env.DB`:

| Module | Lines |
|---|---:|
| `eventlog/payload.ts` | 375 |
| `eventlog/rollupGrain.ts` | 526 |
| `eventlog/codebase.ts` | 378 |
| `eventlog/activity.ts` | 93 |
| `eventlog/repoContext.ts` | 518 |
| `eventlog/momentum.ts` | 222 |
| `eventlog/quota.ts` | 175 |
| `eventlog/conditionalOutcomes.ts` | 144 |
| `overviewWindow.ts` | 238 |
| `overviewProjects.ts` | 392 |
| `overviewKvRollups.ts` | 532 |
| `capabilityGates.ts` | 128 |
| `notificationAvailability.ts` | 30 |
| `intervention.ts` | 410 |
| **Total** | **4,161** |

Every row-shape reference in `activity.ts`, `codebase.ts`, and `repoContext.ts`
is `import type`, so those three interfaces detach from the fetchers without
touching the fetchers.

**That was measured over slice 1 and then generalised to the whole table, which
was wrong.** A 2026-08-06 remeasurement of the full import closure is in section
4: the fourteen modules above are D1-free, but they are not CLOSED, and the
difference decides whether the layer can move. What blocks the extraction today
is therefore not only sequencing and blast radius. Section 4 records the exact
removal condition, and now also records why it is not met.

Until that extraction happens, the honest statement is that parity between the
local and hosted projections is held **by tests rather than by there being one
implementation**. That is a weaker guarantee than one implementation, and it is
accepted deliberately and temporarily, not preferred.

**That sentence's weakest word was "hand-maintained", and it stopped being true
on 2026-08-06.** Parity is now held by a VALUE gate — `npm run
projection-parity:check` drives both implementations from one event fixture and
compares numbers. Two implementations checked by machine against a shared fixture
is still weaker than one implementation, because a field the fixture does not
exercise is not checked at all. It is much stronger than two implementations
checked by reading, which is what this paragraph described when it was written.
Section 4c weighs that difference against what removing it now actually costs,
and concludes that machine-checked parity is the plan of record rather than the
consolation prize. **"Deliberately and temporarily" therefore stands; "until that
extraction happens" no longer names a scheduled event.**

Until 2026-08-06 it was weaker still than this paragraph implied, because no
test compared a VALUE. `packages/collector/test/local-projection-parity.test.ts`
pins which fields are measured versus honest-empty; it never asserted that a
number agreed, and it could not, because the hosted answer is not importable
into that package. The comparison now exists at
`scripts/check-projection-parity.mjs` (`npm run projection-parity:check`), which
drives both implementations from one event fixture and compares seven fields
exactly. It is a script rather than a suite because it must import both
packages, and the boundary gate rejects that from inside either one; `scripts/`
is private, and private may read both halves.

**It found a divergence on its first run,** which is the evidence this paragraph
previously had no way to produce. The local plane counted each `session.tokens`
carrier snapshot as a model call, reporting `calls: 2` for a Codex model the
hosted plane reports at a measured `0`. `ModelRollup.calls` is a model-item
count, and a session-costed tool's `tool.call` rows carry no `models[]` at all,
so the hosted answer was right and the local one fabricated a count beside real
tokens and real dollars. Fixed in `f634a2e`, with the rule re-pinned inside the
collector's own suite because the parity gate is private and does not travel to
the open-core repository with the package it guards.

### 3. Lifecycle and recovery authority live in the control plane

The control plane owns the canonical lifecycle facts: the paid-through instant,
the end of remote service, the hosted deletion instant, the recovery grant, and
the rebaseline epoch. The owner cell derives its effective phase from those facts
plus its own clock, so managed service stops at the paid-through instant even if
no further provider event ever arrives.

The cell cannot be the authority, for four reasons that are not stylistic:

1. **A cell cannot authorize its own deletion.** The lifecycle ends by removing
   the cell's Worker, D1, KV, R2 objects, and Durable Object. The record of
   intent and completion has to outlive the resource being destroyed.
2. **The recovery grant must outlive the entitlement that just expired.** During
   the 30-day window the cell is correctly refusing hosted product routes with
   `402`. A grant issued by the thing that is refusing would either weaken that
   refusal or expire with it.
3. **`managed-home-changed` crosses cells.** No single cell can be authoritative
   for a move between two of them.
4. **Authority must fail closed without touching local work.** A control-plane
   read failure disables hosted capability and changes nothing local. The
   reverse arrangement, a cell asserting its own entitlement, is a client
   granting itself Pro with extra steps.

Provider adapters remain inputs to the canonical ledger rather than the model
itself, and the cell applies only a greater monotonic revision.

### 4. The duplication has a named removal condition

> **Superseded on 2026-08-06 by sections 4b and 4c, and left in place because it
> is the record of what was believed.** The slice table below is wrong: it is not
> closed under its own dependencies, and section 4b measures what closing it
> costs. The removal condition itself is no longer the operative decision —
> section 4c makes machine-checked parity the plan of record and demotes this
> condition to a standing option. What survives unchanged is the agent-standards
> obligation: the duplication is still temporary in principle, still named, and
> still gated.

Per [agent-standards](../reference/agent-standards.md) section 7, temporary
duplication names its removal condition, has a verification gate, and is deleted
when the condition is met. This is that condition, and it is falsifiable rather
than "someday".

**Trigger, both parts required:**

1. the worker is not under concurrent modification by another workstream; and
2. the shared package can absorb the **whole** pure layer in one release, not
   part of it.

The second half is the one that bit us. A partial extraction on top of a
finished hand-port produces three states rather than two: a shared package
covering part of the surface, duplication covering the rest, and fresh collector
code needing a rewrite to consume the shared half. That is worse than either
clean option.

**Slices, in order:**

| Slice | Contents |
|---|---|
| 1 | the row interfaces plus `payload.ts`, `rollupGrain.ts`, `codebase.ts`, `activity.ts`, `repoContext.ts`, and `agentOfRow` |
| 2 | the pure exports of `tools.ts`, `usage.ts`, and `outcomes.ts`, split along their pure/D1 seams |
| 3 | `momentum.ts`, `quota.ts`, `conditionalOutcomes.ts`, `overviewWindow.ts`, `overviewProjects.ts`, `overviewKvRollups.ts`, `capabilityGates.ts`, `notificationAvailability.ts`, and `intervention.ts` |

Slice 2 is a split rather than a move: `tools.ts` imports the D1 fetcher
`fetchToolCallRows` and `usage.ts` imports a value alongside its row types, so
neither relocates whole the way slice 1 and slice 3 do.

**The table's error is not that a slice is misordered; it is that "a split
rather than a move" describes thirteen of these seventeen modules and the table
says it about three.** Section 4b measures which, and by what edge.

### 4a. Measured 2026-08-06: the trigger is NOT met

Trigger half 1 held: no other workstream was editing the worker. Half 2 does
not, and the reason is a property of the tree rather than of scheduling, so
waiting does not fix it.

What still holds. All fourteen modules in section 2's table match their recorded
line counts exactly and contain zero occurrences of `.prepare(`, `D1Database`,
or `env.DB`. Slice 2's three files each have a real pure/D1 seam: `tools.ts`
splits about 557/28, `usage.ts` about 624/32, `outcomes.ts` about 463/309. The
pure layer is roughly 5,805 lines all told. **Slice 2 is not the blocker.**

What does not hold: **the slice list is not closed under its own dependencies.**
The pure layer reaches six modules that appear in no slice, and five of them
contain D1 code:

| Reached module | By | Needs |
|---|---|---|
| `eventlog/rows.ts` | five modules | the row interfaces plus `USAGE_ALLOWANCE_WINDOWS` (anticipated by slice 1) |
| `eventlog/store.ts` | `outcomes`, `momentum` | `EventRow` |
| `eventlog/sessionTokens.ts` | `quota`, `overviewProjects` | `CarrierRow`, `ModelUsage`, `SessionTokensScan` |
| `eventlog/developerModel.ts` | `conditionalOutcomes`, `overviewProjects` | `SessionStartRowWithPayload`, and `typeof endReasonsByHourFromRows` |
| `eventlog/stuckLoop.ts` | `intervention` | `StuckLoopRuns` |
| `overviewReads.ts` | `overviewProjects` | `OverviewEventLogRows` |

plus two value edges, `time.ts`'s `DAY_MS` and `rollupStore.ts`'s
`WINDOW_ROW_BUDGET`.

Those are mostly `import type`, and the instinct is that a type edge is free.
It is not, for two reasons that were verified rather than assumed.
`analyzeImports` in `scripts/check-package-boundaries.mjs` records every
`ImportDeclaration` specifier and never consults `isTypeOnly`, so a type-only
import IS a boundary edge to both gates. And the shared package must be
`public`, because the collector is public and public may import only public and
split; the worker is private, and `mayImport(public, private)` is false. So
those types cannot stay where they are and be referenced. They must MOVE, which
means splitting three more D1 modules that this ADR never scoped or measured,
and restating `OverviewEventLogRows`, which is defined entirely as
`Awaited<ReturnType<typeof …>>` over eight D1 fetchers. `developerModel.ts` is
the sharpest case: `overviewProjects.ts` needs `ReturnType<typeof
endReasonsByHourFromRows>`, so a FUNCTION has to move out of an unscoped D1
module, not merely a type.

A second finding is independent of the first and would survive fixing it. The
collector could not consume the extracted layer without reversing a deliberate
decision. It streams events through `StatementSync.iterate`, and
`local-projection.ts` says why at the call site: `.all()` "would hold every
payload in memory at once, and this database only grows." The pure layer's API
is `*FromRows(rows: ToolCallRow[])`, a materialized array, and
`*FromBuckets(buckets)`, the KV rollup grain a laptop has no source for. Its
`local_event` table has no `agent` column, which `ToolCallRow` requires. And the
pure layer alone does not produce the contract's values on either side: the
honest answer is assembled in `overviewEventLog.ts`, which is in no slice, by
applying `pricedRowsOf` / `ratableRowsOf` at the call site and folding the
`session.tokens` carrier back in. Called naively, the extracted primitives
reproduce the fabricated $0.00 day that `pricedRowsOf` exists to prevent.

**So the all-or-nothing rule applies and the answer is none.** Landing slices 1
to 3 as scoped leaves the layer open; closing it is an expansion into the D1
layer that this ADR did not authorize. A partial landing is the three-state
condition above, which is worse than either clean option. The next attempt
should scope the closure, not the fourteen modules.

This changes nothing about the DECISION. The duplication is still temporary,
still carries a removal condition, and is now guarded by a value gate rather
than only by a field census.

**Section 4c changes the decision.** That sentence was written the same day, an
hour earlier, and it was right that a failed attempt is not a reversal. What it
did not do was ask whether the removal condition is still the right goal now
that the value gate exists. Section 4c asks it.

**Shape when it happens:** a private, unpublished workspace package that both the
collector and the worker depend on, bundled into the collector's published
artifact rather than becoming a fourth published package. ADR 001 deferred a
local-core package specifically so this work would not "expand package
publication or repository extraction scope before approval"; a private bundled
package honors that reason literally while superseding the conclusion on
evidence ADR 001 did not have.

**Verification gate:** the worker's existing suite passes unchanged against the
shared implementation, and the collector's local projections produce identical
values for a fixture the two currently compute separately.

The second half of that gate now exists ahead of the extraction, as
`scripts/check-projection-parity.mjs`, and it is worth having whether or not the
extraction ever happens: it is what turns "the two agree" from an assumption
into a measurement. Building it first was also what surfaced the first real
disagreement (section 2). Note what its existence proves about the gate as
originally written: it could never have lived where the sentence above implies,
because no suite inside either package may import the other.

### 4b. Measured 2026-08-06: the real closure, and where it stops

Section 4a walked one level of imports and found six unscoped modules. This is
the transitive walk, computed mechanically rather than read, by
`scripts/check-projection-closure.mjs` (`npm run projection-closure:check`). It
is a gate rather than a one-off, because the failure mode of 4a's finding is that
it rots quietly: one import added to `overviewProjects.ts` and the closure grows
a module nobody re-measures. The gate records the closure as measured here and
fails when it changes, so the next attempt starts from a number it can trust.

**Two closures, and their difference is the whole answer.**

- The **value closure** follows only edges that import a value: the modules whose
  implementation is dragged along because the extracted code calls them.
- The **gate-visible closure** follows every edge. `analyzeImports` in
  `check-package-boundaries.mjs` records every `ImportDeclaration` specifier and
  never consults `isTypeOnly`, so a type-only import is a boundary edge to both
  gates, and `mayImport(public, private)` is false for a type edge exactly as for
  a value one.

**The naive reading does not terminate anywhere useful: 36 modules, 11,912
lines, 33% of the worker's 35,695.** It runs out of the projection layer entirely
and into `routeAccess.ts` (960), `observability.ts` (721),
`integrationCredentials.ts` (507), `scopedCredentials.ts` (349),
`browserSessions.ts` (245), `ownerCell.ts`, `authAbuse.ts`, and `env.ts`. That
tail is 11 modules and 3,341 lines of the worker's route-policy, credential, and
observability core, none of which is a projection.

**All 3,341 of those lines enter through ONE edge.** `eventlog/store.ts` is
reached from the pure layer only by `import type { EventRow }`, in `momentum.ts`
and `outcomes.ts`. `store.ts` imports `prepareOverviewVersionBump` from
`eventlog/version.ts`, which imports `emitInternalError` from `observability.ts`,
which imports `ROUTE_ACCESS_POLICY` from `routeAccess.ts`, and the credential
modules follow from there. That chain never fires if a type edge is paid by
moving the DECLARATION rather than the module holding it — which it must be,
since the point of the type edge is that no implementation is needed. So the
closure is bounded, and this is the number the extraction is actually held to:

**Value closure: 20 modules, 7,693 lines.** Seventeen scoped (6,375 lines — 4a's
6,006 pure lines plus the 369-line D1 tail of `tools.ts`, `usage.ts`, and
`outcomes.ts` that a split leaves behind) plus three the slices never named:

Restated 2026-08-21, from 7,557 and 6,239. The 136-line delta is five scoped
modules, and all of it is one rule arriving in the places that were missing it:
`usage.ts` +38, `overviewKvRollups.ts` +76, `activity.ts` +9,
`overviewProjects.ts` +7, `intervention.ts` +6. `usage.totals.sessions` counted
every session that opened, including the ones that measured nothing, so the
member read as a count of processes while `toolCalls` and `cost.totalUsd` beside
it counted work. The predicate itself is four lines in `@seorak/types`
(`sessionMeasuredWork`, and `sessionHasActivity` for the silence watch); the
weight here is threading one measured-session set through the four producers per
engine that were each deriving the count their own way, plus the doc comments
saying why a caller cannot skip it. The delegation target is an external package,
so no module entered or left: still 20 by value, 17 scoped, 5 type-only, 36
gate-visible. The addition is pure, so the D1 tail stays 369 and 4a's pure lines
go 5,870 to 6,006.

This one grew the closure rather than shrinking it, and the reason is worth
recording: the parity gate could only catch the disagreement once BOTH engines
applied the rule, and it did catch it, in both directions at once. The worker was
excluding the measureless sessions from its end reasons while the collector was
not, and the collector was excluding them from `tools.agentDaily` and the
headline while the worker was not. Neither half was wrong on its own terms and
neither would have noticed alone.

Restated 2026-08-17, from 7,561 and 6,243. The 4-line delta is one scoped
module: `intervention.ts`, where `resolveNotificationConfig` stopped restating
the stored-layer precedence and started calling `resolveProjectSignal` in
`@seorak/types`, keeping only the env-seed overlay that a publish-safe package
cannot hold. The closure got smaller for once, and by removal rather than
tightening: the same rule was written in three places, and two of them were UI
code that could disagree with the engine without either being edited. The
delegation target is an external package, so no module entered or left the
closure — still 20 by value, 17 scoped, 5 type-only, 36 gate-visible. The
removal is pure, so the D1 tail stays 369 and 4a's pure lines go 5,874 to 5,870.

Restated 2026-08-16, from 7,548 and 6,230. The 13-line delta is one scoped
module: `overviewWindow.ts`, where `resolveOverviewWindow` took an injected
`nowMs` instead of reading the wall clock. That was a defect fix, not a feature
— the parity gate pinned an instant on the local side while the worker's window
drifted with real time, so the check went red on its own once real time passed
the fixture. The addition is pure, so the D1 tail stays 369 and 4a's pure lines
go 5,861 to 5,874. The module counts did not move: the closure is still 20 by
value, 17 scoped, 5 type-only, 36 gate-visible.

Restated 2026-08-12, from 7,492 and 6,174. The 56-line delta is two scoped
modules and is entirely the `tokensTotal` leg of the per-agent daily series:
`usage.ts` 656 to 698, where `agentDailyFromBuckets` learned to carry tokens,
and `overviewProjects.ts` 392 to 406, its call site. Both additions are pure, so
the D1 tail stays 369 and 4a's pure lines go 5,805 to 5,861. The module counts
did not move. The numbers below in sections 5, 6 and A are the ones the decision
was weighed against and are left at what was measured then.

| Reached by value | Lines | D1 | By, and for what |
|---|---:|---|---|
| `eventlog/rollupStore.ts` | 861 | yes | `overviewWindow.ts`, for the one constant `WINDOW_ROW_BUDGET` |
| `eventlog/rows.ts` | 315 | yes | `tools.ts` and `usage.ts`, for `fetchToolCallRows`, `fetchSessionStartRows`, and `USAGE_ALLOWANCE_WINDOWS` |
| `time.ts` | 142 | no | `momentum.ts` and `outcomes.ts`, for `DAY_MS` |

`time.ts` is the only one that can move whole. The other two are D1 modules that
have to be split for a constant and a fetcher pair, and neither split is in any
slice.

**Type-only reached: 5 modules, 1,079 lines to open.** Section 4a listed six;
this lists five because `eventlog/rows.ts` is reached by a value edge as well and
is charged once, above. Every one carries D1 code, which is why "mostly type
edges" is not the reassurance it sounds like — each is a D1 module that must be
split so a declaration can leave it:

| Reached by type only | Lines | Declarations owed |
|---|---:|---|
| `eventlog/sessionTokens.ts` | 323 | `CarrierRow`, `ModelUsage`, `SessionTokensScan` |
| `overviewReads.ts` | 256 | `OverviewEventLogRows`, which is eight `Awaited<ReturnType<typeof …>>` members over eight D1 fetchers and has to be restated structurally |
| `eventlog/store.ts` | 233 | `EventRow` |
| `eventlog/developerModel.ts` | 161 | `SessionStartRowWithPayload`, plus the FUNCTION `endReasonsByHourFromRows` itself, because `overviewProjects.ts` names its `ReturnType<typeof …>`. The function is pure and resident in a D1 module, which is the sharpest case in the table: a type edge that only a code move can pay |
| `eventlog/stuckLoop.ts` | 106 | `StuckLoopRuns` |

**How closed the slice list actually is.** Thirteen of the seventeen scoped
modules have at least one edge leaving the list. The maximal subset that is
closed under its own dependencies is four modules and 1,065 lines:
`eventlog/payload.ts` (375), `overviewKvRollups.ts` (532), `capabilityGates.ts`
(128), `notificationAvailability.ts` (30). That number is what section 4c prices
a narrower extraction against.

**Two modules the closure cannot see, because nothing in the layer imports
them.** A closure walks downward, and both of these sit above it:

- `overviewEventLog.ts` (740 lines) is where the contract's values are assembled,
  by gating with `pricedRowsOf` / `ratableRowsOf` and folding the
  `session.tokens` carrier back in. It is in no slice. Without it the extracted
  primitives reproduce the fabricated $0.00 day, which is 4a's second finding
  stated as a line count.
- `sessionReducer.ts` (178 lines, zero D1) folds events into `SessionState`, which
  is what `overviewKvRollups.reduceKvStates` consumes. It matters for section 4d
  rather than for the extraction: it is the reason several fields the parity gate
  calls uncomparable are nothing of the sort.

**So: not unbounded, and that is a real answer rather than a relief.** The bill
is enumerable: 7,492 lines moved, ten modules split rather than three, 1,079
lines opened so declarations can leave them, and a 740-line assembler in no
slice. The three splits the ADR scoped are `tools.ts`, `usage.ts`, and
`outcomes.ts`; the seven it did not are `eventlog/rows.ts`,
`eventlog/rollupStore.ts`, `eventlog/sessionTokens.ts`, `overviewReads.ts`,
`eventlog/store.ts`, `eventlog/developerModel.ts`, and `eventlog/stuckLoop.ts`.
Against a budget of 4,161 lines and three slices. That is the number section 4c
weighs.

### 4c. Decision 2026-08-06: machine-checked parity is the plan of record

Section 4's removal condition assumed one thing that is no longer true: that the
only way to stop the two implementations disagreeing is to stop there being two.
`npm run projection-parity:check` disagreed with that on its first run by finding
a real divergence (section 2). So the extraction's main benefit is partly bought
already, and the decision has to be made against what is left of it rather than
against the whole of it. Three options were priced, not two.

**A. Extract, with 4b's corrected closure.** Costs 7,492 lines moved, ten
splits where three were scoped, 1,079 lines opened so declarations can leave
five D1 modules, a 740-line assembler to scope,
and a rewrite of how the collector consumes any of it: it streams through
`StatementSync.iterate` because `.all()` "would hold every payload in memory at
once, and this database only grows", while the pure layer's API is
`*FromRows(rows: ToolCallRow[])` over a materialized array, and `local_event`
has no `agent` column that `ToolCallRow` requires. Buys the one guarantee parity
cannot: the halves cannot diverge on a field the fixture does not exercise.
Forecloses the streaming decision, and lands on a moving target — the consumer it
would rewrite grew 803 lines in the four days the extraction target did not
change at all.

**B. Keep the duplication and make parity total.** Costs harness work in
`scripts/check-projection-parity.mjs` and a CI wire-up, plus the standing duty to
keep two implementations. Buys most of A's guarantee at a small fraction of A's
cost — section 4d measures how much — and buys it reversibly. Forecloses nothing:
every line of 4b's closure is still there to move later, and the gate is what
makes moving it safe. Its honest ceiling is that parity is only as good as the
fixture, and that pushing it into the SQL-side scans would put a third
implementation of those groupings inside the gate itself.

**C. A narrower extraction of only what is genuinely closed, with the rest
duplicated under the gate.** Section 4 forbids this as the worst option, on the
three-state argument, and that argument was written before a parity gate existed
so it deserved re-testing. Half of it is now bought: "a shared package covering
part of the surface and duplication covering the rest" is no longer unverifiable,
because the gate checks the duplicated half by value. **The other half is
untouched and is now known to be larger than the ADR thought** — fresh collector
code needing a rewrite to consume the shared half is exactly 4b's streaming
finding, and it applies to a partial landing as much as to a whole one. So the
reasoning is half-weakened rather than overturned. What kills C is not the old
reasoning but a new measurement: the genuinely closed subset is 1,065 lines
across four modules (4b), none of them the duplication's bulk, and three of the
four are already the layer's cheapest. Paying the three-state cost to move
`notificationAvailability.ts` is not a trade.

**Decided: B.** The reasons are measurements, in order of weight.

1. **A's benefit is mostly already bought.** The gate compares 7 fields today and
   found a real bug doing it. Section 4d drives seven more to exact agreement
   for about twenty lines of harness and no source change.
2. **A's cost is 1.8× what the ADR budgeted on the move alone, and open-ended on
   the leg the ADR did not budget at all.** 7,492 against 4,161, plus a collector
   rewrite whose scope is 3,051 lines and growing.
3. **The compounding argues for B, not against it.** Section 2's remeasurement
   shows the growth is entirely on the collector side. Every day of deferral adds
   collector code A would have to rewrite; none of it adds worker code A would
   have to move. Deferral makes A more expensive and B no more expensive, which is
   the opposite of how a carrying cost usually reads and is the single fact that
   decided this. **Stated at its weakest, which is where it should be judged**:
   one four-day interval is not a trend, so the honest claim is about direction
   and not magnitude. Even if the local side never grew another line, A's cost
   would be 7,492 lines against 4,161 budgeted, and B's would be a harness.
4. **B forecloses nothing and A forecloses the streaming decision.** B is a
   reversible bet; A is a one-way door taken against a consumer that is still
   being written.

**What this means for section 4.** The removal condition stays named, because
agent-standards section 7 requires temporary duplication to carry one and because
nothing here says the duplication is good. It is no longer the operative
decision: the plan of record is that both implementations are maintained under a
value gate, and the extraction is a standing option to be taken if and when the
carrying cost justifies it. Two things would change that, and they are as
falsifiable as the condition they replace:

1. `DECLARED` in the parity gate stops shrinking while a field the product
   depends on is still in it — meaning the gap section 4d calls "nobody has done
   the work" turns out to be work that cannot be done; or
2. the collector's local projection stops growing, so option A's
   consumer-rewrite leg becomes a fixed cost rather than a moving one, and
   reason 3 above no longer holds.

**Verification gate, unchanged in substance:** `npm run
projection-parity:check` in CI, with `npm run projection-closure:check` beside it
so that the option in 4b stays executable rather than needing re-derivation.
Both landed the same day; section 4e records what they cover and what the first
run caught.

### 4d. Which fields the parity gate cannot compare, and why — measured

The gate compares 7 fields and declares 11 uncomparable. Those 11 are not one
kind of thing, and the difference decides how far option B can go.

**Four are not projections at all.** `generatedAt` is a clock reading;
`rangeDays` and `maxRangeDays` echo the request; `thresholds` is settings.
Comparing them is possible and proves nothing. They are correctly declared and
always will be.

**One is genuinely uncomparable, plus three nested fields.** The collector's own
`LOCAL_OVERVIEW_MANIFEST` is the authority here, and it lists exactly one
top-level honest-empty field, `usageAllowances` — a provider quota reading the
local plane does not hold — plus `notificationAvailability` as absent, and three
nested ones in `LOCAL_OVERVIEW_HONEST_EMPTY_FIELDS`: `outcomes.oneShotRate`,
`tools.agentOutcomes`, and `usage.portfolio.repos[].baseline`. Those are the
floor. No amount of harness work compares a value the local plane declines to
claim.

**The remaining six are declared uncomparable because nobody has done the work,
and in three cases the stated reason is factually wrong.** The manifest lists
`live`, `usage`, `codebase`, `outcomes`, `activity`, and `tools` as MEASURED
locally. Driving the worker's side of the same fixture through the pure layer,
measured 2026-08-06:

| Field | Worker side driven by | Result |
|---|---|---|
| `activity.hourlyDistribution` | `hourlyDistributionFromRows(startRows)` | identical |
| `codebase.files` | `fileHeatFromRows(toolRows, repoContext)` | identical |
| `codebase.directories` | `dirHeatFromRows(toolRows, repoContext)` | identical |
| `codebase.rework` | `fileReworkFromRows(toolRows)` | identical |
| `tools.byAgent` error rates | `errorRateByAgentFromRows(toolRows)` | identical |
| `tools.agentDaily` | `agentDailyFromBuckets(startRows, buckets.calls)` | identical |
| `tools.byTool` | `perToolCountsFromBuckets(buckets.calls)` | identical (already in `COMPARED`; run as a control on the harness) |
| `usage.lines` added/removed | `lineTotalsFromBuckets(buckets.calls)` | identical |

That took about twenty lines of harness — fold the fixture's events to rows,
`foldToolCallRows` them, and supply a `RepoHeatContext` built from each
`session.start`'s `repoId` and `repoLabel` — and no change to either
implementation. So `DECLARED`'s reasons for `activity` ("derive from the KV
rollup grain, not from the pure row layer"), for `codebase` ("the worker builds
from KV buckets the local plane has no counterpart for"), and for the per-agent
half of `tools` ("need the per-agent split's D1-side inputs") are wrong. The KV
rollup grain is a materialization of `foldToolCallRows`, and `sessionReducer.ts`
— 178 lines, zero D1 — is a pure fold of the same events into the `SessionState`
that `reduceKvStates` consumes, so `live` is reachable the same way.

**Where B's ceiling actually is.** `outcomes` is the honest hard case, and not
for the reason declared. `shipRatesByRepo`, `oneShotRatesByRepo`, and
`queryLineSurvival` do their grouping in SQL, not in a `*FromRows` reducer, so a
harness that compares them has to reimplement that grouping in JavaScript — a
third implementation of the same logic, living inside the gate that exists to
catch a second one disagreeing. That is a real cost and it is where B should
stop. The correct declared reason for those is "the worker computes this in
SQL", which is different from and truer than "the local plane has no
counterpart", and it is a reason a later extraction would remove rather than one
that stands forever.

### 4e. Landed 2026-08-06: option B, and what it caught

Section 4d measured what B could reach. This records what it reached. **The gate
compares 18 fields, up from 7, and declares 10 rather than 11.**

Added to `COMPARED`: `codebase.files`, `codebase.directories`, `codebase.rework`,
`usage.lines`, `usage.momentum`, `usage.portfolio`, `outcomes.endReasonsByDay`,
`activity.hourlyDistribution`, `activity.agentHourly`,
`activity.endReasonsByHour`, and `tools.agentDaily`. `activity` left `DECLARED`
entirely: all three of its members are now compared. No source changed to make
any of this possible, which is the point — the work was undone, not impossible.

**It caught a second real divergence on the first run, and this one shipped in
the product.** `usage.portfolio` came back from the local plane in scan order: a
repo with zero commits above a repo with 21 files touched. The worker sorts by
files touched so quiet repos sink, and `MomentumWidgets.tsx` caps the table at
five rows and re-sorts nothing, on exactly those stated grounds. So on a
portfolio of more than five repos the local plane would fill the visible five
with quiet repos and hide the active ones inside the fold. Every VALUE agreed;
only the order did not, which is why the field is compared ORDERED while
`tools.agentModels` beside it is compared as a set — that difference was checked
against each field's consumer rather than assumed. Fixed in `local-projection.ts`
and re-pinned in the collector's own suite, because this gate is private and does
not travel to the open-core repository with the package it guards.

**`DECLARED` now carries a kind, not only a reason.** Four kinds, ranked by how
permanent they are: `not-a-projection` (4 fields), `honest-empty` (1),
`worker-only-input` (1), `not-yet-done` (4). A reason alone turned out to be a
place for a wrong one to hide — three of them said the KV rollup grain has no
local counterpart, and the grain is a materialization of `foldToolCallRows` over
the same rows. The gate now refuses an unclassified declaration and prints the
split on every run, which is what makes section 4c's first reopening condition
observable instead of rhetorical: watch whether `not-yet-done` shrinks.

**Wired into CI.** Both gates ran only under the root `npm test`, which the
workflow does not run — the same wiring defect the types and file-set gates
shipped with, and it meant a value gate that has now caught two real divergences
was proving nothing in CI. `.github/workflows/ci.yml` runs
`projection-parity:test`, `projection-parity:check`, `projection-closure:test`,
and `projection-closure:check` in the `test` job. Not added to the public
workflow: both import the worker, which the public tree does not carry.

**The starvation guard grew with the field count.** Every new comparison rides an
input the fixture must supply — file buckets, `session.end` rows, `git.momentum`
rows — and a fixture edit that starved one would turn those comparisons into
`[] === []` rather than failing. The guard now names all five inputs, and a test
proves it by removing `git.momentum` alone and asserting the refusal.

### 4f. Landed 2026-08-06: member granularity, and whether `not-yet-done` shrank

Section 4c named one reopening condition and section 4e made it observable: watch
whether `not-yet-done` shrinks. This is the first test of it, and the answer is
that the line was measuring the wrong thing.

**The four entries were not four uncompared fields.** `codebase`, `outcomes`,
`usage` and `tools` were each a MIXED BAG, and their own `reason` strings said so.
`codebase` was declared `not-yet-done` because `commitStats` needed a D1 scan —
while `files`, `directories` and `rework` were compared three lines above it and
`filesInPlay` was permanently terminal. So one declaration covered four members in
three different situations, and the word it used about all four was the word for
the worst of them. A count of such entries cannot shrink honestly, because
finishing three members of a field changes it by nothing.

**So the granularity changed.** `DECLARED` is keyed by MEMBER PATH, and
`uncoveredMembers` walks the built snapshot until every leaf is compared or
declared. A declaration about `commitStats` no longer says anything about
`filesInPlay`. An array is a value and not a level, so classifying stops at a row
rather than descending into `usage.projects[3].byTool`.

**The counts, before and after.**

| | 4e (fields) | 4f (members) |
|---|---:|---:|
| compared | 18 | 24 |
| `not-a-projection` | 4 | 4 |
| `honest-empty` | 1 | 3 |
| `worker-only-input` | 1 | 5 |
| `not-yet-done` | 4 | 12 |

**`not-yet-done` reads as 4 → 12 and that is a shrink, not a growth**, which is
worth stating plainly because the number went up. The four field entries covered
twenty-four members whose status nobody had written down. Seven of those members
are now compared, eight are now terminal with a reason of their own, and twelve
are named individually. The unknown went to zero; what is left is enumerated.

**All twelve share ONE blocker, and it is not a wall.** Every one of them is
produced by `reduceKvStates` over the windowed KV `SessionState[]`. That is
reachable: `sessionReducer.ts` is 178 lines of pure fold from the same events into
the same states (4b measured it), so a harness that folds the fixture through it
and hands the result to `reduceKvStates` reaches the worker's real answer without
a third implementation of either. It is one piece of work, not twelve, and it is
the largest single piece of parity left. Its honest limit is recorded with it: the
cron ages quiet sessions in KV with no event behind it, so `outcomes.stuckness`
and the live board's status are NOT reachable this way and are declared
`worker-only-input` separately.

**Two declared reasons were wrong again, in the same direction as last time.**
`outcomes.shipRate` and `outcomes.lineSurvival` were `worker-only-input` because
"the grouping happens in SQL". It does not. `shipRatesByRepo` and
`queryLineSurvival` both run `SELECT payload_json FROM events WHERE kind = ? AND
at >= ?` — a plain row filter — and every determinable/shipped split, every
latest-wins dedup and every fate rollup happens in JavaScript afterwards. A D1
stand-in that serves rows and computes nothing therefore drives the worker's real
functions. `ONE_SHOT_RATE_SQL` is the one that genuinely does select in SQL, via a
correlated self-join, and it is not served — the field it feeds is honest-empty
locally in any case.

**It caught four real divergences, and the local plane was wrong in all four.**
That is the first run in which the worker was not simply right by default; each
call was made from the consumer and the contract, and cited.

1. **`outcomes.lineSurvival` double-counted a superseded check.** `survival.ts`
   re-emits a survival row for the same `(sessionId, rung)` when the attributed
   sha set grows, seeding the deterministic eventId with the sha set precisely so
   the new row lands rather than collapsing on the primary key — and its own
   comment names `(sessionId, rung)` as the reader's dedup key because a reader
   keyed differently means "the session is COUNTED TWICE". The worker dedups
   latest-wins; the local plane summed both. Measured on the fixture: 300 authored
   lines against a true 180, `commitsChecked` 10 against 6 (which can lift a
   rollup over the >=3 floor that should not clear it), and `sessionsRated: 2` for
   one session — against a field whose own contract line reads "Distinct rated
   sessions". The counts on a re-emitted row are the UNION, not the increment, so
   summing is wrong twice over. **Local fixed.**
2. **`usage.costPerEdit` was a cross-tool blend.** The local plane divided
   per-call PLUS session-carrier dollars by an ungated edit count, and read 3x the
   worker's answer on the fixture. `overviewEventLog.ts` gates both legs to
   per-call-priced work and says why in as many words: the denominator cannot see
   a session-costed tool's edits at all, so letting its dollars into the numerator
   is "a cross-tool blend wearing a ratio's face". `capabilityGates.ts` states the
   general rule — counts may read every row, RATES may not. **Local fixed**, and
   the ungated `editCalls` count beside it deliberately left alone, because it is
   a count.
3. **`codebase.commitStats.windowDays` was chosen by directory basename.** The
   local plane read the first row of a list ordered by repo label; the worker
   takes the widest. `GitPanel.tsx` renders this as the span the SUMMED counts
   cover ("N commits touched M files over ..."), and `UsageWidgets.tsx` hangs
   "Commits in git's trailing N-day window" on it. With repos sweeping 14 and 7
   days the local plane labelled the sum "7 days" — and would have said something
   different again if someone renamed the directory. **Local fixed.**
4. **`usage.portfolio.windowDays` had the identical defect**, in a field the gate
   was ALREADY comparing. It survived because the fixture gave every repo the same
   `windowDays`, so the two rules were indistinguishable. `portfolioMomentumFromRows`
   states its own rule as "the window of the GLOBALLY-latest snapshot
   (deterministic, not iteration-order)". **Local fixed.**

The two `windowDays` rules differ from each other — widest for `commitStats`,
globally-latest for `portfolio` — and that inconsistency is the worker's, left
alone here rather than unified: matching the shipped contract is this gate's job,
and changing it is a product decision with its own justification to write.

**The fixture is where two of those four were hiding.** Both `windowDays` bugs and
the survival dedup needed a shape the fixture did not have: repos sweeping
DIFFERENT windows, and a survival check RE-EMITTED for the same rung. Both are
shapes the product genuinely produces. A uniform fixture cannot tell two rules
apart, and `usage.portfolio` proves the cost — it was compared, passing, and
wrong. Every fix is re-pinned in the collector's own suite, because this gate is
private and does not travel to the open-core repository with the package.

**The starvation guard grew from five inputs to nine**, and gained a second guard
beside it. New: prior-window `tool.call` rows and prior-window `session.start`
rows (without them every `delta` member reads `previous: null` on both sides and
the half that moves is untested), `session.delta` rows, `session.linesurvival`
rows, and priced edit calls — which is gated, so an all-Codex fixture would starve
it while the raw `tool.call` count stayed healthy. The second guard refuses a
COMPARED member whose extractor returns `undefined` on both sides, which is what a
renamed member or a typo'd extractor looks like.

**Verdict against section 4c's first reopening condition: NOT met.** The gap was
work nobody had done, not work that cannot be done, and doing part of it moved
seven members and settled four divergences. The condition stands unchanged for the
next pass, now measured at member granularity, and the next pass has one named
target: fold the fixture through `sessionReducer.reduce` into `reduceKvStates`.

### 4g. Landed 2026-08-07: the KV fold, and where the cron stops it

Section 4f named one target and this took it. **The gate compares 32 members, up
from 24, and `not-yet-done` fell from 12 to 1.**

**The fold works, and it is not a second implementation of anything.**
`sessionReducer.reduce` is the same pure function the ingest path runs, so
folding the fixture's four reducible kinds through it and windowing the result by
`lastEventAt` reaches the exact `SessionState[]` `buildOverview` is handed.
`reduceKvStates` then runs for real, fed the real `costBySession`
(`costBySessionFromBuckets` plus the carrier fold, composed as `readCarrierWindow`
composes it) and the real `tokensScan.tokensBySession`. Nothing was restated. The
harness also stopped building its own capability and session→repo maps: it reads
`reduceKvStates`'s own, because the reducer UPGRADES a session whose carrier
proves tokens it once declared impossible, and gating the aggregates on a
different answer than the headline gates on is its own quiet divergence.

**Added to `COMPARED`:** `outcomes.endReasons`, `usage.totals.sessions`,
`usage.totals.toolCalls`, `usage.cost.totalUsd`, `usage.cost.sessionsWithCost`,
`usage.cost.costPartial`, `usage.cacheReuseRatio`, `tools.callStats.totalCalls`.

**Four of the twelve turned out to share the caveat, not the blocker, and are
DECLARED rather than forced.** Section 4f recorded that the cron ages quiet
sessions in KV with no event behind it, and named `outcomes.stuckness` and the
live board. Tracing it further, `sweepIdleStuck` also REAPS a session silent past
`ABANDONED_THRESHOLD_MS` to `"ended"` — its own comment says the reap "drops it
from `live[]`/the in-flight counts". So a fold of events alone leaves every quiet
session `active` forever, while the local plane derives the same ladder from
silence at read time. `outcomes.activeCount`, `outcomes.endedCount`,
`usage.projects` (through `activeSessions`) and `tools.byAgent` (same) all read
that status. They are `worker-only-input` now, under a `CRON_STATUS` reason that
says which write and why no harness reaches it. Two carry a second blocker of
their own: every `usage.projects` row carries `oneShotRate`/`oneShots`/
`oneShotDeterminable` from `ONE_SHOT_RATE_SQL`, the correlated self-join
`rowServingDb` deliberately does not serve; every `tools.byAgent` row carries
`firstSeenAt` from an unwindowed `MIN(at) GROUP BY agent`, an aggregation with no
pure counterpart, so serving it means computing it here rather than mirroring a
fetch.

**The counts.**

| | 4f (members) | 4g (members) |
|---|---:|---:|
| compared | 24 | 32 |
| `not-a-projection` | 4 | 4 |
| `honest-empty` | 3 | 3 |
| `worker-only-input` | 5 | 8 |
| `not-yet-done` | 12 | 1 |

**`not-yet-done` SHRANK, 12 → 1**, and the one left is not one of the twelve.

#### Task 1: the terminal classifications, re-verified — three were wrong

Re-checking the five `worker-only-input` and three `honest-empty` entries against
the code rather than their own prose, as 4f's two corrections required:

- **`codebase.filesInPlay` was misclassified**, `worker-only-input` → `not-yet-done`.
  It was declared to inherit `live`, and it does not: it reads the live board's
  session IDS and never their status, and the board's own silence predicate
  (`< ABANDONED_THRESHOLD_MS`) excludes exactly the sessions the reaper would
  have touched — so membership is the SAME set with or without the cron. What
  blocks it is a fixture with no session inside the live horizon, which makes
  both sides read `null`. Appending `liveFixture()` reaches it, and will likely
  catch a divergence when it does: the worker reads the WINDOWED file grain while
  `filesInPlayFor` scans the session's whole history unbounded.
- **`live`'s reason was wrong in its mechanism**, kind unchanged. It claimed "the
  summary shape is built in `privateQueries.ts` and rebuilding it here is the
  third-implementation trap". There is nothing to rebuild: `overviewWindow.ts`
  maps the states through `sessionToSummary` from `@seorak/types`, which is the
  same function `local-projection.ts` imports. The status is the whole blocker.
- **`tools.agentOutcomesUnusable`'s reason was wrong in the same direction as
  4f's two**, kind unchanged. It said reaching the worker's number "means running
  that attribution here, which is the third-implementation trap". False:
  `agentOutcomesFrom` is a pure function over already-scanned inputs, and driving
  it is exactly what this harness does with `shipRatesByRepo`. Driven, it returns
  **0** against the local plane's **1** — which is the deliberate difference the
  entry's SECOND half describes (with no split, every rated check is one the
  split could not use) and is what actually makes it uncomparable.
- `outcomes.stuckness` and `outcomes.bySession` stand, both now under
  `CRON_STATUS`; the second's reason already named the reaped session correctly.
- All three `honest-empty` entries stand, checked against the built snapshot:
  `usageAllowances` `[]`, `outcomes.oneShotRate` `null`, `tools.agentOutcomes`
  `[]`, each listed in `LOCAL_OVERVIEW_MANIFEST` or
  `LOCAL_OVERVIEW_HONEST_EMPTY_FIELDS`. The nested
  `usage.portfolio.repos[].baseline` reads `null` on both sides, so the compared
  `usage.portfolio` above it is not hiding a claim.

#### Task 3: seven divergences, and the local plane was wrong in all seven

Each call made from the consumer and the contract, and cited. The tally is now
thirteen over three days, with the local plane wrong in every one.

1. **`usage.totals.sessions` counted the wrong set.** The contract is "summed
   over the sessions currently held in KV WITHIN THE WINDOW", and the
   `sessionsDelta` doc beside it says the headline "windows by `lastEventAt`"
   while the delta keeps its own `session.start` legs — the two are deliberately
   different numbers. The local plane counted starts for both. On the fixture: 4
   against 3. **Local fixed**; the delta stays start-counted.
2. **`usage.totals.toolCalls` and `tools.callStats.totalCalls` did too.**
   `ToolsSnapshot` says `totalCalls` is "the only one of these summed from the
   sessions currently held in KV (sum of `toolCallCount` over resident
   sessions)", and `ToolsPanel.tsx` repeats it. The local plane counted in-window
   rows, which is `byTool`'s definition and not this one. 8 against 7.
   **Local fixed**, and `byTool` deliberately left a row count.
3. **`usage.cacheReuseRatio` did too** — "cacheRead / (cacheRead + input) summed
   across the sessions currently held in KV", where a KV state's totals are the
   session's running ones. 0.42598 against 0.42638. **Local fixed**, gated on the
   cache capability with the carrier's presence overriding a stale declaration,
   exactly as `reduceKvStates` does.
4. **`usage.cost.costPartial` was a different fact wearing the same name.** The
   type scopes it to "a session that COULD price its work was excluded from
   `totalUsd`"; the local plane set it whenever any model went unpriced.
   `CostPanel.tsx` settles it: it reads `cost.costPartial === true || byModel.some(m
   => m.tokensTotal > 0 && m.costUsd == null)` — two disjuncts, and folding the
   second into the first makes it dead code. `compilePeriodComparison.ts` reads
   the flag ALONE, with no second disjunct to correct it. **Local fixed.**
5. **`usage.cost.unpricedModels` under-reported the hole.** `UnpricedModel.tokensTotal`
   is "tokens this model burned in the window with no price applied — THE SIZE OF
   THE HOLE", and the local plane summed billable throughput (input + output)
   instead of all four legs, hiding every cache token a price row would have
   charged for. 1,790 against 1,090. **Local fixed** — and `ModelRollup.tokensTotal`
   beside it deliberately left billable, because that one IS throughput.
6. **`tools.byModel` and `tools.agentModels` named a model nobody used.**
   `byModelFromBuckets` drops a model whose four legs are all zero, in as many
   words: "Listing a model that was never actually used is noise, not honesty".
   The local plane listed it at `calls: 1, tokensTotal: 0`. **Local fixed**, in
   both rollups and in the pricing-gap list.
7. **`AgentRollup.firstSeenAt` was windowed.** The contract is explicit that it is
   "the EARLIEST event the log holds for this agent, across the WHOLE log and NOT
   the window", deliberately asymmetric with `lastEventAt`, because it is the
   fact a cross-agent comparison cannot be honest without — "I barely use Codex"
   is the natural misreading of "Seorak barely watched Codex". Windowing it
   reported both tools' records starting at the window edge, which is exactly the
   false symmetry the field exists to break. **Local fixed**, unwindowed.

An eighth was found and is NOT a divergence to fix, recorded so the next pass
does not re-litigate it: **`activity.agentHourly` is now compared as a SET.** The
worker sorts agent-then-hour, the collector hour-then-agent, and no consumer
reads either order — `verdict/history.ts` bins every point into a fixed 24 ×
agents grid, `agentsScope.ts` re-aggregates through a Map and documents itself as
order-independent, and `verdict/clock.ts` iterates `DAYPART_IDS` rather than map
order precisely so a tie does not fall to whichever landed first. Same call, same
check, as `tools.agentModels`.

A ninth is structural and got a documented tolerance rather than a fix. The two
sides price at different GRAINS on purpose: the worker prices a model once from
tokens summed over its rollup buckets, the collector prices each `tool.call` and
sums the dollars. `price(a) + price(b)` and `price(a + b)` are the same number
for a linear price table and are not the same float. `deepEqual` now compares
numbers within 64 ulps relative (~1.4e-14), which is astronomically below any
difference a RULE produces, and `check-projection-parity.test.mjs` pins both
directions.

**Two local defects were fixed that this gate CANNOT check**, because both
members are declared. They are real, they have consumer citations, and they came
free with the resident-session read above:

- **`outcomes.endedCount` counted end RECORDS, not ended sessions.** A session
  reaped for silence was in neither column, so `activeCount + endedCount` was
  less than `usage.totals.sessions` — a partition `chat/engine.ts` renders as one
  sentence ("N sessions in the last D days. X ended, Y still in flight"). It also
  starved `SessionEndReasonsWidget`'s own disclosure, which computes
  `endedCount - Σ reasons` to say how many ended without a recorded reason and
  could never be non-zero.
- The per-repo and per-agent mirrors of every resident leg moved with the global
  one, so `Σ projects[].toolCalls` and `Σ byAgent[].toolCalls` still equal the
  headline. Fixing only the global would have introduced an incoherence the
  worker does not have.

Every fix is re-pinned in `packages/collector/test/local-projection-parity.test.ts`,
because this gate is private and does not travel to the open-core repository with
the package. Two of them needed a case the SHARED fixture cannot hold — the gate
needs a dropped session to exercise `costPartial` at all, and the rule needs a
window with no dropped session to distinguish it — so those live in a
`rules the shared fixture cannot hold both sides of` block that seeds its own
history.

#### The fixture, again, is where the divergences were hiding

Three of the seven were invisible to a fixture in which every session both
started and worked inside the window, the only unpriced model sat beside priced
ones in a session the total still counted, and every model had exactly one priced
call so nothing ever summed. Added, all shapes the product genuinely produces: a
session that STARTS BEFORE the window and works inside it; a session that is
PRICEABLE BUT ENTIRELY UNPRICED; an unpriced model that burned NOTHING; a third
repo; a second end reason with the first now carrying a count above one. The
fixture is also strictly time-ordered now, which it claimed to be and was not —
that alone accounted for two apparent divergences in `codebase.files` and
`outcomes.endReasonsByDay` that were the harness reading rows in an order
production never produces.

**The starvation guard grew from nine inputs to thirteen**, and gained a
different KIND of guard beside it. New: windowed KV sessions, sessions that
STARTED before the window (without one, "resident in the window" and "started in
the window" are the same set and the member that moved this pass cannot be told
from the delta beside it), windowed states carrying an end reason, and a
priceable session the window could not price. The new kind is a FIXTURE
VALIDATION: every event is run through `parseSessionEvent` before either side
sees it, because the local plane parses on the way in and this harness reads raw
payloads, so an event the wire rejects is invisible to one side and visible to
the other. It caught one immediately — a `"model":"<synthetic>"` row added to
exercise the zero-usage drop is not admitted by the schema at all, and the local
plane had been silently dropping the entire `tool.call` that carried it.

**Verdict against section 4c's first reopening condition: NOT met, again, and
more clearly.** `DECLARED`'s `not-yet-done` line went 12 → 1 while the compared
count went 24 → 32. The gap was work nobody had done. What is left is one member
needing a fixture shape, eight that the extraction would remove and no harness
can, and seven permanent entries. The next pass has one named target and it is
small: append `liveFixture()` and compare `codebase.filesInPlay`.

### 4h. Landed 2026-08-07: the last `not-yet-done`, and what the caps were hiding

Section 4g named one target — append `liveFixture()` and compare
`codebase.filesInPlay` — and this took it. **The gate compares 33 members and
`not-yet-done` is EMPTY.** It also found five divergences, three of them in
members the gate was already comparing and passing.

#### Task 1: the terminal classifications, re-verified — three reasons were wrong, one kind was

Eight `worker-only-input` and three `honest-empty` entries, checked against the
code rather than their own prose, on the standing evidence that three
consecutive passes over-declared in the same direction.

**Five held, and the blocker is now measured rather than argued.** The overview's
states come from `listSessions(env.EVENTS_DB)` — the D1 session projection, whose
`state_json` carries whatever `sweepIdleStuck` last wrote. On this fixture
`codex-session` is silent 22 hours and writes no `session.end` (Codex never
does), so a fold of the events reads it `active` while both the cron and the
local plane read it `ended`: `activeCount` 1 against 0, `endedCount` 3 against 4.
`outcomes.stuckness` is stronger still — `sessionReducer.reduce` only ever writes
`"active"` or `"ended"`, so a fold can never produce the `"stuck"` the rate counts.
`live` holds for its own stated reason: the board's MEMBERSHIP is cron-free (the
silence predicate excludes exactly what the reaper touches, and idle/stuck are
both non-ended), but each row CARRIES the status. `usage.projects` holds on a
second blocker that is real — `ONE_SHOT_RATE_BY_REPO_SQL` reads
`session_one_shot_outcomes`, a projection that does the `named_runs` /
`distinct_tools` aggregation in SQL.

**`CRON_STATUS` named the wrong store.** It said the cron writes "onto KV state".
`sweepIdleStuck` persists idle/stuck through `projectScheduledSessionStates` to
D1 ONLY, "without rewriting KV"; only the terminal reap also writes KV, for the
checkpoint TTL. The read path reads D1. The kind is unaffected and the reason is
now accurate about which write it cannot reach.

**`tools.byAgent`'s reason led with a claim of the same wrong kind as 4e's three.**
It said `firstSeenAt` is "an aggregation with no pure counterpart, so serving it
means computing it here rather than mirroring a fetch". `fetchAgentFirstSeen` is
`SELECT agent, MIN(at) FROM events WHERE kind = 'session.start' GROUP BY agent` —
one table, no join, no correlated subquery — and every RULE in it (the NULL-agent
fold to claude-code, the earlier-wins merge) runs in JavaScript afterwards on rows
a stand-in could serve. That is the same mechanical fetch-mirroring `rowServingDb`
already does. Kind unchanged: `activeSessions` on every row inherits the cron
status, and that blocker is enough on its own.

**`tools.agentOutcomesUnusable` was filed under a kind it does not meet, and the
entry's own reason said so.** 4g established that `agentOutcomesFrom` is a pure
function over already-scanned inputs, that driving it here returns 0 against the
local plane's 1, and that the difference is deliberate — and then filed it
`worker-only-input`, whose definition is that the input cannot be reached. It can.
What stops the comparison is that the two numbers are not the same MEASUREMENT:
with no per-agent split, every rated check is one the split could not use, so the
local count is correct given the honest-empty `agentOutcomes` beside it while the
worker's is that function's residue. **A fifth kind, `different-question`**, and
the distinction is load-bearing rather than cosmetic: `worker-only-input` promises
the section 4 extraction removes the entry, and extracting a shared layer would
not change this one by a single count. Only the local plane deciding to claim
`agentOutcomes` would. Not `honest-empty` either — the local plane claims a real
number, and `LOCAL_OVERVIEW_MANIFEST` does not list it. A test now refuses a
`different-question` entry with no honest-empty decision under its parent.

All three `honest-empty` entries hold, checked against the built snapshot and the
manifest: `usageAllowances` `[]`, `outcomes.oneShotRate` `null`,
`tools.agentOutcomes` `[]`.

#### Task 2: `codebase.filesInPlay`, and the divergence its declaration predicted

The declaration was right on both counts. Membership needs no cron, and the
missing piece was a fixture — and appending `liveFixture()` caught exactly the
divergence it forecast: the worker reads the WINDOWED file grain while
`filesInPlayFor` scanned `WHERE session_id = ? AND kind = 'tool.call'` with no
bound at all. **Local fixed.** Every other member of `CodebaseSnapshot` is
window-scoped — the type says so once for all of them ("honest-empty until
IN-WINDOW rows carry the signal") and again per member — so an unbounded scan
listed a file last touched eight days ago under a widget whose empty state reads
"No files in play right now", and inflated `distinctFiles` past what its siblings
on the same panel could account for.

It was invisible until the fixture varied: `live-session` now STARTS BEFORE THE
WINDOW and touches a file there. While every live session both started and worked
inside the window, "the window's grain" and "the session's history" are the same
rows.

#### Task 3: five divergences, and the local plane was wrong in all five

The tally is eighteen, with the local plane wrong in every one. That record is
recorded as a fact and was not used as a prior: each call below is made from the
consumer and the contract, and one of them found the WORKER's own type doc stale.

1. **Every codebase cap was a different number on the two planes.** The local
   constants are 40/40/40/40/40 under a comment reading "Top-N caps mirroring the
   worker's bounded aggregate rows"; the worker's are `FILE_HEAT_LIMIT` 20,
   `DIR_HEAT_LIMIT` 12, `FILE_REWORK_LIMIT` 20, `FILES_IN_PLAY_LIMIT` 50,
   `SESSION_OUTCOME_CAP` 24. **Three of the five sit under members the gate was
   ALREADY comparing and passing**, which is `usage.portfolio`'s failure mode
   exactly: compared, passing, and wrong. They survived because the fixture held
   three files in two directories, under the smaller of every pair. The cap is
   contractual, not a budget — `FilesInPlay.files` is documented as "Hottest-first,
   capped server-side; `distinctFiles` is the uncapped count", `FilesPanel.tsx`
   treemaps the whole array it is handed on the stated grounds that then "every
   touched file is on the map (no cap, no residue)", and `LiveWidgets.tsx` puts
   the rows past its own top-4 into a tail whose label count is real. **Local
   fixed to the worker's five numbers**, which are the shipped contract; whether
   12 directories is the right cap for either plane is a product decision with its
   own justification to write, and is left alone here on the same grounds 4f left
   the two `windowDays` rules alone.
2. **A non-lifecycle event kept a session alive.** `applyBatch` reduces only
   `session.start` / `tool.call` / `session.end` / `session.notification` into
   session state and says why for the clearest case: `git.momentum` "carries a
   session's originating id but is a cumulative per-repo snapshot", so reducing it
   "would bump liveness off a repo metric". The local plane advanced
   `local_session.last_event_at` on EVERY kind. A Codex session that stopped a
   week ago whose cumulative carrier was re-shipped inside the window therefore
   came back into `usage.totals.sessions` and read `active` from
   `statusFromSilence` — the dead-session-shown-as-in-flight hole the reaper
   exists to close, reopened one layer down. **Local fixed**; it moved SIX
   compared members at once (`usage.totals.sessions`, `usage.totals.toolCalls`,
   `usage.cost.totalUsd`, `usage.cost.sessionsWithCost`, `usage.cacheReuseRatio`,
   `tools.callStats.totalCalls`).
3. **The cost HEADLINE and the cost TREND shared one accumulator.** The headline
   is "Σ of the SAME per-session cost that `projects[].costUsd` and
   `byAgent[].costUsd` sum, so the headline EQUALS the per-repo / per-agent tiles
   beside it by construction (every WINDOWED session belongs to exactly one repo +
   agent)"; both legs of `usage.cost.delta` deliberately come from the event log
   instead, "so the % movement compares like with like". One accumulator cannot be
   both, and a carrier row is the one kind that can be in-window for a session that
   is not — so the total carried money belonging to no session
   `usage.totals.sessions` counted, which `CostPanel.tsx` divides one by the other.
   **Local fixed**, split into a resident total and a window total, with
   `dailyTrends` deliberately left on the window leg because it is an event-log
   series like the delta.
4. **`codebase.filesInPlay` scanned the session, not the window** — task 2 above.
5. **`outcomes.bySession` listed end RECORDS, not ended sessions.** This one the
   gate CANNOT check (the member is declared), and it is 4g's `endedCount` fix
   left half-done: `endedCount` moved to the resident partition and `bySession`
   stayed seeded from `session.end`, so a window reported four ended sessions and
   listed three. Codex never writes an end record at all. The worker includes the
   reaped session for a stated reason — they "can carry a real fate, so dropping
   them would silently hide outcome data" — and anchors on `endedAt ?? lastEventAt`
   because a session nobody ended has no end time. **Local fixed**, and this is
   the one place the worker's own doc is the weaker authority: `SessionOutcomeRow.
   endedAt` still says "(the `session.end` time)", a parenthetical that predates
   the reaper and that the shipped worker contradicts three lines of code away.

Every fix is re-pinned in `packages/collector/test/local-projection-parity.test.ts`,
because this gate is private and does not travel to the open-core repository with
the package.

#### The fixture, a fourth time, is where they were hiding

Three of the five needed a shape the fixture did not have, all of them shapes the
product genuinely produces. A LONG-RUNNING live session, in flight since before
the window — without it the file grain and the session scan are the same rows. A
session whose only in-window row is a CUMULATIVE CARRIER — the one kind that can
be inside the window for a session that is not, and the only shape under which
either the liveness rule or the cost-scope rule is visible. And a repo tail past
every cap: 21 files over 13 directories, each edited by two sessions, plus a live
session holding 51 — because a fixture under the smaller of two caps cannot tell
two caps apart. Edit counts are staggered so no row ties AT a cut, which would
test the tie-break instead of the cap.

**The starvation guard grew from thirteen inputs to sixteen**: sessions on the
live board, a live session carrying a PRE-window file row, and a session with an
in-window carrier and no in-window lifecycle row. The parity test's own starvation
cases now build from the full default event set and drop ONE input each — built
from `localHistoryFixture()` alone they would have starved three guards at once
and passed on a refusal they did not provoke.

**The counts.**

| | 4g (members) | 4h (members) |
|---|---:|---:|
| compared | 32 | 33 |
| `not-a-projection` | 4 | 4 |
| `honest-empty` | 3 | 3 |
| `different-question` | — | 1 |
| `worker-only-input` | 8 | 7 |
| `not-yet-done` | 1 | 0 |

**Verdict against section 4c's first reopening condition: NOT met, and the
condition has now run out of room.** It watches whether `not-yet-done` stops
shrinking; the line is empty, so it can never fire again, and a condition that
cannot fire is not an observable. What is left is seven entries the extraction
would remove and no harness can, one the extraction would NOT remove, and seven
permanent ones. **The next pass's first job is to replace that condition**, and
the honest replacement is not a count of declarations but a count of ESCAPES: this
pass found three divergences inside members the gate was already comparing, all
three hidden by a uniform fixture. The number worth watching is how many passes it
takes before a new fixture shape finds nothing.

## Rejected alternatives

**Keep the simplified local dashboard as the Free experience.** Rejected. It
makes Free a different, smaller product than the one the pricing page describes,
and it doubles the surface area where honest-empty, unavailable-surface, and
partial-copy rules have to hold. Two interfaces means the second one is where the
honesty bug ships.

**Run the worker locally so the Free user gets the primary UI.** Rejected. It
requires a closed-source hosted runtime on the user's machine, drags D1, KV, and
Durable Object dependencies into the local path, and reintroduces the exact
"configure and operate a server" step the account-free contract removes. It also
makes the local product's correctness depend on a package the collector is
forbidden to import.

**Extract a shared projection package now.** Rejected for now, not rejected on
principle, and section 4 records exactly what would change that. Two facts
decided it. First, `local-projection.ts` is already complete at 2,248 lines and
51 functions, so a partial extraction would land on top of a finished hand-port
and produce three states instead of two. Second, the clean alternative is the
full extraction: about 4,161 lines plus splitting `tools.ts`, `usage.ts`, and
`outcomes.ts` along their pure/D1 seams, across the worker's suite, while another
workstream is actively editing the worker in this worktree. Not safely
completable now. Doing it later is cheap; doing it half-way is expensive.

The numbers in that paragraph are the 2026-08-02 measurement and are left as
written, because they are the record of why this was decided when it was. The
last clause is the part that did not survive contact: section 4a measured "doing
it later" on 2026-08-06 and it is not cheap, because the 4,161 lines are not a
closed set. The rejection stands; the reason it stands got stronger.

**Rejected for now became rejected as the plan of record later the same day.**
Section 4b put the real number at 7,492 lines plus seven splits plus a 740-line
assembler, and section 4c decided that machine-checked parity buys enough of the
benefit to be the arrangement rather than the stopgap. Still not rejected on
principle: 4c names what would reopen it.

**Extract only the part that is genuinely closed, and leave the rest duplicated
under the parity gate.** Rejected, on a measurement rather than on section 4's
prior reasoning, which was written before the gate existed and half of which the
gate does invalidate. The closed subset is `eventlog/payload.ts`,
`overviewKvRollups.ts`, `capabilityGates.ts`, and `notificationAvailability.ts`:
four modules, 1,065 lines, and not where the duplication is. The three-state cost
is unchanged for a landing that small, because the collector still cannot consume
a `*FromRows(rows[])` API without reversing its streaming decision. Section 4c
prices this in full.

**Hand-port the pure reducers into the collector as the permanent answer.**
Rejected. That is roughly forty reducers re-implemented by hand, after which the
two paths agree on every number by discipline rather than by construction.
CLAUDE.md rule 3 requires honest stats and the settled contract requires Free and
Pro to hold identical capabilities; "two implementations we test for agreement"
is a weaker guarantee than the product needs. The current duplication is the
same shape, which is why it carries a removal condition instead of an
endorsement.

**This is the strongest objection to section 4c and it is not dismissed, it is
narrowed.** 4c does accept two implementations for the foreseeable term, so the
distance between it and this rejected alternative is smaller than either would
like. Two things separate them, and both are load-bearing. First, "test for
agreement" meant something weaker when this was written than it means now: the
only test that existed pinned WHICH fields were measured and never compared a
number, and `f634a2e` is the proof — a fabricated `calls: 2` that survived every
existing test and died on the value gate's first run. Agreement by discipline and
agreement by machine over values are not the same guarantee. Second, the removal
condition still stands and 4c names what reopens it; this alternative asked for
the duplication to be endorsed as permanent, and it still is not. What honestly
remains of the objection: the guarantee is only as wide as the fixture, so "Free
and Pro hold identical capabilities" is proven for the fields in `COMPARED` and
asserted for the rest. Section 4d is the map of that gap and the argument for
closing it rather than living with it.

**Give Free a permanent limited managed allowance so there is one code path.**
Rejected. It puts scheduled hosted work and storage behind every free install,
which is the structural subsidy ADR 001 removed, and it turns a free user into a
metered one.

**Let the owner cell own lifecycle state.** Rejected for the four reasons above.

**Let the client hold entitlement state.** Rejected. Clients cannot grant
themselves Pro; hosted entitlements are server-authoritative with bounded cached
state for offline display and deterministic reconciliation.

## Consequences

The Free path stops needing a server, a login, or a second interface, which is
what makes "no account required" a description rather than an aspiration. The
managed path becomes an addition to a working product instead of a precondition
for one.

The primary UI must now branch on `DataPlaneStatus` everywhere it previously
assumed a reachable worker, including which surfaces exist on the current plane.
A surface that is absent from the plane is unavailable, not empty.

The collector gains the local projection work, and with it the duty to keep
parity with the shared contracts rather than with worker internals.

That duty has a cost, and it is worth naming rather than filing under
"mitigated". Until the section 4 extraction happens, parity between the local
and hosted projections is held by tests, not by there being one implementation,
and `packages/collector/src/local-projection.ts` is the file that has to stay
honest about which fields it populates and which it leaves honest-empty. A field
that the hosted path computes and the local path silently zero-fills would be a
correctness bug that no type checks, because both sides satisfy the same
contract shape. Reviews of that file should ask which fields are measured here,
not only whether it compiles.

**Section 4c makes that cost permanent-until-reopened rather than temporary, so
it has to be paid rather than waited out.** Two implementations under a value
gate is the arrangement, not the interval before the arrangement. What changes in
practice: the review question above is now partly mechanical, because
`npm run projection-parity:check` answers "does this field agree" for every field
in its `COMPARED` list, and a new contract field cannot arrive without landing in
`COMPARED` or in `DECLARED` with a reason. What does not change: a field the
fixture does not exercise is still checked by nobody, and `DECLARED` is where a
wrong reason hides — section 4d found three.

The control plane gains the lifecycle tables, the recovery grant, and the
rebaseline epoch, and therefore gains the duty to prove that a cell outage, a
replayed provider event, or an interrupted deletion cannot roll canonical
authority backward.

Everything above is a target until the managed lifecycle's own acceptance tests
say otherwise. The vocabulary and its refusals are proven today, in
`packages/types/test/data-plane.test.ts`; the runtime paths are being built
against them.
