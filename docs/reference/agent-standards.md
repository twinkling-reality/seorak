# Agent and session standards

How AI agents (and human sessions) should work on Seorak. Product rules live in [CLAUDE.md](../../CLAUDE.md) and [voice-and-scope.md](./voice-and-scope.md). This doc is about **process quality** — intelligence, scalability, modularity, and honest reasoning.

---

## Core posture

Neither yes-man nor contrarian-for-its-own-sake.

| Do | Don't |
|----|-------|
| Ground claims in file evidence, tests, or docs | Guess from memory or pattern-match other products |
| State confidence (high / medium / low) when inferring | Present inference as fact |
| Challenge your own conclusion when evidence is thin | Argue against the user to seem rigorous |
| Spawn parallel review when stakes are high | Rubber-stamp a plan because it sounds good |
| Prefer smallest correct diff | Refactor adjacent code "while we're here" |

When unsure: read the code, read the spec, run the test, or launch a skeptical reviewer — then converge on a **definitive** recommendation or an explicit open question.

---

## Quality pillars (long-term)

Every session should leave the codebase **easier to extend**, not harder.

### 1. Trust boundaries

From [ARCHITECTURE.md](../ARCHITECTURE.md):

- Collector → worker **HTTP only**; depends on `@seorak/types` + npm, never worker/push/web.
- `@seorak/types` stays publish-safe — no secrets, no proprietary intervention logic.
- Worker owns extraction; web/mobile own presentation.

**Before merging:** grep for cross-package imports; confirm new fields flow types → worker → web schema (parity tests).

### 2. Honest-empty

Missing data stays absent. No zero-fill rates, no fabricated trends, no inferred "why" in replay or outcomes.

**Before merging:** check widgets and fallbacks. A malformed current-contract
refresh preserves the complete last-known snapshot as stale; a cold load shows
an explicit schema error. Never substitute an empty measured section. Narrow
enum or element isolation is appropriate only when it cannot fabricate a
current required field.

### 3. Modularity at the right layer

| Layer | Good split | Smell |
|-------|------------|-------|
| Packages | collector / types / worker / surfaces | Worker importing collector |
| Worker | `eventlog/*`, `replay.ts`, route handlers | 1000+ line god files adding unrelated features |
| Web views | Pure `.ts` logic + tested hooks + thin components | 600-line view shells mixing DnD, fetch, and chrome |
| Surfaces | Shared `@seorak/types` contracts | Duplicate zod shapes drifting from types |

Extract shared UI (e.g. `ProjectDropdown`) when a pattern appears twice — not before.

### 4. Scalability awareness

Known v1 ceilings (document before widening distribution):

- D1 event log: append-only; a 400-day prune ships, but nothing older is recoverable
- Push delivery: D1 device projection and leased outbox; production APNs lifecycle
  still requires signed-artifact and physical-device proof before public TestFlight
- D1 session projection: independent transactional rows, deterministic keyset
  pages, and production-shaped operation-budget coverage beyond 10k sessions
- Intervention cron: ~10 min floor
- Overview build: op-budget tested; monolith growth is the main regression vector

New aggregates belong in modular builders with budget tests — not bolted onto `overview.ts` without a plan.

### 5. Equal surfaces

Same buyer, same control plane. If mobile ships a setting, web should too — or STATUS and vision copy must say web is intentionally read-only.

Internal symbol: `SEORAK_SIGNALS`. User-facing copy: **stat** (see voice-and-scope).

**No middot separators in UI copy.** Do not use `·` (middle dot) to join facts in dashboard or Model presentation prose, widget labels, annotations, or breakdown captions. Use commas, **and**, separate sentences, or line breaks instead. Wrong: `across 3 repos · 28 sessions`, `Evening · Closer`. Right: `across 3 repos and 28 sessions`, `You run most sessions in the evening, and you usually close the chat.` Marketing `<title>` tags and internal doc lists may still use middots; product surfaces must not.

### 6. Vision alignment

Three jobs ([VISION.md](../VISION.md)): period clarity, developer model, away oversight. Support systems (session stat, intervention nudges, replay) serve those jobs.

- Keep the product loop human-directed: Insight supplies evidence, Intervention
  applies boundaries the developer chose, and Introspection helps the developer
  decide what to change. No measured pattern automatically becomes a setting,
  playbook, recommendation, or change to a future agent.
