# @seorak/collector

Seorak is performance tracking for agentic development. This package is the
part that does the tracking: a local-first daemon plus Claude Code hook scripts
and Codex capture.

It records what your coding agents actually did on this machine and reads it
back to you. Hooks commit events to permanent SQLite before appending the
compatibility JSONL mirror, and the daemon then serves that history to the
primary dashboard over a loopback data plane, so you get the same UI, reports,
replay, and export with no account. Your code and your prompts are never read;
what is derived from a session is counts, timings, and salted ids.

## Install

```bash
npm i -g @seorak/collector
seorak init
# → dashboard: http://127.0.0.1:4317/dashboard
```

`seorak init` installs the six Claude Code hooks and registers the background
daemon. It asks for no account, no key, and no network call. Codex needs no
extra step of its own: the daemon tails `~/.codex/sessions` when that directory
exists, because Codex already writes its own session log.

## What happens next

Restart Claude Code (or start a new session) so the hooks load, then do some
work. When there is something to read:

```bash
seorak                    # the live session, in your terminal
seorak status             # ✓/✗ checklist: is it actually working?
seorak local dashboard    # the primary dashboard, on loopback
seorak local report       # the period read, in prose
```

A stat that has not been measured yet is left unsaid rather than zero-filled,
so an early read is short rather than full of `0`s. Everything above runs from
this machine's own record; a remote service is an explicit opt-in, and that is
what the rest of this page is about.

## Free and managed setup

The Free path takes no account, no key, and no network call. There is no worker
prompt and no reachability check on that path: Free is complete from this
machine's own record, so a worker is an explicit opt-in (`--worker-url`,
`SEORAK_WORKER_URL`, or `seorak login`) and only then are its probes allowed to
fail the command. `seorak status` draws the same line — a local-only install is
a healthy install. An entitled connection sends compact projections and
encrypted archive chunks to a compatible worker.

The daemon serves the loopback **data plane**: the same public route contract
(`/live`, `/overview`, `/sessions`, `/sessions/:id/outcome`,
`/developer-model`, `/interventions`, `/replay`, `/settings`, and private
integrations) the hosted worker
serves, read from `history.sqlite`. `GET /data-plane` names the authority and
lists ONLY the surfaces this plane can honestly answer, so the dashboard shows an
unavailable surface as unavailable rather than as measured emptiness. Two are
deliberately absent and neither is a derivation still owed: delivery health has
no local delivery path whose health it could report, and public presence needs an
operated directory this plane is not.

The daemon also runs the **watch engine** on its own tick: it evaluates the live
board against your configured thresholds, per-project mutes and quiet hours,
records what crossed to a rolling one-day ledger that `/interventions` reads, and
posts a desktop notification. Recording happens first, so a notifier that is
missing or refused permission costs you the banner and never the history.
Delivery is macOS-only today, and a banner posted through `osascript` is
attributed to whatever hosts the script rather than to Seorak.

The loopback owner needs no operator credential, because the listener is bound
to the machine that owns the history. Ownership is positional: loopback
binding, a raw canonical `Host` at the actual listener port, an exact same-alias
`Origin` when present, no CORS header ever, closed route families, and
`no-store` + `nosniff` on every response. `Origin: null`, foreign origins,
cross-port aliases, and DNS-rebound names are refused before any credential,
path, or database work.

### Private API and MCP

The owner dashboard inventories, issues, and independently revokes scoped
private-integration credentials. API and MCP credentials are separate `srkx_`
bearers with mandatory expiry, exact canonical audiences, optional project/date
restrictions, and one-time secret display. The loopback audience always names
`http://127.0.0.1:<actual-port>`, even when the dashboard was opened through
`localhost`; self-hosted audiences use the configured public origin. Operator
credentials never authorize API or MCP, and API and MCP credentials do not
cross audiences or authorize ordinary or management routes.

Collector MCP is an out-of-band static bearer resource, **not OAuth**. It emits
no local RFC 9728, authorization-server, or OpenID discovery and does not offer
stdio or SSE transport. Put the bearer in a secret-backed environment variable,
never in the URL or a checked-in configuration. Current Codex setup is:

