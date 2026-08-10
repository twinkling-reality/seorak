# ADR 001: Local-first history and compact hosted sync

Status: accepted for implementation on `codex/local-first-pro`; production activation remains gated.

Date: 2026-08-01

## Context

Seorak's legacy hosted path writes raw agent activity into D1. One clean dogfood hour projected to 5,853,048 D1 rows written over 31 days. A blunt 1,000-cell extrapolation costs at least $6,106.60 per month in D1 and is not a credible Free product.

The user's raw record is also most useful on the machine that captured it. Local work must remain complete when a subscription, provider, network, or hosted deployment is unavailable.

## Decision

SQLite at `SEORAK_DIR/history.sqlite` is the permanent raw authority. A local event is committed there before the compatibility JSONL append can succeed. The collector derives local session, hour, transition, report, replay, dashboard, and export views from that database.

Managed sync uses the public compact-sync v1 protocol:

```text
raw agent events
  -> permanent local SQLite
     -> compact session and hour projections -> D1
     -> meaningful live transitions -> Durable Object
     -> coarse gzip plus AES-256-GCM archive chunks -> R2
```

The wire request has no owner, account, member, workspace, or plan selector. The worker derives the owner from authenticated cell authority. Every new hosted row and R2 key is owner-scoped anyway, so a later shared-cell topology cannot inherit ambiguous data.

Install sequence numbers and a previous-batch hash form an append chain. The exact pending batch, including nonce and ciphertext, is persisted before upload. A matching receipt advances local projection checkpoints and activates compact v1 atomically. A retry sends identical bytes.

The existing `/events` route remains a compatibility endpoint for collectors that have not seen compact-sync health. Once one compact receipt activates v1 on an installation, raw hosted fallback is forbidden. Local capture continues through every hosted failure.

## Entitlements

`@seorak/types` owns the canonical Free, Pro, and Teams capability matrix. Local capabilities are always true. Hosted grants are server-issued, expire within 24 hours, and fail closed after expiry without affecting capture or local reads.

Free performs no managed upload. Pro gates managed jobs, not truthful local statistics. Abuse protection uses `429`; entitlement refusal uses `402`; a missing or unsafe provider resource uses `503` or another declared operational refusal.

## Encryption and recovery

Archive payloads are gzip-compressed and AES-256-GCM encrypted on the collector. The archive key is a 32-byte mode-0600 local file and never enters D1, R2, logs, or the protocol. R2 stores ciphertext only, and D1 stores its digest, nonce, key version, sequence range, count, and object pointer.

This implementation proves encrypted backup storage but does not yet claim end-to-end multi-device archive recovery. A reviewed device-to-device key envelope or user recovery key is required before marketing that claim. Compact metadata still supports remote state continuity independently of archive decryption.

## Conflict and clock policy

Each installation has its own hash chain. Per-stream and per-hour revisions are monotonic. Equal revisions from different installations use the immutable batch hash as a deterministic tie break, independent of arrival order.

The worker verifies the submitted batch digest, then bounds future projection timestamps to the one server receipt instant. It never rewrites the opaque archive. Late offline history remains valid.

## Open-core boundary

Open and publish-safe:

- collector capture and permanent local storage;
- local projections, dashboard, replay, reports, export, and migrations;
- entitlement and compact-sync schemas, limits, parsing, and route builders; and
- storage adapter interfaces that permit a future community or BYOC service.

Hosted and operated by Seorak:

- identity and cell provisioning;
- billing, provider verification, fraud and abuse controls;
- D1, R2, and Durable Object orchestration;
- APNs relay and managed intervention delivery;
- recovery operations; and
- team administration and audit.

Public packages never import hosted implementation code. Self-hosting can implement the public protocol, but it does not include Seorak-managed APNs or Seorak's Apple signing identity.

## Rejected alternatives

Continuing per-event D1 ingest fails the measured economics. Limiting Free local history manufactures scarcity and makes statistics less truthful. One R2 object per event replaces one expensive write pattern with another. Indefinite dual-write keeps the old cost alive. Silent tenant collapse violates authorization, lifecycle, and cost isolation.

Creating a new local-core package was deferred. The implementation stays inside the already publishable collector so it does not expand package publication or repository extraction scope before approval.

## Consequences

Raw event volume no longer appears in the hosted D1 write equation. Account-free local users have no scheduled hosted work. A configured Free collector refreshes its bounded entitlement lease at most twice per day but performs no managed write, alarm, archive, or push work. The local database grows with complete history and therefore requires explicit user-owned export and purge behavior. Hosted activation requires approved additive migrations, an R2 bucket and binding, a Durable Object binding and migration, deploys, and measured cohort evidence.

The exact rollout and rollback order, and the economics and safety budgets behind it, are operational records of the managed service and are held by whoever runs it.