- Do not imply the developer model is complete ("Seorak learned your patterns") beyond what `GET /developer-model` measures.
- Treat API/MCP, the public profile, and the project gallery as extensions of
  the private performance record, not a new peer mission or a generic social
  network. Public activity is not a person grade or proof of productivity.
- Do not pull long-term roadmap bets into current work before their stated
  sequence or explicit activation. The API/MCP and public-directory backend
  foundation is now active; do not turn that into a UI, hosted-availability, or
  automatic-publication claim before the remaining trust and rollout gates are
  operated. Do not build parked bets (away control plane or paid Pro) to invent a
  tier.
- Capture-only fields (`branchWorkType`, `repo.toolchain`) get projections or stay deferred in specs.

### 7. No indefinite legacy paths

Delete superseded aliases, exports, fixtures, readers, and compatibility branches
once their replacement and data cutover are proven. Do not keep versionless or
speculative compatibility code for clients that the repository does not support.

Temporary migration code must name its removal condition, have a verification
gate, and be deleted as soon as that condition is met. Applied database migrations
remain immutable, which is why `migrations/0006_add_agent.sql` still carries a
comment pointing at a `.port/` file: applied migrations cannot be edited, so a
historical citation stays even after the document it names is promoted or
deleted. It is not a build, runtime, or documentation dependency. The committed
capability contract is [specs/multi-tool.md](../specs/multi-tool.md).
Accessibility, platform-availability, cache, and honest-error
fallbacks are product behavior, not legacy code, and stay when their failure mode
is still real.

---

## Session workflow

1. **Read** — `VISION.md`, relevant spec, `STATUS.md` for the area touched.
2. **Locate** — find the contract (types), extraction (worker), and surface (web/mobile/etc.).
3. **Verify** — tests, grep, diff; note what is stubbed vs shipped.
4. **Challenge** — for architecture or multi-file work, ask: what breaks at scale? what violates honest-empty or boundaries?
5. **Decide** — one clear recommendation with evidence; list open questions only where code/docs genuinely conflict.
6. **Update docs** — `STATUS.md` when ship status changes; living specs in `docs/specs/` when ship status changes.
7. **Commit** — one commit per logical unit of work, only when the user asked for commits or the session prompt explicitly authorizes them (see below).

---

## Commits

Follow repo history (`git log --oneline`). **Only commit when requested** — session prompts may authorize auto-commit per stage.

| Rule | Example |
|------|---------|
| **Single line** | No multi-paragraph body; no bullet lists in the message |
| **Conventional prefix** | `feat(scope):`, `fix(scope):`, `refactor(scope):`, `docs(scope):`, `style(scope):`, `test(scope):` |
| **No em dash** | Use commas, "and", or rephrase — not `—` or `--` in the subject |
| **No co-author trailer** | Never append `Co-authored-by:` or similar |
| **`Overlay-Drift-Ok:` is the one permitted trailer** | `npm run overlay:check` fails a commit that edits one half of a split file without the other, and accepts `Overlay-Drift-Ok: <reason>` with a real reason. A commit carrying it is correct, not a violation of the row above. A bare flag with no reason is not an escape, and it must not be used to avoid writing the public half of a change that belongs in both |
| **Scope matches touch area** | `worker`, `web`, `collector`, `mobile`, `push`, `docs`, `replay`, etc. |
| **Why over what** | `fix(collector): align daemon settings sync with read key fallback` not `update capture-settings.ts` |

Good: `feat(worker): add D1 event retention cron with 400 day window`

Bad: `feat(worker): add retention — prunes old events` (em dash)

Bad: `fix stuff` (no scope, vague)

Before each commit: `git status`, `git diff`, relevant tests green. After: `git status` to verify.

---

## Delegated stages

Work is often split into stages, each run by a separate session against its own
worktree, with one orchestrator verifying and integrating. **A brief may say
"follow the delegated-stage rules" instead of restating what is below.** It is
here rather than in each prompt because three consecutive stages once missed the
commit rules, which were at the bottom of a long brief.

### Isolation

Take your own worktree and branch off `main`, and **STOP AND REPORT if either
already exists** rather than reusing it. Two sessions once shared one worktree
and neither could trust `git status`. Sessions run in parallel: another may hold
files you can see, so touch only what your brief assigns.