```bash
codex mcp add seorak --url "http://127.0.0.1:4317/mcp/private" --bearer-token-env-var SEORAK_MCP_TOKEN
```

Claude Code can expand the same environment variable in `.mcp.json` without
storing the secret:

```json
{
  "mcpServers": {
    "seorak": {
      "type": "http",
      "url": "http://127.0.0.1:4317/mcp/private",
      "headers": { "Authorization": "Bearer ${SEORAK_MCP_TOKEN}" }
    }
  }
}
```

Use the actual canonical URL displayed after issuance. Seorak-managed MCP stays
OAuth-based and never offers this static-token target.

Agent events are committed to local SQLite first. Free does not receive a small
Seorak-hosted allowance and does not upload product data to Seorak's Cloudflare
resources.

In this repository the same path is `npm run dev:web`, which proxies `/api` to
the plane on 4317 by default — the dashboard comes up with no worker running at
all. Point it at a worker instead with
`SEORAK_DEV_API=http://localhost:8787 npm run dev:web`. It stays a proxy rather
than a cross-origin call because a loopback service that answers any web page is
a real hazard on a developer machine; the plane grants no CORS and refuses a
foreign `Origin`, and same-origin keeps that refusal absolute.

The managed beta adds browser authentication before capture setup:

```bash
seorak login
seorak init
seorak status
```

`seorak login` uses an OAuth device flow with PKCE. The browser sees only a
short user code and approval screen; separate cell-scoped ingest and terminal
read credentials return to the CLI and are saved mode 0600 under
`~/.seorak/connection.json`. `init` claims that state directory, installs the
six Claude Code hooks, registers a background daemon, and verifies the full
read/write chain. Browser logout does not stop the collector.

This login path is the optional managed remote service. It is not required for
the Free product and does not represent limited managed hosting for Free.

Development from the monorepo, rather than from the installed package, can use
`npm run link:cli` at the root or `node packages/collector/bin/seorak.mjs`.

Manual/self-operated configuration remains available:

```bash
seorak login [--control-plane https://seorak.app] [--no-browser]
seorak init                                   # uses the paired cell when present
seorak init --worker-url https://my.worker    # non-interactive
seorak init --worker-url https://my.worker --ingest-key <write> --read-key <read>
seorak init --no-service                      # install hooks only; run the daemon yourself
```

On macOS, `init` writes a launchd LaunchAgent to
`~/Library/LaunchAgents/app.seorak.collector.plist` (RunAtLoad + KeepAlive, with
`SEORAK_WORKER_URL` plus configured write/read authority baked in, logging to
`~/.seorak/daemon.log`) and loads it via `launchctl`. Re-running `init` preserves
those values unless a flag or environment variable replaces them. The daemon
copy-truncates that exact log inode above 8 MiB at startup and on its 30-second
heartbeat, retaining one bounded `daemon.log.1`; this keeps launchd's already-open
stdout/stderr descriptors attached to the current pathname. On other platforms
(or with `--no-service`) it skips the service and prints the `seorak start
--foreground` command to run the daemon yourself.

Verification checks both credential roles: the read key must reach `/live`, and
the ingest key must reach the `/events` parser through a deliberately invalid
request that cannot write data.

Then answer the #1 question — *is it actually working?*:

```bash
seorak status        # ✓/✗ checklist: hooks, daemon, read/ingest authority, shipping, capture, codex
```

Other subcommands:

```bash
seorak start [--foreground]   # load the LaunchAgent (or run the daemon in this shell)
seorak stop                   # unload the LaunchAgent
seorak uninstall              # remove the service; retain hooks and collector data
seorak uninstall --hooks      # also remove hooks; retain collector data
seorak uninstall --purge      # remove service, hooks, and all collector data
seorak uninstall --purge --dry-run
seorak local report [--json]
seorak local sessions
seorak local replay <session-id>
seorak local dashboard [--port 4317]
seorak local export --output /absolute/path.json
```

