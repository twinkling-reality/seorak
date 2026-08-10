# ADR 004: Per-cell archive storage and live-sync namespace

Status: accepted for implementation. No customer owner cell has been provisioned,
so nothing here is a claim that managed hosting is operating. Activation remains
gated by [ADR 001](./001-local-first-compact-sync.md) and by the managed
service's own rollout order.

Date: 2026-08-02

Builds on [ADR 003](./003-one-primary-ui-over-a-modular-data-plane.md), which put
lifecycle authority in the control plane and made the owner cell the thing that
lifecycle acts on. This ADR settles what a cell is made of.

## Context

A paying customer's cell did not contain the thing Pro sells.

`scripts/provision-owner-cell.mjs` created two Cloudflare resources per customer:
a KV namespace and a D1 database. `wrangler.toml` declared no `[[r2_buckets]]`
and no `LIVE_SYNC` Durable Object binding, and `renderOwnerCellConfig` rewrites
values through `replaceRequired`, which throws when its anchor is missing. There
was no anchor for a table the template did not contain, so the renderer could not
have added either binding even if someone had asked it to.

`LiveSyncState` has been exported from `src/index.ts` since compact sync landed.
The class existed; nothing ever bound it.

The consequence was specific rather than theoretical. A customer pairs the
collector, the first session emits a live transition,
`compactSync.ts` resolves `transitions: null`, `acceptCompactSyncBatch` throws
`sync_unavailable`, the worker answers `503`, and
`collector/src/compact-sync.ts` classifies that `retriable: true` and retries a
permanent failure forever. The 402 entitlement gate protects Free cells, so only
the paying cell reaches this path. The published 2 GB/month, 20 GB retained
allowance had no bucket to store a byte in.

Three further defects were found while fixing it, and each one is a case of the
same shape: a list of what a cell contains, written down twice.

- `assertActiveVersion` allowlisted `ACTIVITY_SCHEDULER` alone, while every
  rendered config also bound `PUBLICATION_SCHEDULER`. `verifyLiveOwnerCell` gates
  both export and deprovision, so both refused to run against a real cell.
- `validDescriptor` in `owner-cell-lifecycle.mjs` pinned an eight-key descriptor
  while `parseOwnerCellDescriptor` had returned eleven keys since `0efd092`.
  `emptyDeprovisionState` therefore rejected every real descriptor with
  "owner-cell descriptor is invalid". Owner-cell deprovision was completely
  offline, and the test suite stayed green because its fixture was hand-written.
- The owner-cell provisioning path kept no journal at all. A process that died
  between `wrangler d1 create` and writing the config orphaned a KV namespace and
  a D1 database with no record, and the next run created a second pair.

## Decision

### 1. One R2 bucket per owner cell

Each product cell provisions `srk-<cellId>-archives` and binds it as
`SYNC_ARCHIVES`.

**The deciding argument is that a Cloudflare R2 binding grants a Worker access to
the whole bucket.** There is no prefix-scoped binding. "One bucket with
owner-scoped keys and per-cell credentials" is not available at the binding
layer: a Worker binding carries no token to scope. A shared bucket therefore
means every customer's Worker can read every other customer's archives, which is
the exact isolation `entitlements.ts` relies on when it explains why data rows
carry no owner id — "its Worker, D1, KV, caches, queues, rate limits, and
credentials are not shared with another owner."

Object keys stay owner-scoped anyway (`owners/<id>/archives/<id>.bin`). That is
now redundant with the bucket boundary and is kept deliberately: the D1 archive
pointer stores the key, so changing the layout later would be a data migration
rather than a code change, and defense in depth costs nothing here.

The short `srk-` prefix is not cosmetic. An R2 bucket name is capped at 63
characters and a cell id may be 48, so `seorak-<cellId>-archives` can overflow at
64 while `srk-` cannot. The Worker already uses the short prefix.

### 2. `LIVE_SYNC` is bound in the template, not left to an operator step

`LIVE_SYNC` needs no provisioned resource, only a `[[durable_objects.bindings]]`
entry plus an `[exports.LiveSyncState]` block, mirroring how `ACTIVITY_SCHEDULER`
and `PUBLICATION_SCHEDULER` are declared. It is committed at top level and under
`env.staging`, because Wrangler inherits neither into a named environment.

### 3. Every list of what a cell contains has exactly one definition

`owner-cell-config.mjs` now exports `OWNER_CELL_DESCRIPTOR_KEYS` and
`OWNER_DURABLE_OBJECT_BINDINGS`, and `owner-cell-lifecycle.mjs` reads both rather
than restating them. The lifecycle test derives its descriptor and its binding
fixture from the committed `wrangler.toml` instead of hand-writing them.