### The deliverable is usually a check, not a report

A finding written into a document is true the day it is written and decays from
there. A finding a gate can re-derive cannot rot, and cannot recur silently. Where
a stage could produce either, produce the check and let it report.

This is measured rather than asserted: over one week, the stages that produced
gates found eighteen user-visible defects between them, and the stages that
produced prose found none that outlived the document.

A gate earns its place by failing. Before claiming one works, **break the thing it
guards and show the non-zero exit**, then restore. A gate nobody has broken is a
hypothesis, and one that cannot fail on its highest-risk input is scenery.

### Wire it where it runs

Three gates in this repository shipped reachable only through a script the
workflow did not run. All three were green while covering nothing. A new gate goes
into the workflow **and** the root test script, and something should compare the
two rather than trusting a person to keep them in step.

### A suite that spawns git must isolate the environment

Spawn git through `scripts/isolated-git.mjs` (`gitSync`, `gitSpawn`, `gitAsync`),
never by naming the binary. `npm run git-isolation:check` fails a file under
`scripts/` that names it directly, so this is enforced rather than remembered.

The reason is not style. Git exports `GIT_DIR`, `GIT_WORK_TREE`,
`GIT_INDEX_FILE` and `GIT_CONFIG_*` into every hook it runs, and **those beat a
child process's `cwd:`**. The pre-push hook runs the gate set, and the gate set
runs the suites here, so a suite that makes a temporary repository and then
`init`s, `config`s or `add --force`s inside it is acting on the developer's
repository instead. Ten suites did.

What it costs, measured 2026-08-07: one push left `core.hooksPath` pointing at a
temp directory deleted seconds later, and `core.bare = true`. A dangling
`hooksPath` means **every later push runs no hook and says nothing**.
`core.bare = true` means `git rev-parse --show-toplevel` fails, which is line 13
of the hook under `set -e`, so pushes die with a bare `fatal:` and no gate
output. Five cheap-tier gates were failing inside the hook and passing outside
it, which reads as flakiness rather than as a cause.

**This is the failure mode to be most afraid of, and it is why the rule is
here rather than in a comment.** It disables the thing that would have caught
it, so the evidence that something is wrong is the absence of evidence. It
survived a day of investigation on exactly that. When a gate behaves differently
inside a push than outside one, suspect the environment before the gate.

### Stop and report

Stop when the brief's premise turns out to be false, when a decision belongs to
the owner, or when finishing would require a choice the brief did not authorise.
**A refused stage that explains why is worth more than a completed one built on a
wrong premise**, and this has been right every time it has happened: the premise
was wrong, not the executor.

Do not repair a falsified justification so that it reads as unfalsified. Say it
fired.

### Commits

The Commits section above applies in full. Two rules are missed most often:

- **Commit before reporting.** Finished work left uncommitted is work the next
  session cannot see. Confirm `git status` is clean and say so.
- **Inspect the full staged diff before each commit**, not the file list.

A trailer is permitted where a gate requires one to record a deliberate
exception, and it must carry a real reason. The single-line rule governs the
subject, not a trailer a check reads.

### What the orchestrator owns

The document that records what is left, and the merge. Do not edit the
plan-of-record document from a stage: several stages editing one table is how
merges conflict for no reason. Report the outcome and let it be folded in.

---

## Red flags (stop and investigate)

- New user-facing number without a worker measurement path
- Demo or fallback data on the live path in production
- `createEmptyOverview` (or equivalent) masking a schema mismatch
- Feature added to only one surface without STATUS update
- Copy using "signal" where the user sees a dashboard **stat**
- Middot (`·`) separators in user-facing UI or Model presentation copy (see §5)
- Capture field written to D1 with no projection story
- Compatibility code with no supported caller, removal condition, or cutover test

---

## Related docs

| Doc | Use when |
|-----|----------|
| [VISION.md](../VISION.md) | Product north star |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Package boundaries, data flow |
| [STATUS.md](../STATUS.md) | Shipped vs planned |
| [voice-and-scope.md](./voice-and-scope.md) | Copy and out-of-scope |
| [specs/multi-tool.md](../specs/multi-tool.md) | Adding a second capture tool |