Local export creates a mode-0600 file and refuses overwrite. `seorak local
sessions` traverses every page, so it prints the complete local history rather
than a capped first page. `seorak local dashboard` is an alias: the daemon
already serves the plane, so the command prints where the primary dashboard is
and only starts a plane itself when none is running (a `--no-service` install,
or an ad-hoc read). Subscription state never narrows these local paths.

Session reads refuse the rows the daemon's momentum sweep manufactures. A
`git.momentum` swept under the synthetic `daemon-momentum` id opens a session row
with no repo identity, which the hosted side already filters out; the local
readers did not, so the two halves of one product disagreed about how many
sessions you ran. The rows stay in the database — history is the authority — and
the filter lives in the read path.

`--purge` is the irreversible local deletion path. It first revokes capture in a
content-free record outside `SEORAK_DIR`, proves the daemon stopped, removes
hooks, drains hook invocations that already started, and deletes only the exact
state-directory device/inode recorded before teardown. Interrupted deletion
resumes from the retained journal; `seorak init` refuses until it completes.
The external revocation receipt remains so cached hook commands cannot recreate
state. A later `seorak init` explicitly reactivates capture.

Plain `uninstall` intentionally retains state. Because it also retains hook
bindings, use `--hooks` when the goal is to stop local capture without deleting
history. None of these commands delete data already sent to a hosted worker.

`status` exits nonzero when anything critical is missing, so it doubles as a
CI/health check. What counts as critical depends on what was asked for: hooks and
the service always, and the worker legs only on an install that opted into a
connection. After `init`, restart Claude Code (or start a new session) so the
hooks load.

## The session (`seorak`) vs setup (`seorak init`)

`seorak init` is one-time plumbing: it installs hooks and the background daemon
and verifies the chain. You run it once (and `seorak status` to check it).

`seorak` with **no subcommand** is the product: an interactive session that reads
your work back to you as a short paragraph, and hands off to the dashboard for
everything deeper.

```bash
seorak                       # open the live session (the product)
seorak --once                # render it once and exit
seorak --demo[=scenario]     # drive the session from demo fixtures, no worker
seorak --once --json         # the assembled snapshot as JSON
```

The session is framed top and bottom by two matching rounded boxes: a header box
and the input box. The header carries `seorak` on the left and the date-range
filter (`7d 30d 90d`, active one marked) flush right, a real control like the
web's date-picker; **←/→ switches it** (or `/range`).

Between them is the whole product: **one sentence about now**, then up to three
about the window, then the dashboard link.

```
  seorak has needed you for 4 minutes, and 2 other sessions are still working.

  Over the last 7 days you ran 80 sessions across 8 projects: 42.5M tokens,
  29.2M through Claude Code and 13.4M through Codex. Seorak can price $4,339
  of that, but Claude Opus 5 has no list price yet, so your real spend is
  higher. Your work held up, Codex aside: 74% of sessions ended in a commit
  and 86% of the lines you wrote are still on the branch across 45 matured
  sessions.

  Charts, replay, and the model live in the dashboard:
  https://your-worker.workers.dev/dashboard
```

A blocked session always owns the first sentence: that is the only thing on this
surface you might have to act on. The rest is composed in `narrative.ts` from the
same `/live` + `/overview` responses web and mobile read, built from the shared
`@seorak/types` `api.ts` helpers (`/overview` as a conditional GET).

**Why prose and not a grid.** This used to render the web's widget catalog in
ANSI: the same 12-column slots, the same stat cells, `/add` and `/remove` to
curate them. That gave it no identity of its own and, more importantly, no room
to qualify anything. A cell can print `est. cost $4,339`; it cannot say the total
excludes an unpriced model. A cell reading `shipped 74%` cannot say the rate
covers only one of your two agents. Both are true of real data today. The honesty
rule is unchanged and gets stricter in prose: an unmeasured leg is **not spoken**
rather than zero-filled, so the paragraph gets SHORTER on thin data instead of
filling up with `--`.

Two arrow pairs, two axes: **left/right change the window**, **up/down focus one
project** (wrapping back through "everything", or press Escape). A focused board
narrows both halves, reading the per-repo rollup the worker computes with the
SAME definitions as the global one, so focusing changes the population and never
the meaning of a number.

