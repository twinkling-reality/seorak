# Seorak setup

Getting your real Claude Code and Codex work into Seorak.

**Start with [Part 1](#part-1-seorak-on-this-computer).** It needs no account, no
sign-in, no cloud provider, and nothing for you to operate. That is the product,
not a preview of it.

[Part 2](#part-2-optional-reaching-it-from-somewhere-else) is optional: the same
collector, bound to a routable interface behind a credential and TLS, so a second
computer or a phone can read your history without anyone else operating anything.

Prerequisite: **Node 22.18 or newer**. Published artifacts contain compiled ESM
and keep the same Node floor.

| Part | For | Account |
|---|---|---|
| [1. Seorak on this computer](#part-1-seorak-on-this-computer) | everyone | none |
| [2. Reaching it from somewhere else](#part-2-optional-reaching-it-from-somewhere-else) | a second computer or a phone | none |
| [3. The managed service](#part-3-the-managed-service) | people who would rather not operate it | a Seorak account |

---

# Part 1: Seorak on this computer

Seorak watches Claude Code and Codex on this machine, keeps the complete history
in a database in your home directory, and answers questions about it. No account
is created, and nothing is uploaded.

## 1. Set up capture

```bash
npx seorak setup
```

This is one temporary package run, not a global install. Setup keeps the files
needed by hooks and background capture in Seorak's local state, then verifies
the result. Re-running it is safe and repairs stale hook paths.

The CLI's npm package is the unscoped `seorak`, renamed from `@seorak/collector`
so the command you type names the product rather than one of its internal parts.
The directory in this tree stays `packages/collector`.

If you installed the old package globally, remove it before installing the new
one globally. Both provide a `seorak` binary, so npm refuses the second install
with `EEXIST` rather than overwriting the first:

```bash
npm uninstall -g @seorak/collector
```

The `npx` command above needs none of that: it runs from npm's own cache and
links nothing onto your PATH. Your captured history is untouched either way —
it lives in `~/.seorak`, not in the package.

`seorak@0.2.0` published to npm on 2026-08-16 with provenance attesting to
`twinkling-reality/seorak`, so the `npx` form above resolves.
`@seorak/collector@0.1.1` is the last release under the old name. To run the
development build instead of the released one, use this checkout:

```bash
npm install                                         # once, at the repo root
npm run build:dashboard                             # the primary UI
npm run link:cli                                    # symlinks `seorak` for development
node packages/collector/bin/seorak.mjs <subcommand> # or call the source entry
```

Every `seorak ...` command below works from either checkout entry point. Keep
the same `npx seorak` prefix for later commands. It creates no global install.

This installs the six Claude Code hooks, registers the background collector, and
starts recording. On macOS it writes and loads a LaunchAgent
(`~/Library/LaunchAgents/app.seorak.collector.plist`, logging to
`~/.seorak/daemon.log`); on other platforms it prints a
`seorak start --foreground` command to run instead. Codex capture is on by
default and needs no extra step: the collector tails `~/.codex/sessions` if that
directory exists.

Restart Claude Code, or start a new session, so the hooks load.

Every captured event is committed to `~/.seorak/history.sqlite` before anything
else happens. That database is the authority, and it is yours.

`setup` closes with `✅ capturing` and a zero exit. A local install is complete
with no account, no key, and no Seorak service connection: hooks bound and
capture running is the whole product on this machine. npm still downloads the
package and prepares its durable local runtime. A remote data service is an
explicit opt-in, and only then can its checks fail the command, because only then
did you ask for a connection and not get one. `seorak init` remains a supported
compatibility alias.

## 2. Do some work, then read it

Use Claude Code or Codex in any git repo. Then:

```bash
npx seorak                                 # the live board in your terminal
npx seorak local report                    # the period read, in prose
npx seorak local sessions                  # every session, as JSON
npx seorak local replay <session-id>       # keyframes worth reviewing
npx seorak local export --output /absolute/path/seorak-export.json
```

`seorak local export` writes a new mode-0600 file containing the complete raw
event record, the report, and a completeness marker. It refuses to overwrite an
existing path. Copying a stopped `~/.seorak` is a byte-for-byte backup.

Most stats are honest-empty until you have accumulated sessions, commits, and
days. That is the product being truthful, not a bug. If nothing appears at all,
run `npx seorak status`: every line is a check, and every failure
prints its remedy.

## 3. The dashboard in a browser

The background collector already serves it. The primary dashboard, with the
customizable widget layout, Compare, and the project views, reads your local
history on loopback at `http://127.0.0.1:4317/dashboard`, with no account, no
key, and no network. It is the same app in the same shape as everywhere else, not
a simplified second interface. That is the decision in
[ADR 003](docs/adr/003-one-primary-ui-over-a-modular-data-plane.md).

To open it, or to run it on another port without the daemon:

```bash
npx seorak local dashboard                 # loopback only
npx seorak local dashboard --port 4400
```

`SEORAK_LOCAL_PLANE=0` turns the daemon's plane off, and
`SEORAK_LOCAL_PLANE_PORT` moves it.

**Where the bundle comes from.** The plane resolves `@seorak/dashboard` by name
first, then falls back to a checkout's sibling `packages/web/dist-dashboard`,
which is what `npm run build:dashboard` writes. `SEORAK_WEB_DIST` overrides both
with an absolute path.

With no bundle at all the plane still serves the route contract and says so
rather than printing a URL that opens nothing. With a bundle built against a
different `dataPlaneProtocolVersion` it refuses by name and serves the contract
without a UI, which is the honest outcome: a mismatched bundle cannot parse this
plane's descriptor and would render a sign-in screen over local history.

Open **`/dashboard`**. The root path redirects there.

> **The intervention engine runs locally too.** The daemon sweeps the live board
> every five minutes (`SEORAK_INTERVENTION_SWEEP_MS`), records what crossed,
> serves it at `/interventions`, and posts a desktop notification. Recording
> happens first, so a notifier that is missing or refused permission costs you
> the banner and never the history. Delivery is macOS-only today, and the banner
> is attributed to whatever hosts the script rather than to Seorak; on any other
> platform the fires are still recorded and readable.

<details><summary>Manual fallback (no <code>seorak</code> CLI)</summary>

```bash
node packages/collector/scripts/install-hooks.mjs   # merges the six hooks into ~/.claude/settings.json (idempotent, backs up)
npm run dev --workspace seorak
```
</details>

## 4. Turning it off, and deleting data

```bash
npx seorak uninstall          # removes the service; keeps hooks and all data
npx seorak uninstall --hooks  # also unbinds hooks; still keeps data
```

Neither removes your history. To delete the collector state directory
irreversibly, inspect first:

```bash
npx seorak uninstall --purge --dry-run
npx seorak uninstall --purge
```

The purge is resumable and leaves only a content-free external revocation
receipt, so a cached hook command cannot recreate state. It does not touch data
already sent to a service you connected.

## 5. Useful knobs

`SEORAK_CODEX=0` turns off the Codex tailer. `SEORAK_MOMENTUM=0` turns off all
git capture. `SEORAK_CAPTURE=0` is the one a PROGRAM sets: put it in the
environment of a coding agent it spawns and every Seorak hook that process
fires records nothing, so the tool's own `claude -p` runs never land in your
session history. `SEORAK_LAUNCHER=<label>` is its opposite: a program that
launches agents on your behalf sets it so those sessions are kept, counted like
any other, and carry its label. `SEORAK_DIR` moves the state directory. The table is the
[env var reference](#env-var-reference), and more collector tuning lives in
[`packages/collector/README.md`](packages/collector/README.md).

---

# Part 2 (optional): reaching it from somewhere else

Everything in Part 1 stays true. This part is for reading your work from another
computer or your phone without paying anyone to operate anything.

The same plane binds a routable interface, which is the reference self-hosted
service: identical route contract, identical dashboard, no separate server and no
account. It is off by default, and turning it on is deliberately not one setting.

```bash
npx seorak remote credential  # minted here, printed once; --rotate replaces it
```

Then give the daemon all four, together:

| Variable | Meaning |
|---|---|
| `SEORAK_SELF_HOSTED_ORIGIN` | the exact public origin, `https:` only. Its port is the listen port |
| `SEORAK_SELF_HOSTED_BIND` | the interface address to listen on |
| `SEORAK_SELF_HOSTED_TLS_CERT` | absolute path to the PEM certificate chain |
| `SEORAK_SELF_HOSTED_TLS_KEY` | absolute path to the PEM private key |

Every request carries `Authorization: Bearer <credential>`, including `/health`
and `/data-plane`. There is no plaintext mode, no partial mode, and no flag that
produces either: a missing setting, an unreadable certificate, or a credential
other users on the box can read each refuse to bind, and the daemon logs the
refusal while capture and the loopback plane carry on.

**Loopback is unchanged and still needs no credential.** The routable binding
reports itself as `remote` / `self-hosted`, and it can never describe a billing
window, because nobody meters a service you run.

One read behaves differently on the two bindings, on purpose. A per-session
outcome over the routable socket is refused with `413` past
`SESSION_OUTCOME_MAX_ROWS` outcome events, the same refusal a hosted service
gives, because a cheap request should not buy an unbounded scan on your machine.
The same session still reads in full on loopback, where the caller is provably
you.

What replaces the loopback plane's positional hardening, and the two properties
that deliberately are **not** replaced, is written down in
[self-hosted-plane-hardening.md](docs/reference/self-hosted-plane-hardening.md).
Read it before you bind a socket; it names what you are giving up rather than
claiming parity.

## Pointing a collector at any compatible service

The route contract is versioned and public, so a collector can ship to any
service that answers it, including one you deployed yourself.

```bash
npx seorak setup --worker-url https://your-service.example
npx seorak setup --worker-url https://your-service.example --ingest-key <write> --read-key <read>
```

`setup` verifies the read path with the read credential and proves the write
credential reaches the ingest parser with a deliberately invalid, non-writing
request. Read authority falls back to the ingest credential when no read
credential is given; setting both to the same value provides no separation. On
macOS the LaunchAgent resolves both once at startup, so re-run `seorak setup`
after a rotation.

To run the daemon by hand instead:

```bash
SEORAK_WORKER_URL=https://your-service.example \
  npm run start --workspace seorak
```

**What the wire contract is.** `DATA_PLANE_PROTOCOL_VERSION` and the
`event-protocol` `schemaVersion` in `@seorak/types` are the compatibility
contract, not a release train. Ingest compatibility is recorded in
[event-ingest-compatibility.md](docs/reference/event-ingest-compatibility.md).

**Seorak publishes no server implementation other than this collector's own
plane.** The managed service is a separate private codebase, so "deploy the
Seorak worker yourself" is not a path this repository offers. What it offers is
Part 2 above and a documented contract to write against.

---

# Part 3: the managed service

Seorak sells a managed remote service: someone else operates the storage, the
continuity, and the alert delivery. It is a separate private codebase and none of
it is in this repository. Billing is not live and the service is not open for
purchase.

The collector carries the client half of it, deliberately and visibly:

```bash
npx seorak login
npx seorak setup
npx seorak status
```

`seorak login` runs an OAuth device flow with PKCE against a control plane. The
browser sees only a short user code and an approval screen; separate cell-scoped
ingest and read credentials return to the terminal and are saved at mode 0600 in
`~/.seorak/connection.json`. It targets Seorak's own control plane by default and
`--control-plane <origin>` names another. `--no-browser` prints the URL instead
of opening one.

That path is optional, it is not required for the local product, and it is not a
limited hosted allowance for local users. Nothing in Part 1 uploads anything. The
dashboard's sign-in buttons resolve their control plane at runtime from the
`/data-plane` descriptor the serving plane sends, so a plane that names none
disables them and keeps the local product whole, rather than aiming them at an
origin nobody configured.

---

## Env var reference

Collector only. This repository contains no server whose configuration it could
document.

| Var | Where | Default | Purpose |
|---|---|---|---|
| `SEORAK_DIR` | collector | `~/.seorak` | collector state dir (SQLite history, compatibility log, cursors) |
| `SEORAK_CAPTURE` | collector hooks | on | set `0` in the environment of an agent your program SPAWNS and every Seorak hook that process fires records nothing, so its invocations are not recorded as your sessions |
| `SEORAK_LAUNCHER` | collector hooks | unset | a short label (letter or digit, then up to 63 of `a-z 0-9 . _ -`, lowercased) set in the environment of an agent a program launches on your behalf; the session is captured as usual and the label is kept beside it, reported as `launcher` by the Integration API. Never sent to a worker |
| `SEORAK_CODEX` | collector daemon | on | set `0` to disable the Codex session tailer |
| `SEORAK_CODEX_DIR` | collector daemon | `~/.codex/sessions` | Codex rollout-log root the tailer watches |
| `SEORAK_CODEX_POLL_MS` | collector daemon | `30000` | how often the Codex tailer polls |
| `SEORAK_CODEX_MAX_ROWS_PER_TICK` | collector daemon | `500` | ceiling on rows the tailer ingests per poll |
| `SEORAK_MOMENTUM` | collector | on | set `0` to disable all git capture |
| `SEORAK_MOMENTUM_WINDOW_DAYS` | collector | `7` | trailing window for momentum counts |
| `SEORAK_MOMENTUM_IGNORE` | collector | unset | globs excluded from git capture |
| `SEORAK_MOMENTUM_SWEEP_MS` | collector daemon | `3600000` | git capture sweep cadence |
| `SEORAK_SURVIVAL_AGE_DAYS` | collector | `3` | maturation window before re-checking commit survival |
| `SEORAK_SETTINGS` | every hook-aware command | `~/.claude/settings.json` | the Claude Code settings file the hooks are written into. `setup`, `status` and `uninstall` all read the same override, so moving it moves what they inspect too |
| `SEORAK_BATCH_DELAY_MS` | collector daemon | `250` | how long the shipper batches before sending |
| `SEORAK_LOCAL_PLANE` | collector daemon | on | set `0` to stop serving the loopback data plane |
| `SEORAK_LOCAL_PLANE_PORT` | collector daemon | `4317` | loopback data-plane port |
| `SEORAK_WEB_DIST` | collector daemon | unset | absolute path to a dashboard bundle, overriding both resolution candidates |
| `SEORAK_INTERVENTION_SWEEP_MS` | collector daemon | `300000` | how often the local watch engine evaluates the live board |
| `SEORAK_SELF_HOSTED_ORIGIN` | collector daemon | unset | exact `https:` origin of the routable binding; its port is the listen port |
| `SEORAK_SELF_HOSTED_BIND` | collector daemon | unset | interface address the routable binding listens on |
| `SEORAK_SELF_HOSTED_TLS_CERT` | collector daemon | unset | absolute path to the PEM certificate chain |
| `SEORAK_SELF_HOSTED_TLS_KEY` | collector daemon | unset | absolute path to the PEM private key |
| `SEORAK_WORKER_URL` | collector daemon | `http://localhost:8787` | data service base URL; unset in practice until you connect one |
| `SEORAK_INGEST_KEY` | collector daemon and `seorak setup` | unset | write credential for a connected data service, and the default read credential |
| `SEORAK_READ_KEY` | terminal and daemon settings sync | falls back to `SEORAK_INGEST_KEY` | distinct read credential; set it to an empty string and the client sends no read header rather than falling back |
| `SEORAK_COMPACT_SYNC_MS` | collector daemon | `300000` | compact-sync cadence to a connected service; below 10 seconds is rejected |
| `SEORAK_SETTINGS_SYNC_MS` | collector daemon | `300000` | how often settings are reconciled with a connected service |
| `SEORAK_CONTROL_PLANE_URL` | `seorak login` | the managed control plane | account-service origin the device flow talks to; `--control-plane` is the flag form |
| `SEORAK_DEBUG` | collector | off | set `1` to warn when a repo's stable identity key was unreadable and a weaker anchor was used. That one warning is all it does; it is not verbose logging |
| `SEORAK_CONTROL_DIR` | collector | `~/.config/seorak/collector-lifecycle` | absolute path to the lifecycle directory holding the state-ownership lock and the revocation receipt. `SEORAK_DIR` does not move it |
| `SEORAK_RECOVERY_TOKEN` | `seorak recovery download` | unset | the one-time grant that command requires. It is read only from the environment and is deliberately refused as a flag |

More collector tuning is in
[`packages/collector/README.md`](packages/collector/README.md).
