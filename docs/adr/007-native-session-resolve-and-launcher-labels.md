# ADR 007: Resolving a known session by its native identity, and launcher labels

- **Status:** accepted; implemented in the collector's loopback and self-hosted
  planes and in the owner cell's code. The owner cell's copy is not deployed:
  it needs D1 migration 0039 and owner approval for the hosted rollout.
  Launcher labels are recorded by the collector only (section 3).
- **Date:** 2026-09-26
- **Amends:** [ADR 002](./002-private-api-mcp-and-public-projection.md)
  section 3, whose private MCP catalog grows from four tools to five. Section 1's
  rule that internal identifiers never leave the boundary is kept, and this ADR
  explains why a resolve does not break it.

## Context

A program that launches coding agents on the developer's behalf (an editor, a
task runner, a spatial or remote front end) already knows every session it
started. It picked the Claude Code `session_id` itself with `--session-id`, or
read it from the stream's `system/init` message, or read the Codex thread id from
the stream or app-server. What it cannot do is find that session's Seorak record.
Integration API v1 exposes only opaque `ses_` references (ADR 002 section 1), so
the only way in is to page every session and guess which one matches by start
time and project. A guess is a fabricated join, which the honesty rule forbids.

Two more gaps sit beside the join:

- A launched session looks like any other session. `SEORAK_CAPTURE=0` exists,
  but it answers a different question: it is for programs whose agents are not
  development work at all, and it discards them. A program whose agents ARE the
  developer's work had no way to say "this one was mine" and keep the record.
- Codex has no per-process switch. Its sessions are read by the daemon from
  rollout files, and the daemon inherits nothing from the process that started
  the agent.

## Decision

### 1. One new read: resolve a native identity to a sessionRef

A caller that already holds a session's native identity, meaning the agent kind
plus the agent's own session id, can ask for that session's content-free summary.

| | |
|---|---|
| HTTP | `POST /api/v1/sessions/resolve`, body `{"agent": "claude-code" \| "codex", "nativeSessionId": "<id>"}` |
| MCP | `resolve_session` with the same two arguments |
| Scope | `sessions:read` |
| Route class | `read`, the class a session page uses |
| Response | `PrivateSessionDto`: the v1 envelope plus `session`, a `PrivateSessionSummaryDto` or null |

An example, with illustrative values:

```http
POST /api/v1/sessions/resolve
Authorization: Bearer srkx_...
Content-Type: application/json

{"agent": "claude-code", "nativeSessionId": "0f7c1a52-3b9e-4d1a-9f2e-6c0b8d4e1a27"}
```

```json
{
  "apiVersion": "v1",
  "availability": { "state": "available", "reason": null },
  "coverage": {
    "requested": { "from": "2026-06-28", "through": "2026-09-26" },
    "observed": { "from": "2026-09-26", "through": "2026-09-26" },
    "matchedSessionCount": 1,
    "includedSessionCount": 1,
    "complete": true,
    "omissions": []
  },
  "freshness": {
    "state": "fresh",
    "generatedAt": "2026-09-26T18:00:00.000Z",
    "dataThrough": "2026-09-26T17:58:12.000Z",
    "staleAt": "2026-09-26T18:05:00.000Z"
  },
  "session": {
    "sessionRef": "ses_6b1f0c2d9e8a47f3b5c4d2e1f0a9b8c7",
    "projectRef": "prj_0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    "agent": "claude-code",
    "status": "active",
    "startedAt": "2026-09-26T17:40:03.000Z",
    "endedAt": null,
    "elapsedSeconds": 1089,
    "toolCallCount": 42,
    "promptCount": null,
    "costUsd": 1.37,
    "launcher": "my-launcher"
  }
}
```

A miss is the same envelope with `"availability": {"state": "unavailable",
"reason": "not-captured"}`, zero matched and included sessions, `"complete":
false`, and `"session": null`.

A hit returns exactly the summary a session page shows for that session,
including its `sessionRef` and `projectRef`, and every other v1 read then works
from the ref. The ref is minted on read if no page has shown the session yet,
which is the same `INSERT OR IGNORE` a page runs.

The rules:

- **Both halves must match.** A native id recorded under another agent is not a
  hit. Today the session key is the agent's own id, so this is one indexed read
  plus an agent comparison.