Changing the window twice in a row is safe. Each `/overview` request carries a
generation, and an answer that is no longer the newest one asked for is discarded
whole on arrival — body, ETag, and reachability verdict — so the window you landed
on stays on screen instead of being blanked by the one you passed through.

On-screen hints SPELL the keys rather than drawing them. `←↑↓→` (U+2190..2193)
are not cell-exact in a monospace font, so most terminals font-fall-back and
render them at a different size and baseline than the text beside them, which no
app-side alignment can fix. Same lesson the identity mark carries about `▲`:
Block Elements only. The same rule keeps `≥` out of the projects table.

**`/view`** cycles three readings: the paragraph, a scannable list of the same
facts, and a table of every project. The first two are built from one fact layer
(`windowRows` sits beside `windowSentences`), so form can never change the claim.
The table is the one place `--` comes back, because a row has a cell under every
column whether or not there is a number for it; an unmeasured cell renders a dim
`--`, never a zero. A cost with a trailing `+` ran an unpriced model and is a
floor, and a capped list always says what it dropped.

The input box also takes `/range <7|30|90>`, `/help`, and `/quit`; free text
routes to chat (grounded stat/session questions; stubbed in v1). The palette
highlights one row while you type a command; **Tab** completes it, **Enter**
chooses it. The window and the view persist to `~/.seorak/terminal-layout.json`.
The dashboard link never carries a token or device credential. Product web
authentication is an independent HttpOnly session, so leaving the terminal on
screen cannot disclose collector authority.

### The entry card, and loading

A launch goes straight to the board. The session only opens on a screen when it
has something true to say: nothing is being captured yet, or you have upgraded
and there are notes for the versions you crossed. That screen waits for a
keypress; a loading state never should.

Release notes live in **`NEWS.md` inside this package**, one `## <version>`
heading per release. There is no central Seorak service to broadcast from (every
user deploys their own worker), and a CLI that phoned a vendor host for
announcements would leak your IP and your working hours from a product whose
pitch is that nothing leaves your machine. Shipping the notes means they arrive
with the upgrade and work offline. `~/.seorak/last-seen-version` records what has
been shown, and an install that already has hooks gets that file written silently
rather than being welcomed to a product it has been using for weeks.

While a window is building, the board shows a spinner naming what it is reading.
The first `/live` lands in about 250ms, which is why the identity block is no
longer the loading screen: it flashed on and off too fast to read.

It needs only Node built-ins (raw ANSI + readline), no TUI dependency.

## Install hooks in Claude Code

`seorak init` idempotently merges all six bindings and backs up the existing
settings file. Use `seorak init --no-service` when only hook installation is
wanted. `seorak status` is the source of truth for the exact installed set;
hand-written absolute hook commands are not supported.

`PostToolUse` and `PostToolUseFailure` are two SEPARATE Claude Code events — `PostToolUse` fires only when a tool call *succeeds*, `PostToolUseFailure` only when it *fails*. Both are bound to the SAME `hook-tool-use.mjs` script; it derives the `errored` flag from `hook_event_name` (false on success, true on failure) with zero output parsing. **Both registrations are required** — omit `PostToolUseFailure` and failed tool calls are never recorded, so the error rate undercounts (it would look like nothing ever fails).

`Notification` captures the *needs-you* moments (permission prompts and idle
waits) that power the live "needs you" status and interventions; `UserPromptSubmit`
captures steering cadence (that a prompt was sent — envelope only, never the
prompt text). Omit either and those stats silently under-count, so install all
six; `seorak status` reports the exact set that is bound.

Hooks block the Claude Code event loop, so they must be fast. The tool-use and
session-end hooks only append a single JSON line to `~/.seorak/events.jsonl` —
no network calls. Appends and acknowledged rollover share an owner-token lock:
every operation freezes its collector paths before waiting, a live owner is
never displaced merely because it is old, and an expired owner cannot remove a
successor's lock. If another live writer holds the lock for the full five-second
hook budget, the hook preserves the Claude session and atomically records a
content-free `capture-failure.json` marker. Other validation and filesystem
failures remain explicit. `seorak status` fails until that known capture gap is
acknowledged and the marker is removed.

