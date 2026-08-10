# ADR 006: One authority per served value, and what a KV/D1 disagreement means

Status: accepted and implemented. Every rule below is enforced by a check named
beside it; nothing here is aspirational.

Date: 2026-08-07

Settles the roadmap's Track 2 row "Decide what a KV/D1 divergence means for the
overview". Same family as [ADR 003](./003-one-primary-ui-over-a-modular-data-plane.md)
section 4's parity gate — two sources for one number — but the two sources here
live in one service and can therefore be compared at runtime rather than only in
a gate.

## Context

The question was posed as "both stores feed the overview, and nothing says which
wins". The first half of that turned out to be false, and establishing it is most
of this decision.

**Nothing `/overview` returns is served from KV.** `queryOverviewSnapshot` reads
`EVENTS_DB` and nothing else: the session set comes from the D1
`session_state_projection` through `listSessions`, and the T3 aggregates come
from the D1 event log and its rollups. The KV binding is passed down the request
only because it rides on `WorkerEnv`. This is now enforced rather than observed —
`store-authority.test.ts` builds the snapshot twice, the second time through a KV
binding whose every method throws, and the two bodies are identical.

The same is true of `/live` and `/developer-model`, and the comments in
`index.ts` that described those as KV reads were left over from the pre-cutover
shape. They are corrected; a stale comment asserting KV is on the read path is
how the wrong belief regrows.

The worker's whole KV surface is five keys, and only one of them names a fact D1
also holds:

| KV key | D1 counterpart | On a read path the product serves |
|---|---|---|
| `session:<id>` — the reducer checkpoint | `session_state_projection` | the projection, never the checkpoint |
| `live:taps` | none | `/scorecard` only |
| `scorecard:d0` | none | `/scorecard` only |
| owner-cell id | `owner_cell_identity` | neither: disagreement is a 503 |
| chat kill switch | none | not a measurement |

So there is exactly ONE fact in two stores, and the store that holds the copy
nothing reads is KV.

**But the checkpoint is not sealed off from the projection.** `sweepIdleStuck`'s
terminal branch reads both copies of one session and writes to both, because a
reaped session needs its KV retention TTL stamped. That merge was
`{ ...checkpoint, status }`, projected to D1 — so every field except `status`
came from KV, and the guard in front of it compared only `lastEventAt`.

Two things follow, and both were reproduced before being fixed:

- With equal `lastEventAt` and differing content, a checkpoint claiming
  `toolCallCount: 999` and `totalCostUsd: 123.45` was written straight into the
  projection, and `/overview` then served 999 and $123.45. **KV silently won, on
  the one path where a KV value can become a published number.** The upsert
  permits it deliberately: it writes when `last_event_at` is equal and
  `state_json` differs, which is the "equal-time state changes remain visible"
  rule the projection needs for ingest.
- With differing `lastEventAt` the reap was skipped — correctly — but silently
  and unboundedly, while the sweep still RETURNED the session as aged. So the
  intervention engine was told a session had ended while the read model still
  showed it in flight, tick after tick, forever.

The blast radius is wider than the session board. The projection's `SessionState`
backs `usage.totals.sessions`/`toolCalls`, the `usage.cost` headline and its
`sessionsWithCost`/`costPartial` flags, `usage.cacheReuseRatio`, every
`usage.projects[]` member, `outcomes.endReasons`/`activeCount`/`endedCount`/
`stuckness`, `tools.byAgent[]`, and the live board. It also carries each session's
`agent` and `capabilities`, which `reduceKvStates` turns into the capability gate
that decides which EVENT-LOG rows may enter a rate — so a wrong checkpoint could
move `tools.callStats.errorRate` and `tools.verification` too, neither of which
KV has any business touching.

## Decision

### 1. D1 is the sole authority for every value a surface serves

The projection and the event log are the authority. KV holds a reducer working
set and an ambient-surface gate log, and neither is a source for a published
number. There is no field for which "which store wins" is a live question,
because only one store is asked.

Enforced by `store-authority.test.ts`: the snapshot is built through a KV binding
that throws on every operation and must come back identical. A stub that returned
empty would not do — an empty KV lets a read path that consults it keep working
and quietly serve an honest-looking zero, which is the failure this ADR is about.

This also settles the shape of the answer for the three obvious alternatives.
"Prefer the authority and say which it is" has nothing to say: there is no second
reading to disclose. "Show both" and "refuse the field" answer a question the
read path does not ask.

### 2. The one KV→D1 write carries only what D1 cannot hold

`compactProjectionState` strips two keys on the way into a projection row, and
only one of them is genuinely lost. `member` is restored from the `member_id`
column and the `workspace_members` join; `recentEventIds` — the reducer's private
re-ship dedup FIFO — has no column and cannot be reconstructed. Carrying that
FIFO forward is the entire reason the terminal reap reads KV.