- **A miss is `unavailable: not-captured`, with a null session.** The authority
  holds no session under that identity and cannot say why: the agent has not
  reached a hook yet, the launching program switched capture off, the rollout is
  outside the directory the daemon tails, or the id never was a session here. A
  caller that launched the session a moment ago retries; `freshness` says how
  current the answer is.
- **Restrictions refuse exactly as they do for a sessionRef read.** The project
  and date checks are one shared function in each authority, so a session outside
  a credential's project, or straddling its date window, answers
  `outside-credential-restriction`. That discloses no more than a sessionRef read
  already does, and it discloses it only to a caller that already holds the id.
- **The native id goes nowhere.** It is never echoed in a response, never stored,
  never written into a reference, and never audited. Both audits record the closed
  operation `resolve_session` and nothing about the request.
- **POST, not GET.** The id travels in a body bounded at 1 KiB, never in a URL,
  so it cannot land in an access log, a proxy log, or browser history. Refusals
  are ordered and distinct: 413 for an oversized body, 415 for a media type other
  than `application/json`, 400 for any shape other than exactly those two keys.

**Why this keeps ADR 002's reasons intact.** ADR 002 kept internal identifiers off
the external contract for two reasons: an identifier in a response becomes an
irreversible contract, and a list of identifiers hands them to every holder of a
credential. Resolve is one-way. The native id is an input only; no response lists
or returns one, so nothing about how Seorak keys its storage becomes a contract,
and a credential holder learns no identifier it did not already have. The
`sessionRef` stays the only handle. If Seorak ever keys sessions by something
other than the agent's id, resolve keeps working through a mapping, because the
contract names the agent's identity and not a Seorak key.

**Why `sessions:read` and not a new scope.** A `sessions:read` holder can already
page every summary its restrictions allow. Resolve returns one of those same
summaries, under the same restrictions, and adds only the join the caller brings
with it. A separate scope would buy a credential that can resolve but not list,
and no consumer has asked for one. It would also widen the scope CHECK in two
databases and the MCP OAuth metadata. If a resolve-only credential is ever needed,
it is additive to issue later.

### 2. v1 stays v1

Every change is additive: one route, one MCP tool, one nullable field on
`PrivateSessionSummaryDto` (section 3). Every v1 guarantee holds on the new read:
null means unknown, availability, coverage, and freshness ride on every
response including a miss, the per-credential and per-route-class budgets apply,
and nothing captured is returned. Clients must ignore response keys they do not
know, which is what lets v1 grow a field without a v2.

What else a v1 client may rely on, stated here because the types alone do not
say it:

- **Closed unions may grow.** v1 may add a value to `availability.reason`,
  `coverage.omissions`, `endReason`, a lens `unit`, or `fate`. It never removes
  a value or changes what one means. A client treats an unknown reason as
  "unavailable for a reason I cannot name", an unknown omission as "coverage is
  incomplete", and an unknown `endReason` or `fate` as unknown; it does not
  reject the response.
- **Available means non-null.** When `availability.state` is `available` or
  `partial`, the payload (`session`, `outcome`, `result`) is non-null. Only
  `unavailable` carries a null payload. `partial` means the credential's own
  restriction bounded the answer, and `coverage.omissions` says how.
- **A resolve miss** is always `unavailable` with reason `not-captured` or
  `outside-credential-restriction`, `coverage.observed` null,
  `freshness.dataThrough` null, and both session counts zero.
- **Status codes.** 401 with `WWW-Authenticate: Bearer error="invalid_token"`
  for every credential failure: missing, malformed, unknown, expired, revoked,
  or issued for another audience. 403 with `error="insufficient_scope"` and the
  required `scope` named in the header, only when the credential is valid but
  not permitted: it lacks the scope, or (on an owner cell) its own project or
  date restriction refuses the request. 429 always carries `Retry-After` in
  whole seconds. The JSON error bodies are for people; branch on the status and
  the header.
- **Scopes.** The same on HTTP and MCP: `period:read` for the period summary;
  `sessions:read` for the session page, resolve, and outcome; `replay:read` for
  every lens.
- **Budget.** A credential gets 60 requests per minute with a burst of 60, on
  top of a per-route-class ceiling shared by every credential on the plane.
- **Lenses do not page in v1.** A session lens returns every row in one
  response and `nextCursor` is always null.