The session-start hook does one extra thing: it shells out to `git` to capture a repo-scoped momentum snapshot (see below). That adds a bounded cost to session start only — each `git` call is capped by a short internal timeout, and the whole step is skippable with `SEORAK_MOMENTUM=0`. It never blocks tool calls or session end.

## Run the daemon

```bash
SEORAK_WORKER_URL=http://localhost:8787 npm run dev --workspace @seorak/collector
```

Env vars:
- `SEORAK_WORKER_URL` — worker base URL for an OPT-IN connection. Unset means
  local only: the daemon runs no worker settings sync and `seorak status` reports
  a healthy local install rather than an unreachable localhost default.
- `SEORAK_LOCAL_PLANE_PORT` — loopback data-plane port (default `4317`).
- `SEORAK_LOCAL_PLANE` — set `0` to stop the daemon serving the plane at all.
  Capture is unaffected; only the dashboard read path goes away.
- `SEORAK_SELF_HOSTED_ORIGIN`, `SEORAK_SELF_HOSTED_BIND`,
  `SEORAK_SELF_HOSTED_TLS_CERT`, `SEORAK_SELF_HOSTED_TLS_KEY` — remote access you
  operate. The same plane on a routable socket, behind a credential and TLS it
  terminates itself. **All four are required together**, plus a credential minted
  by `seorak remote credential`; anything short of that refuses to bind rather
  than binding something weaker. The origin must be `https:` and its port is the
  listen port. Loopback still needs no operator credential, but its Host/Origin
  admission is exact at the actual socket port. Why it is
  shaped this way: [`docs/reference/self-hosted-plane-hardening.md`](../../docs/reference/self-hosted-plane-hardening.md).
- `SEORAK_WEB_DIST` — absolute path to a built dashboard bundle to serve. Falls
  back to `@seorak/dashboard`, this package's exact-pinned dependency, resolved
  by name rather than by walking to a sibling directory; then to a source
  checkout's `packages/web/dist-dashboard`, which is the dashboard artifact
  rather than the combined website. With none present the plane still answers the
  route contract and says the bundle is not installed rather than printing a dead
  URL. A bundle whose declared `dataPlaneProtocolVersion` is not the one this
  collector speaks is REFUSED by name, and the plane serves the route contract
  without a UI: the alternative is a dashboard that reads the descriptor as
  unparseable and shows a sign-in screen over your own history.
- `SEORAK_INGEST_KEY` — shared secret sent as `Authorization: Bearer` on `/events`
  POSTs when the worker is owner-locked (unset for an open/local worker).
- `SEORAK_READ_KEY` — read token for gated GETs (terminal board, settings sync);
  defaults to `SEORAK_INGEST_KEY` when unset (one-token model). It never rides an
  `/events` POST, so a genuinely read-only token can be set here without touching
  ingest. Set it to an empty string and gated GETs go out unauthenticated —
  blanking the value asks for no header, not for the ingest key.
- `SEORAK_DIR` — collector state dir (default `~/.seorak`).
- `SEORAK_BATCH_DELAY_MS` — debounce before flush (default `250`, floor `1`).
- `SEORAK_SETTINGS_SYNC_MS` — how often a CONNECTED daemon refreshes the local
  `capture.json` cache from the worker's gated `GET /settings` (default `300000`
  = 5min, floor `1000`). One small GET per tick. A local-only install does not
  poll at all: the capture family has one authority per install, and there it is
  `capture.json` itself, written by the plane's `PUT /settings`.

The daemon resolves the worker URL and both auth tokens once when it starts.
After changing any of them, re-run `seorak init` so launchd rewrites and reloads
the service, or run `seorak stop && seorak start` after editing an existing
LaunchAgent deliberately.

Every `_MS` variable is parsed as a positive integer inside its own floor and a
`2147483647` ceiling (the signed-32-bit limit `setTimeout` holds). A blank,
non-numeric, zero, negative, or larger value reads as the documented default,
because `Number("")` is `0` and `Number("garbage")` is `NaN` — a timer given
either runs at ~1ms, which would turn a background cadence into a hot loop
against your worker.

## Codex capture