This is the actual root cause of three of the four defects above, and it is the
part of this ADR most worth keeping. A duplicated allowlist does not fail when it
drifts; it silently stops protecting anything, and a hand-written test fixture
drifts in exactly the same direction at the same time.

### 4. Provisioning journals intent before every create

The owner-cell path adopts `ensureProvisionResource`, the intent-journal already
used by the dogfood installer: journal intent, create, and on resume adopt
exactly one same-named orphan, refusing a duplicate create when the prior attempt
is invisible or ambiguous. The journal is bound to one Cloudflare account, one
cell id, and one plan, at mode 0600 under ignored `.wrangler` state.

A bucket that already exists **without** this transaction's intent stops
provisioning rather than being adopted, because adopting it would write a second
owner's ciphertext into somebody else's storage.

### 5. Deletion removes archives first, and never enumerates objects

The deprovision journal gains `r2DeleteIntentAt` / `r2DeletedAt` at schema 3, and
the ordering invariant refuses a D1 delete intent before the bucket is gone:
archives before the pointers that name them, matching `runManagedHostedDeletion`
inside the cell.

The script does not enumerate or force-delete objects. A bucket that still holds
ciphertext fails with the count in the message and directs the operator to the
managed hosted deletion. The one sanctioned object-deletion path is the resumable
in-worker one the managed data-lifecycle contract specifies, and a second model
in a shell script would have its own ordering rules and its own bugs.

### 6. The operator export names the archives it does not contain

The export manifest moves to schema 2 and records `r2BucketName` plus an explicit
`archives: { bucketName, included: false, reason: "customer-recovery-export" }`.

Archive ciphertext reaches the published 20 GB retained allowance per home, and
the artifact that carries it is the customer recovery export the managed
lifecycle contract defines, served by the cell with a separately authorized
grant. Recording the bucket
rather than omitting it is honest-empty applied to a manifest: a bundle that said
nothing about archives would read as a complete copy of the cell.

## Rejected alternatives

**One shared bucket with owner-scoped keys and per-cell credentials.** Rejected
on the binding layer, not on preference: R2 Worker bindings are whole-bucket and
carry no scoping token, so "per-cell credentials" cannot be expressed for a
binding at all. Reaching a shared bucket through the S3 API with scoped tokens
would replace a binding with a credential the cell would have to hold, store, and
rotate, which is strictly more attack surface for strictly less isolation.

**Add `[[r2_buckets]]` to the template and stop there.** Rejected. The renderer
copies unmatched tables verbatim, so a template bucket name would be identical
across every customer cell, which is the shared-bucket failure with none of its
supposed simplicity. It would also have been invisible to
`parseOwnerCellDescriptor`, so export would omit the archives and deprovision
would delete Worker, D1, and KV while leaving the customer's ciphertext in the
account forever.

**Leave `SYNC_ARCHIVES` and `LIVE_SYNC` as operator steps outside the repository,
as `env.ts` previously described.** Rejected. Managed sync is what Pro sells. An
unperformed operator step is indistinguishable from a broken product to the
person who paid, and `/health` reported such a cell as ready.

**Have deprovision empty the bucket itself.** Rejected; see decision 5.

## Consequences

**The per-customer Cloudflare object count is three named resources plus three
Durable Object namespaces plus a Worker service.** The binding ceiling is
unchanged: Cloudflare documents a 500-Worker Paid-account limit, and the Worker
is still the scarcest object per home. This repository documents no per-account R2 bucket
limit and this ADR does not invent one; anyone approaching the Worker ceiling
must look it up and record it, because the bucket count will be in the same order
of magnitude as the Worker count.

**R2's included allowance is not multiplied by having more buckets.** The
per-bucket cost of the topology is one bucket-creation operation per customer
lifetime, which is negligible against the modeled budget. Storage and operation
costs are driven by archive volume, which the published allowance already bounds
and `scripts/hosted-cost-model.test.mjs` already asserts.

**An owner-cell config generated before this change no longer parses.**
`parseOwnerCellDescriptor` requires the bucket, so export and deprovision refuse
such a config with "owner cell config must bind exactly one R2 bucket". That is
the correct refusal: a cell with no archive bucket cannot serve managed sync, and
inventing a bucket name for it would be the script asserting a resource it never
saw. No customer cell has been provisioned, so no such config is in use.

**A worker deployed before this change needs its bucket created once**, by hand,
before its next deploy. That is an operator step against a specific deployment
rather than a property of the design, so it lives with the provisioning runbook
and not here.

**The compact-sync runbook's gate A says "one R2 archive bucket", singular.**
That sentence describes the staging rehearsal it gates, where there is one cell
and therefore one bucket, and it predates the owner-cell topology. It is not
overturned by this ADR, but an operator reading it for the production topology
should read this document instead.
