# Multi-tool capture

Modular plan for adding a second agent (Codex, Cursor, OpenCode, …) without rewriting worker, web, or mobile. Parent: [VISION.md](../VISION.md). Architecture: [ARCHITECTURE.md](../ARCHITECTURE.md).

**Status:** Claude Code and Codex both ship. The capability contract (registry in `@seorak/types`, worker gates) is load-bearing: a rate needs both legs, and a tool that cannot report a field omits it. Codex carries lifecycle, tool calls, edit lines, tokens, session-scoped estimated cost, and a provider quota ratio; `endReason` is a permanent no and `verification` stays none. What is still open is in the checklist below.

**Tool facts re-verified 2026-07-09** against `codex-cli 0.142.5` (empirically, on a real install) and `openai/codex` `main`. Everything in the tool tables below carries that date except where a cell states its own later verification. Facts about other tools are **not** re-verified and are marked accordingly.

---

## Product job

Solo developers run **many repos and more than one agent**. Multi-tool buys a **single cross-repo performance board**, especially **git momentum** (what moved this week), which means the same thing regardless of which tool drove the session.

| Priority | What | Why |
|----------|------|-----|
| **Primary** | Git momentum across repos/tools | Tool-agnostic; natural cross-tool headline |
| **Secondary** | Per-tool tokens/edit lines | The only two surfaces that compare honestly (edit lines ride `tool.call`; tokens ride each tool's own carrier) |
| **Never** | Blended cost, blended tool mix, blended error rates | Different denominators; see Appendix A |

Seorak does not maximize usage. A second tool extends **where** capture applies. It is not a race to show numbers everywhere.

---

## Principles

| Principle | Implication |
|-----------|-------------|
| **One adapter per tool** | Tool-specific parsing lives only in `packages/collector/src/adapters/` |
| **CanonicalInput → builders** | `hooks.ts` lifecycle builders are tool-agnostic |
| **Downstream keys on `event.kind`** | Worker, projections, intervention never branch on agent id for ingest |
| **Capability is a constraint, not a claim** | It gates **emission**, aggregation, *and* render. A tool that cannot report a field omits it; it never stamps a stand-in |
| **Capability ≠ capture setting ≠ data presence** | Three axes, three different honest sentences. Never model them as one |
| **Honest-empty** | Unknown adapter resolves to no capabilities; no fabricated cross-tool totals |
| **Cost is derived, therefore an estimate** | We cannot detect subscription-vs-API for any tool. Every USD figure is `tokens × list price` |
| **Git is not a capability** | Git outcomes are tool-independent (daemon sweep). They gate on `CaptureSettings.gitMomentum` alone |
| **Privacy unchanged** | `emit.ts` allowlist guards every tool equally |
| **OSS boundary** | Adapters stay in collector; depend on `@seorak/types` + local modules only |

---

## Architecture

```
Claude hook payload → parseClaudeCodeHook → CanonicalInput → hooks.ts → SessionEvent
Codex rollout row  → parseRolloutLine  → SessionEvent
SessionEvent → worker
```

| Layer | Multi-tool ready? |
|-------|-------------------|
| `adapters/types.ts` | Shared `CanonicalPhase` and `CanonicalInput` metadata for hook builders |
| `adapters/claude-code.ts` | Strict one-payload Claude hook parser; unknown phases drop |
| `adapters/codex.ts` | Streaming rollout parser; never reachable through Claude hooks |
| `hooks.ts` | Builders consume `CanonicalInput` only |
| `bin/hook-*.mjs` | Call the Claude parser directly and require their installed phase |
| `git.ts` | Tool-agnostic (cwd + local git) |
| `emit.ts` | Per-`kind` allowlist |
| `types/events.ts` | `AgentId` open union; `capabilities` on `session.start` |
| Worker | Scopes cost/tokens on `capabilities`; `tools.byAgent` rollup |

**Capture-path limits, both real:**

1. Claude hooks are **one payload per process**. A streaming source belongs in a daemon-hosted tailer like Codex, not behind a hook-factory fallback. Capture paths stay explicit so one tool's payload can never be parsed and stamped as another tool.
2. `KnownToolName` (`types/events.ts:171-192`) is a **closed cross-adapter set**: the Claude built-ins plus two Codex tokens, `Shell` (exec_command/shell) and `ApplyPatch` (patch_apply_end), kept DISJOINT from Bash/Edit so two tools' distributions never merge where the D1 `agent` column is NULL. Codex's remaining vocabulary (dynamic tools: `update_plan`, `js`, `write_stdin`, ...) is open like MCP names and sanitizes to `other`. The agent id is open; the tool-name vocabulary is not. `byTool` is therefore still not comparable across tools.

Claude's one-process hooks have a bounded five-second event-log lock budget.
Contention does not break the host session or disappear: the hook writes a
constant-size, content-free capture-failure marker that makes `seorak status`
fail. Codex uses the daemon tailer and therefore keeps ordinary daemon failure
semantics. Both paths append through the same frozen path context and
owner-token lock; only the hook entry point contains the typed timeout.

**Adding a tool:**

1. Add an explicit capture path matching the native surface: a strict hook parser or a streaming tailer, never a fallback parser selected by environment
2. Add its capability entry to `CAPABILITY_REGISTRY` in the same change
3. Add the install path. For Codex it is a daemon toggle and a directory to tail, touching no Codex config
4. Token path. Claude reads its transcript JSONL; Codex reads its rollout JSONL
5. Extend `MODEL_PRICES` in `packages/types/src/pricing.ts`, or price to honest-null

**Worker/web/mobile:** ingest needs no changes. Per-tool honesty: usage-count windows admit only `usageWindow: "count"` tools (`eventlog/usage.ts` `canCountUsageWindow`; legacy NULL agent = Claude); D1 `events.agent` (migration 0006) stamps every new row. The gate is capability-shaped and permanent, not a milestone: Codex's quota is a provider ratio (`agent.quota`) with neither absolute term, and summing a ratio into a token count is a category error, forever.

---

## Candidate tools

Fast-moving area. "Passive" = observe the developer's session without driving the tool and without user configuration.

| Tool | Passive tokens | Cost | Lifecycle / tool calls / errors | Verified |
|------|----------------|------|--------------------------------|----------|
| **Claude Code** | Yes (transcript JSONL) | Derived estimate | start+end / yes / partial (`PostToolUseFailure`) | Shipped; this repo |
| **Codex** | **Yes** (rollout JSONL) | Derived estimate | start only / yes / partial (shell header exit code, `0.144.1`; `0.144.3`+ routes shell via the `exec` sandbox) | 2026-07-14, `0.144.3` |
| **OpenCode** | Reported yes | Reported native USD | Reported yes / yes / yes | ❌ not re-verified |
| **Aider** | Reported yes | Reported native USD | Reported yes; no tool-call records | ❌ not re-verified |
| **Cursor** | Unknown | Unknown | Has a first-class hooks surface since **1.7** | ❌ not re-verified |
| **Copilot** | Reported no | None | Partial | ❌ not re-verified |

> Any row marked ❌ must be re-verified against current upstream before it informs a build decision. The previous version of this table asserted that Codex had no interactive hooks and that Cursor had none outside beta. Both were wrong. Do not trust an undated capability claim, including this one.

---

## Codex: what we actually get (2026-07-09, `codex-cli 0.142.5`)

Codex writes `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, append-only, rows of `{timestamp, type, payload}`. **The adapter tails this file. It does not use Codex hooks.** Codex hooks are real, Stable, and default-on, but they GA'd only around 2026-05-14, are trust-gated, carry no token counts, and have an open regression where they silently stop firing. The file gives us strictly more, passively.

**Present, passively:**

- `token_count`: input, cached input, output, **reasoning output**, total; plus `model_context_window`
- `rate_limits`: 5-hour and weekly `used_percent`, `window_minutes`, `resets_at`, `plan_type`, `credits`. **An authoritative provider quota readout.**
- `session_meta`: `cwd`, `cli_version`, `model_provider`, `git`
- `turn_context.model`, per turn
- `function_call` / `function_call_output` for every tool call
- `patch_apply_end`: `success` plus a `changes` map keyed by file path, carrying `unified_diff` or `content`, so **edit lines, language, and file category are all derivable on-machine**
- `turn_aborted`: `reason` + `duration_ms`. Claude has no analog

**Absent:**

- **No session end marker of any kind.** Duration must be inferred from inactivity
- **No general tool exit code** (re-verified 2026-07-12). The ONE stampable error leg is the shell result header: `exec_command`/`shell` results open with a fixed header carrying the exit code, and only that header is read (a body scan would fabricate errors from arbitrary command output). `apply_patch` and MCP results carry no failure leg, so the error rate ships per-coverage (`returned / calls`, disclosed on the surface), never as a whole-tool number. And the stampable share is shrinking: 0.144.3+ routes interactive shell work through the `exec` JS sandbox, so coverage on current versions trends to 0% (CODEX-CAPTURE ADR-C14)
- **No cost.** No `cost`, `usd`, or `price` field anywhere
- **No permission-prompt event.** Approval requests are deliberately not persisted. The hooks `PermissionRequest` event is the only path, and it is opt-in

⚠️ `session_meta.git.repository_url` is a remote URL, i.e. content. It must never be emitted. `repoId` derives from `cwd`.

### Supported CLI floor: `0.116.0` (measured 2026-07-27)

The adapter declares an oldest supported Codex CLI version, `CODEX_MIN_SUPPORTED_CLI_VERSION` in `packages/collector/src/adapters/codex.ts`. It is the oldest version measured to emit **none** of the retired rollout shapes the adapter used to carry readers for.

Measured over the whole local corpus on 2026-07-27: 410 rollout files, 259,332 rows, 22 distinct `session_meta.cli_version` values from `0.46.0` to `0.146.0-alpha.3.1`.

| Retired shape | Where it occurs | Volume |
|---|---|---|
| Quota reset as relative `resets_in_seconds` | `0.46.0` only | 3,580 slots |
| Window lengths `299` / `10079` instead of `300` / `10080` | `0.46.0` only | 2,140 slots |
| Shell exit code in a JSON envelope (`metadata.exit_code`) | `0.46.0` (764), `0.58.0` (1,114) | 1,878 rows |

Evidence quality is asymmetric and the floor does not overstate it: `0.116.0` through `0.125.0` contributed 219 rows and **zero** tool-result rows and **zero** `rate_limits` rows, so they are un-contradicted rather than positively proven. Positive proof of the modern text result shape (a header terminated by an `Output:` marker) starts at `0.128.0`.

**Below the floor the adapter reads nothing version-specific.** A below-floor session is not skipped and its files are still tailed; it loses exactly two measurements, and both degrade to honest absence rather than a guess:

| Below the floor | Result |
|---|---|
| Shell result exit code | `errored` stays absent, so the call lands in neither leg of the error rate |
| `rate_limits` window | No `agent.quota` window is emitted, so nothing is shown rather than a wrong reset |
| Sessions, prompts, tool calls, tokens, edit lines | Unaffected |

The first `session_meta` naming a below-floor version logs one warning per session to the daemon log, so a degraded capture is visible rather than silent. A `cli_version` that is absent, malformed, or fails the version-shape pin is **not** treated as below the floor: absence of a version is not evidence of an old one.

A call row with no `call_id` is dropped and emits nothing, because nothing could ever match its result to it. This is not a version rule, it is drift discipline: 0 of 43,522 call rows and 0 of 43,522 result rows in the corpus omit `call_id`, on any version including `0.46.0`.

---

## Honesty rules (load-bearing)

- Never blend a field a tool cannot supply into a cross-tool total
- `costUsd: null` and `[]` rollups, never `$0.00` or a silent zero
- **All derived USD is an estimate, for every tool.** We cannot detect subscription-vs-API billing for Claude Code or for Codex. `hasCost` means "tokens and model are present to derive from," never "this is a bill"
- A signal a tool cannot raise must not appear in that user's settings, not merely fail to fire
- `git.momentum` includes all agents for repos in the local registry, and also non-agent commits: the daemon sweeps on a timer with a synthetic session id
- A number covering only some sessions must say so. `coverageComplete: false` is the existing idiom (`types/usage-allowance.ts:48`); generalize it rather than hiding the number

---

## Remaining

- [ ] Public coverage page (`/capture`), rendered from the capability registry
- [ ] Inferred Codex session end, the one thing that would unlock its outcome legs (ship rate, line survival, `session_ended`)

Already shipped, so do not re-plan it: the capability registry plus worker gates, the D1 `agent` column (migration 0006), the Codex rollout tailer with deterministic byte-offset event ids, Codex install as a daemon toggle (`SEORAK_CODEX`, reported by `seorak status`) rather than a `settings.json` merge, Claude-only usage-allowance windows, OpenAI pricing rows, the web Agents surface, and manual `repo add` for the portfolio git sweep.

---

## Appendix A: the honesty matrix

Verdicts: **full** / **partial** / **none** / **unknown**. "None" and "unknown" are different cells and must never be conflated. Claude column is from this repo; Codex column is `0.142.5`, passive path, verified 2026-07-09 on one machine (interactive TUI, ChatGPT plan), except where a cell states its own later verification. `codex exec`, other versions, and API-key accounts are **unknown**.

### Session lifecycle

| Stat | Claude Code | Codex passive | Fair to compare | UI rule |
|---|---|---|---|---|
| Start, repo, cwd | full | full | yes | show |
| Agent version | partial (often literally `"unknown"`) | full (`cli_version`) | yes | show |
| Duration | full | partial (inferred from inactivity) | no | estimate label |
| End reason | full (6-value enum) | **none** | no | capability-gate hide |
| Turn boundaries | none | full (`task_started`, `turn_aborted`) | no | show |

### Tool calls and errors

| Stat | Claude Code | Codex passive | Fair | UI rule |
|---|---|---|---|---|
| Tool call count | full | full | yes | show |
| Tool mix (`byTool`) | full | partial (names collapse to `other`) | **no** | capability-gate hide |
| Tool call errored | **full** (both legs: `PostToolUse` / `PostToolUseFailure`) | partial (Shell only, from the result-header exit code; ApplyPatch and MCP get NO leg, their success-only rows would pin a fabricated 0%) | no | omit `errored` where a leg is unobservable; report `coverageComplete` |
| Verification pass rate | **full** (which-hook-fired is the result signal) | **none** (`exec_command` output is opaque; with hooks it would see passes only, pinning 100%) | no | gate on `toolResult === 'both'` |

Codex coverage is version-bound (measured 2026-07-14, `0.144.3`/`0.144.4`): the interactive TUI now routes all shell work through the `exec` JS sandbox, whose body carries no stampable exit code (CODEX-CAPTURE ADR-C14). A full week of rollouts held 2,526 sandbox results and zero `exec_command`/`shell` rows, so coverage on new sessions is ~0% and the error rate reads honest-null with its coverage disclosed.

**A rate needs both legs.** Claude's shipped pass rate was pinned at 0% because only failures were
recorded. Codex-with-hooks would pin at 100% because it can see only successes. This is why the capability
is `toolResult: 'both' | 'failures-only' | 'passes-only' | 'none'` and not a boolean, and why the collector
must **omit** `errored` rather than default it to `false` for any tool family whose failure leg it cannot
observe. Defaulting to `false` is how a tool with no error data reports a confident 0% error rate.

### Tokens, cost, headroom

| Stat | Claude Code | Codex passive | Fair | UI rule |
|---|---|---|---|---|
| Input / output tokens | full | full | yes | show |
| Cached tokens | full (read + write) | partial (read only) | only if both | show |
| Reasoning tokens | none | full | no | Codex-only |
| Context window | none | full | no | Codex-only |
| Model id | full | full (per turn) | yes | show |
| Cost (USD) | **estimate** | **estimate** | only if same billing basis | **estimate label** |
| Quota / headroom | authoritative, but **client-only** (behind an OAuth endpoint the collector does not read) | **authoritative, passive** | no | Codex-only in the worker |

### Edit lines, language, file category

| Stat | Claude Code | Codex passive | Fair | UI rule |
|---|---|---|---|---|
| Lines added / removed | full (LCS on tool payload) | full (`unified_diff` / `content`) | **yes** | show |
| Salted file id, dir id | full | full | yes | show |
| File category, language | full | full | yes | show |
| Edit success | full | full (`patch_apply_end.success`) | yes | show |

**This is the fairest comparison surface in the product.** Same units, same on-machine derivation, same trust boundary. If we ever compare two tools, it is here.

### Git outcomes

| Stat | Claude Code | Codex passive | Fair | UI rule |
|---|---|---|---|---|
| `git.momentum` (repo level) | full | full, free (daemon sweep, tool-independent) | yes | show |
| `session.delta` (did this session ship) | full | **none** (requires a session end) | no | capability-gate hide |
| Line survival | full | **none** (cursor is seeded at session end) | no | capability-gate hide |

Momentum is tool-independent and arrives before any adapter exists. Everything session-scoped requires an end event, which Codex does not emit. Until an inferred end ships, **Codex is an activity tracker, not an outcome tracker**, and the coverage page must say so.

### Intervention signals (the 8 shipped)

| Signal | Requires | Claude | Codex passive |
|---|---|---|---|
| `long_session` | lifecycle timing | fires | **fires** |
| `went_cold` | lifecycle timing | fires | **fires** |
| `session_ended` | session end | fires | cannot fire |
| `cost_spike` | per-call cost | fires (on an estimate) | cannot fire (per-session KV cost is per-call only; Codex's money is session-scoped) |
| `high_burn_rate` | per-call cost | fires (on an estimate) | cannot fire (same per-call input) |
| `daily_cost_cap` | daily spend | fires (on an estimate) | fires (session-scoped spend included in the daily total) |
| `stuck_loop` | per-call errored | fires | fires (consecutive errored same-tool runs; the cadence fallback stays Claude-only) |
| `first_error` | per-call errored | fires | fires (any `errored: true` call; Shell coverage only) |

**Codex honestly fires 5 of 8.** The catalog should become capability-shaped rather than uniform: a `quota_pressure` signal that only a `hasQuota` tool can raise, beside cost signals that only a billed tool can raise honestly. A signal a tool cannot raise must be filtered out of that user's settings entirely.

The trap here is closed: `hooks.ts` once stamped `errored: false` unconditionally for **any** adapter, which would have reported a confident 0% error rate for a tool with no error data. It now spreads `errored` only when the adapter reports a boolean, and the worker keys on presence, so an absent leg stays absent.

### Introspection facets

| Facet | Claude | Codex |
|---|---|---|
| Rhythm | full | full |
| Focus | full | full |
| Stack | full | full |
| Shape | partial | partial (no end reason) |
| Payoff | full | **none** until an inferred end ships |

### Live and ambient

| Stat | Claude | Codex passive | Codex + hooks |
|---|---|---|---|
| Session is live | full | full | full |
| Needs-you (permission prompt) | full | **none** | full (`PermissionRequest`, opt-in) |

### Three claims that must never appear on a public surface

1. **"Claude Code tracks everything."** `agentVersion` is often literally `"unknown"`. Cost is an estimate, not a bill. Its verification pass rate shipped pinned at 0% for months because we recorded one leg of a two-leg signal, and is a lower bound until the retention window rolls past 2026-07-09.
2. **"Codex is near parity."** It fires 5 of 8 signals, has no session end, and its error leg covers a share of work that trends to 0% on current versions.
3. **"Forecast which tool makes you more productive."** Out. Observed head-to-head on edit lines and tokens only, n-floored, and only for windows where both tools ran.

---

## Code anchors

| Area | Path |
|------|------|
| Adapter seam | `packages/collector/src/adapters/` |
| Lifecycle builders | `packages/collector/src/hooks.ts` |
| Claude adapter | `packages/collector/src/adapters/claude-code.ts` |
| Capabilities tests | `packages/collector/test/emit-allowlist.test.ts` |
| Agent + capabilities types | `packages/types/src/events.ts` |
| Worker capability gates | `packages/worker/src/capabilityGates.ts`; `overviewKvRollups.ts` `capabilitiesBySession` |
| Usage window gate | `packages/worker/src/eventlog/usage.ts:338` (`canCountUsageWindow`) |
| Idle reaper (closes any silent session) | `packages/worker/src/sessions.ts:147` |
| Deterministic-id precedent | `packages/collector/src/survival.ts:345` |
| Pricing table | `packages/types/src/pricing.ts` |

---

Last updated: 2026-07-14. The capability contract is defined by the principles,
honesty rules, Appendix A, and code anchors above.