The daemon also tails Codex CLI rollout logs — no hooks needed, Codex already
writes its own session JSONL. Default ON; it costs one directory stat per tick
when `~/.codex` doesn't exist.

- `SEORAK_CODEX` — set `0` to disable the tailer (checked every tick, no restart
  needed).
- `SEORAK_CODEX_DIR` — sessions root to watch (default `~/.codex/sessions`).
- `SEORAK_CODEX_POLL_MS` — tail cadence (default `30000`, floor `1000`).

Only sessions started AFTER the first tail tick are captured (an activation
cutoff, so history never floods the live board), and the same scrub rules apply:
counts and salted ids ship, file contents and prompts never do.

The oldest Codex CLI the tailer reads version-specific shapes from is `0.116.0`
(measured 2026-07-27 across 410 local rollout files and 259,332 rows). Older
versions still capture sessions, prompts, tool calls, and tokens; what they lose
is the shell error stamp and the quota window, and both go missing rather than
getting guessed. The daemon logs one warning per session when it sees a
below-floor version.

Git momentum / delta env vars:
- `SEORAK_MOMENTUM` — set to `0` to disable ALL git capture (momentum, session
  delta, and the daemon sweep) entirely.
- `SEORAK_MOMENTUM_WINDOW_DAYS` — trailing window the momentum counts cover (default `7`).
- `SEORAK_MOMENTUM_IGNORE` — comma-separated extra ignore globs, APPENDED to the
  built-in generated/lockfile set (`package-lock.json`, `pnpm-lock.yaml`,
  `yarn.lock`, `dist/`, `build/`, `*.generated.*`, `*.snap`, `*.xcassets`). Lines
  changed in ignored files are still counted — but separately, as
  `generatedLinesExcluded`, never folded into the headline.
- `SEORAK_MOMENTUM_SWEEP_MS` — daemon commit-history sweep cadence (default `3600000`
  = 1h, floor `1000`). Each tick walks the local repo registry and emits a
  `git.momentum` per repo, catching manual/non-Claude commits. The floor is there
  because a tick spawns one `git` subprocess per registered repo.

State files in `~/.seorak/`:
- `history.sqlite` — versioned permanent raw event authority plus local session,
  hour, transition, archive, and managed-sync checkpoints. Hosted
  acknowledgement never deletes its raw rows.
- `archive-key-v1` — mode-0600 AES-256 key for managed archive ciphertext. It
  stays local and is included only when the owner backs up the full state
  directory.
- `daemon.log` / `daemon.log.1` — local daemon diagnostics. The current log is
  checked at startup and every 30 seconds. Once it exceeds 8 MiB, the newest
  8 MiB is durably published as the sole archive before the current inode is
  truncated in place. A failed archive leaves the current log untouched for the
  next check; a long line can exceed the limit until that check runs.
- `events.jsonl` — active compatibility mirror. Once it reaches 16 MiB, the
  daemon rolls it over only when both the selected delivery protocol and local
  attribution acknowledge the exact end of file. SQLite remains complete across
  rollover and hosted outages.
- `events.generation` — monotonic local rollover generation, used to
  disambiguate rejection-checkpoint offsets after compaction.
- `events.offset` — generation-bound byte offset of the last successfully
  shipped event.
- `events.rejections.json` — constant-bounded, content-free classifications for
  malformed or individually oversized complete records. It stores exact
  `offset`/`nextOffset`/byte/reason tuples only for the current unacknowledged
  chunk (at most 128), plus current and historical count/byte buckets by closed
  reason. It never copies rejected JSON, key names, ids, or values. `seorak
  status` fails when the current event-log generation has any classification;
  prior generations retain aggregate forensic evidence without failing a
  repaired chain.
- `capture-failure.json` — constant-size, content-free proof that one or more
  Claude hook events could not enter the event log before the lock deadline. It
  stores only a closed reason and the winning marker's recorded time, never event,
  session, prompt, tool, path, or payload data. It is deliberately separate from
  the offset-bound rejection checkpoint and makes `seorak status` fail until the
  known gap is acknowledged and the marker is removed.