- **The verification lens.** One row per verification kind that was measured,
  labelled `test`, `build`, `typecheck`, or `lint` (or `Verification` for a run
  with no kind), each carrying the metrics `runs` and `passed` (unit `count`)
  and `passRate` (unit `percent`, but the value is a fraction from 0 to 1, or
  null when nothing ran). No rows means nothing was measured, and `emptyReason`
  says so. It is measured for Claude Code only.

An outcome and a verification lens for the same session, with illustrative
values:

```json
{
  "apiVersion": "v1",
  "availability": { "state": "available", "reason": null },
  "coverage": {
    "requested": { "from": "2026-06-28", "through": "2026-09-26" },
    "observed": { "from": "2026-09-26", "through": "2026-09-26" },
    "matchedSessionCount": 1,
    "includedSessionCount": 1,
    "complete": true,
    "omissions": []
  },
  "freshness": {
    "state": "fresh",
    "generatedAt": "2026-09-26T18:00:00.000Z",
    "dataThrough": "2026-09-26T17:58:12.000Z",
    "staleAt": "2026-09-26T18:05:00.000Z"
  },
  "sessionRef": "ses_6b1f0c2d9e8a47f3b5c4d2e1f0a9b8c7",
  "outcome": {
    "commitsLanded": 1,
    "uncommitted": { "filesTouched": 2, "linesAdded": 40, "linesRemoved": 6, "generatedLinesExcluded": 0 },
    "lineSurvival": null,
    "errorCount": 3,
    "firstErrorAt": "2026-09-26T17:44:10.000Z",
    "endReason": null
  }
}
```

```json
{
  "apiVersion": "v1",
  "availability": { "state": "available", "reason": null },
  "coverage": { "...": "as above" },
  "freshness": { "...": "as above" },
  "result": {
    "lens": "verification",
    "level": "session",
    "target": { "kind": "session", "sessionRef": "ses_6b1f0c2d9e8a47f3b5c4d2e1f0a9b8c7" },
    "headline": "Captured verification evidence",
    "rows": [
      {
        "label": "test",
        "metrics": [
          { "key": "runs", "label": "Measured runs", "value": 4, "unit": "count" },
          { "key": "passed", "label": "Passed runs", "value": 3, "unit": "count" },
          { "key": "passRate", "label": "Pass rate", "value": 0.75, "unit": "percent" }
        ]
      }
    ],
    "emptyReason": null,
    "loadedSessionCount": 1,
    "momentCount": 57,
    "nextCursor": null
  }
}
```

`lineSurvival` is null, or reports fate `unknown`, until the session's lines are
three days old, and `endReason` is null while the session is active or when its
end was not captured.

### 3. Launcher labels: attribution, not exclusion

A program that launches agents on the developer's behalf sets
`SEORAK_LAUNCHER=<label>` in the environment of each agent it starts. The Claude
Code SessionStart hook inherits that environment, reads the label, and records it
beside the session.

- **Shape.** Lowercased, then a letter or digit followed by up to 63 of
  `a-z 0-9 . _ -`. Anything else records no label; the session is still captured.
  A rewritten label would be an invented one, and an unlabeled session is
  honestly unknown.
- **A label, never content.** It names the launcher. It is not a prompt, a path,
  or a free-text note, and the shape rule keeps it from becoming one.
- **First label wins.** A resume under another program does not relabel a session.
- **`SEORAK_CAPTURE=0` still wins.** A session that is not captured has no label.
- **Where it lives.** A collector-local table beside the history, not a field on
  `session.start`. The owner cell's ingest parser is strict and would reject an
  unknown key, so putting the label on an event is an event-protocol change with
  its own release order (see
  [event ingest compatibility](../reference/event-ingest-compatibility.md)), and
  it would block delivery from any collector ahead of its worker. A local table is
  also honest about loss: a history rebuilt from `events.jsonl` comes back
  unlabeled, which reads as null, never as a wrong label.
- **How it is exposed.** `launcher: string | null` on every
  `PrivateSessionSummaryDto`, from a session page and from resolve. Null means no
  label was recorded, which is not the same as "a person started this": a program
  that declares nothing is indistinguishable from a person. The owner cell answers
  null for every session until the event protocol carries labels.

**How labeled sessions are treated.** Exactly like every other session, in every
count, total, and stat. A launched session is real agent work on the developer's
behalf and real spend, so leaving it out would understate a measurement, which
the honesty rule forbids. The label is attribution: it lets an integration show
which sessions a program started and lets the owner tell them apart. A filter or
breakdown on the owner's own surfaces is a later, separate decision (section 5).