So the reap now projects the D1 row's own values with the new status, and takes
`recentEventIds` and nothing else from the checkpoint. The checkpoint rewrite
gets the authority's values too, which converges the two stores rather than
carrying a disagreement into the next reduction.

A divergent checkpoint can no longer move a number the product publishes.

### 3. A disagreement is recorded, and the two arms are recorded differently

Comparison is free here — both copies are already in hand — so refusing to look
would be a choice. `emitInternalError` gains one closed operation label,
`session_checkpoint_divergence`, split by error class:

- **`SessionCheckpointStaleError`** — the checkpoint is BEHIND the projection.
  `applyBatch` writes KV first and D1 second, from one reduced object, so this is
  not a state it can leave durably. It is a stale KV read or a lost checkpoint:
  the first self-heals on the next tick, the second never does, and they are
  indistinguishable at the call site. Recording is what makes the difference
  legible — the same session diverging tick after tick is the one that is not
  coming back.
- **`SessionCheckpointConflictError`** — equal `lastEventAt`, different served
  values. Neither store can be shown stale, so there is no principled winner.
  Rule 1 decides what is served; this says the other store disagreed.

The reap is refused on any `lastEventAt` mismatch, unchanged, because the silence
the reap is derived from is not established when the two stores disagree about
when the session was last seen. What changed is that a refused reap is no longer
returned as aged.

### 4. A checkpoint AHEAD of the projection is an expected race, not a defect

This is the roadmap row's third question answered directly, and the answer is not
uniform. `applyBatch` writes KV before D1, so a cron landing between those two
writes sees a checkpoint ahead of the projection. The session is genuinely not
silent, refusing the reap is the CORRECT answer, and the next tick reads the
newer row. It is bounded, self-healing, and caused by the write order rather than
by a fault, so it is counted in the refusal but not alarmed.

Everything else in section 3 is a defect.

## Rejected alternatives

**Pick one store silently, as the merge already did.** Rejected on
[CLAUDE.md](../../CLAUDE.md) rule 3. The old merge did pick — KV — and the
reproduction above is what picking bought: a published cost of $123.45 with no
measurement behind it. A silent resolution is indistinguishable from a
measurement to every surface downstream, which makes it strictly worse than a
recorded disagreement.

**Show both readings and let the user decide.** Rejected. A stat that renders two
numbers has told the reader the product does not know which is true and handed
them a question they have no way to answer. It is also unreachable under rule 1,
where there is no second reading to show.

**Refuse the field on divergence.** Rejected, but it is the closest call, and it
would be the right answer under a different rule 1. Honest-empty beats a
fabricated number — but it does not beat the AUTHORITY'S number, and here one of
the two copies is authoritative by construction rather than by preference.
Blanking `usage.cost` because a reducer checkpoint disagreed would withhold a
correct measurement to protest a defect in a store the field does not read.

**Compare the two copies on every `/overview` build.** Rejected. It would put a
KV read back on the read path to check a value the read path does not use, buying
a comparison on the hot poll loop and reintroducing exactly the coupling rule 1
removes. The comparison belongs where both copies are already loaded for another
reason, which is the reap, and nowhere else.

**Write the disagreement to a D1 table instead of the log stream.** Rejected as
disproportionate. A durable table needs a migration, a retention policy, and a
pruning path, and its readership is one operator asking whether this ever fires.
The observability line is queryable, content-free by construction, and already
the mechanism every other contained internal fault uses.

## Consequences

**The projection cutover already made this decision; it was never written down.**
Session-set reads stopped enumerating KV when the partial live index landed, and
the read path has been single-authority since. What was missing was the rule, so
nothing prevented the next reader from adding a KV lookup to `/overview`, and
nothing noticed that the reap had quietly kept a KV→D1 channel open. The check is
the durable half of this ADR; the prose is the reason it exists.

**`sweepIdleStuck` and `runScheduledSweeps` take an optional observability env.**
Optional in the pattern `readOverviewVersion` established: omitted, a divergence
still emits and names its mode `unknown`, because a record that can be silenced
by a missing argument is not a record.

**Two tests changed meaning rather than breaking.** `sweeps.test.ts` asserted
that an equal-time checkpoint's counter was written through to D1 — the old
behaviour, stated as a requirement, justified by a concurrent ingest that cannot
produce that state. It now asserts the authority is projected and the FIFO
survives. The `sessions-characterization.json` diff is one key's position in a
serialized checkpoint, values unchanged, which is the whole behavioural footprint
outside the reap.

**The parity gate's `CRON_STATUS` reason is corrected, not removed.** Its
substance stands: the cron writes a session status no event implies, so the two
projection implementations cannot be driven to one answer from one event stream.
Its description of WHERE that status is written was stale — idle and stuck go to
D1 only, and the terminal reap is the sole KV write.

**KV's remaining keys are unaudited by this ADR, deliberately.** `live:taps` is a
read-modify-write on a single value and can lose a concurrent tap; that is a
KV-internal integrity question for the scorecard's own gate, not a divergence
between stores, and it is not decided here.