- `settings.json` — the non-capture `/settings` families the dashboard writes
  through the local plane (notifications, Live Activity, project themes, merges,
  archive). The capture family is deliberately NOT here: it stays in
  `capture.json`, which the hook processes already read on every event, so there
  is one on-machine authority for it instead of two that can drift.
- `capture.json` — the effective Data & capture toggles. On a local-only install
  the plane writes it directly; on a connected install the daemon syncs it down
  from the worker.
- `shipping-status.json` — content-free current delivery state (`caught-up`,
  `retrying`, or `blocked`) consumed by `seorak status`.
- `device-id` — stable UUID for this machine (created on first run).
- `heartbeat` — epoch-ms the daemon last proved it was alive (rewritten every
  30s; `seorak status` reads it to tell a hung daemon from a stopped one).
- `codex-tail.json` — the Codex tailer's cursor state (schema `version: 1`:
  activation cutoff, per-rollout byte offsets, per-model token walk, and tool
  calls held across a tick). Local only; holds absolute rollout paths. Only
  version 1 is accepted; a missing, retired, or future `version` fails closed and
  re-mints rather than guessing at cursor meaning.
- `repo-salt` — per-machine secret (32 random bytes hex) used to hash repo
  identities. Created lazily on first momentum capture. NEVER leaves the machine.
  Honors `SEORAK_DIR`. Single-machine tradeoff: the same repo gets a stable
  `repoId` on this machine but a different one elsewhere — intentional, so a
  `repoId` is never correlatable across machines or reversible to a path/origin.
  Lose this file and ids rotate.
- `session-cursors.sqlite` — versioned transactional local resume state for
  Claude transcript usage and session-bounded git delta. Transcript cursors are
  retained across `SessionEnd` because Claude can resume the same session and
  transcript; deleting or age-pruning them would count old usage again. Git
  start state is consumed at session end, while never-ended sessions remain as
  database rows instead of one inode each. The daemon losslessly imports legacy
  `cursor-<sessionId>` and `gitcursor-<sessionId>` files, commits them first, and
  only then removes the source files. Transcript UUIDs and git SHAs stay local.
- `repos.json` — local registry mapping `repoId` → absolute toplevel path (+ label,
  lastSeen), populated from observed session cwds. The absolute paths live ONLY
  here (used as git cwds for the daemon sweep) and never ship.
- `repo-identity.json` — schema-version-2 local ledger keeping each project's `repoId`
  STABLE across a GitHub rename/transfer, an https↔ssh change, a folder move, or a
  transient unreadable `.git/config`. Each entry anchors one `repoId` to its salted
  git root-commit key plus every origin url and toplevel path the repo has been seen
  at. The urls and paths live ONLY here and never ship. Not a throwaway cache:
  deleting it re-mints the legacy seed, which preserves the id of a repo still at its
  recorded origin/path but rotates one whose origin has since changed. Only version
  2 loads; any other version is quarantined byte-for-byte.
- `repo-identity.json.unusable-<timestamp>` — a corrupt or unrecognized-version
  identity ledger, moved aside rather than overwritten so the historical ids stay
  recoverable by hand. Its presence means a warning was logged and some repos may
  have been re-minted. Safe to delete once you have confirmed the dashboard shows no
  duplicate project.

## Git capture (privacy)

Three git-derived stats, all COUNTS + salted ids only:
- **`git.momentum`** (session-start hook + daemon sweep): files-touched + NET line
  change (`linesAdded - linesDeleted`) + commit count over a trailing window.
- **`session.delta`** (session-end hook): did this session ship or thrash —
  `commitsLanded` between start and end HEAD (a COUNT, never the shas), `headMoved`,
  and uncommitted files-touched + NET change.
- The daemon **momentum sweep** re-emits `git.momentum` per registered repo on a
  timer so manual/non-Claude commits are captured too.

Anti-vanity: raw lines-of-code is never a score — the headline is files-touched and
NET change, and generated/lockfile lines are filtered and reported separately as
`generatedLinesExcluded` so the exclusion is auditable.