### 4. Codex: what rollouts record, and why no label is read from them yet

Codex has no per-process capture switch, and the daemon that tails rollouts
inherits no environment from the agent. Every rollout's first `session_meta`
record carries `originator` (the client that started the thread) and `source`.
Measured on one machine on 2026-09-26, across 365 rollouts:

| originator | source |
|---|---|
| `codex_work_desktop` | `vscode`, or a subagent object |
| `Codex Desktop` | `vscode`, `exec`, or a subagent object |
| `codex_exec` | `exec` |
| `codex_cli_rs` | `cli` |
| `codex-tui` | `cli` |

So `originator` is usable as a client name: each client that starts a thread
reports its own, and the Codex binary (0.151.0) honors an override variable,
`CODEX_INTERNAL_ORIGINATOR_OVERRIDE`. A source reading suggested the app-server
turns a client's `initialize` `clientInfo.name` into the originator, but a runtime
check on an isolated Codex 0.151.0 did not confirm it: app-server threads reported
source `vscode` whatever name the client sent, the name appeared only in the user
agent, and no rollout exists before a thread's first turn, so the originator of an
app-server thread was not observed at all. Treat that path as unconfirmed. It is
not read as a launcher label yet, for three reasons:

1. Every Codex client sets one, including Codex's own. Treating "not first-party"
   as "launched by a program" needs a list of first-party values, and that list
   already changed within one month of this measurement. A new first-party client
   would be silently mislabeled as a launcher.
2. The exec-side override is an internal environment variable of Codex, not a
   documented contract.
3. A launcher that gives Codex its own `CODEX_HOME` writes rollouts outside the
   directory the daemon tails, so Seorak does not see those sessions at all and
   nothing can be labeled or resolved. A launcher that wants Seorak's measurements
   for Codex must leave `CODEX_HOME` at the developer's default, or the owner must
   point `SEORAK_CODEX_DIR` at the launcher's.

The honest design, deferred until a launcher actually needs it, is an
owner-declared list: the owner names the originators that count as launchers, and
the daemon records those as labels. The owner opts in; nothing is inferred.

### 5. Deferred

- **Labels on the event protocol.** Carrying `launcher` on `session.start` to the
  owner cell is an event schema 2 transition under the expand, release, contract
  order, and a hosted rollout the owner must approve first.
- **An owner-facing filter or breakdown by launcher** on the dashboard, terminal,
  and phone.
- **Codex originator labels** (section 4).
- **An instance-bound discovery file** for the loopback plane, so a consumer can
  confirm that the process on the port is this owner's Seorak before it sends a
  bearer. Today `GET /data-plane` answers without a credential and names the
  plane, which is a sanity check, not an identity proof.
- **Live state.** Resolve answers from the projected history. It does not stream,
  and `live:read` stays unissued (ADR 002).

## Consequences

- The collector's local history moves to schema 8: a `local_session_launcher`
  table, and the query audit rebuilt so its closed operation list includes
  `resolve_session`. An older collector refuses a schema-8 history, so the daemon
  must restart onto the new build once the hooks have migrated the file.
- The owner cell gains D1 migration 0039, which rebuilds `mcp_oauth_audit` for
  the same reason, and its readiness check requires 0039. The migration is applied
  before the new worker is deployed.
- The cross-authority parity gate drives four resolve scenarios through both
  authorities from one fixture: a hit, a wrong agent, an unknown id, and a
  restricted credential.

## Rejected alternatives

- **Put the native id on session summaries.** Every `sessions:read` holder would
  receive every native id, which is exactly the listing ADR 002 refuses.
- **A hash of the native id on summaries.** Still a stable external identifier
  derived from a storage key, and a caller holding the id can compute it, so it
  protects nothing that resolve does not.
- **`GET` with the id in the query string.** Puts the id in access and proxy logs.
- **A caller-minted correlation token passed into the agent's environment.** It
  would duplicate an identity the agent already has, and a token read from the
  environment could not be verified against anything Seorak measured.
- **Excluding labeled sessions from the owner's stats.** Understates real work and
  real spend; exclusion is what `SEORAK_CAPTURE=0` is for, and only the launching
  program can decide that.