**Only counts, a salted `repoId`, and a basename-only `repoLabel` ship.** No file
path, no diff, no commit message, no absolute path, no origin url, and — by
deliberate decision — **no commit SHA** ever leaves the machine (a sha is a
correlatable fingerprint that would defeat the salted `repoId`). The absolute
path / origin url / start sha are consumed only locally (hashing, commit counting)
and discarded. A non-git working directory produces no event at all (honest-empty,
never a zero-filled row). The strict emit-allowlist in `emit.ts` is the runtime
tripwire that enforces this on every event before it is written.

## v1 slice scope

Shipping is at-least-once. This build emits exactly `schemaVersion: 1` and is
bounded by the shared `@seorak/types` contract to 128 events and 524,288 UTF-8
bytes. The delivery loop checks a bounded, three-second `GET /health` response
before reading a queue prefix. A proven empty intersection with the worker's
advertised accepted schemas blocks without reading, posting, or moving the
queue. Old, malformed, unavailable, or oversized health metadata stays unknown
and permits `POST /events`, which is the final authority. The verdict is cached
for five minutes and concurrent probes are coalesced.

A backlog drains as sequential prefixes: each prefix is retried in-flight with
bounded exponential backoff on a 5xx or network error (`ship.ts`), and its
durable byte offset advances only after a 2xx. A crash after acceptance but
before the offset write therefore replays that prefix; worker KV dedup and D1
`INSERT OR IGNORE` make the replay a no-op.

If those in-flight attempts exhaust, one independent durable-backlog timer retries
after half-to-full jitter: 30 seconds initially, exponentially capped at 15
minutes. A worker `Retry-After` delay (including 429) takes precedence. Successful
drain resets the backoff. Permanent 4xx responses remain blocked and keep the
offset in place. They retry only at the durable scheduler's 15-minute ceiling,
so a worker redeploy can heal the backlog without another local event while
avoiding a hot rejection loop. Both `seorak status` and the terminal board keep
the blocked condition visible. New file events stay queued behind that open
circuit and cannot bypass the slow probe.
Closed worker protocol rejections are read through a 4 KiB byte-counted reader.
The status names emitted and accepted schema versions only when the worker
actually advertised them; legacy rejection stays explicitly unknown. The
expand-release-contract and rollback policy is
[`event-ingest-compatibility`](../../docs/reference/event-ingest-compatibility.md).

Every complete JSONL record is validated locally before batching. A malformed,
schema-invalid, or individually oversized record is classified in the bounded
`events.rejections.json` checkpoint and skipped only after that content-free
checkpoint is flushed to disk. An exact replay window distinguishes retry from
reclassification even when valid records create byte gaps, and an all-rejection
chunk stops at 128 records so the window cannot grow with backlog history. Later
valid records continue. Each drain logs how many rejected records it encountered,
and `seorak status` fails on any distinct classification in the active
generation. Other 4xx responses retain the offset; specifically,
a worker 413/422 for a locally valid chunk is treated as collector/worker
protocol drift, never as permission to discard the record.

The active log generation and offset are the persistent send queue. A machine
that stays offline accumulates unsent events and resumes from the same byte after
recovery. Healthy, fully acknowledged generations are reclaimed; backlogs are
never deleted merely to meet a disk target.

## Repository boundaries

Nothing below changes how the package is installed or used. These are the rules
a contributor works under, and they are enforced by gates rather than by
convention.

Structured for extraction to a public `seorak-collector` repo (Apache 2.0).
Production source imports publish-safe `@seorak/types` and the exact
MIT-licensed `@modelcontextprotocol/server@2.0.0` runtime adapter, never worker
or web internals. The adapter serves the collector's private MCP resource at
the exact `/mcp/private` route; collector-owned authority and query services
remain on either side of it. The publish
artifact compiles collector-owned source to executable ESM and resolves shared
runtime contracts through the pinned `@seorak/types` release. It is a command
package, not a library API: the seven declared executables are the supported
entry points.

The repository boundary gate checks `src` and `bin` against production
dependencies, then `test`, `scripts`, and package-level source configs against
the production-plus-development closure. Every manifest dependency section
and dependency alias is checked against the closed-package denylist.
Type-only imports and aliased or dynamic module loads do not bypass that
policy; computed module names fail closed.
