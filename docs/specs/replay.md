# Replay

Keyframe review for past sessions — support for **period clarity**. Parent: [VISION.md](../VISION.md).

Replay answers three questions:

- What happened?
- Where did attention spike?
- What is worth revisiting?

It is not a dashboard, transcript playback, terminal recording, or token-by-token trace.

---

## Contract

Replay is fetched per session with `GET /replay/:sessionId`. It is intentionally not part of `OverviewSnapshot`.

Code anchors:

- Types: `packages/types/src/replay.ts`
- Worker extractor: `packages/worker/src/replay.ts`
- Web transforms: `packages/web/src/views/ReplayView/replayTransforms.ts`
- Web scope: `packages/web/src/views/ReplayView/replayScope.ts`

The payload has three review surfaces:

| Shape | Use |
|-------|-----|
| `keyframes` | The handful of moments worth reviewing |
| `activity` | Fixed-width throughput buckets for the stage |
| `moments` | Content-free rows near the scrubber playhead |

Every row must be backed by a captured event. Missing data stays absent or empty; Replay never invents markers, counts, reasons, or trends.

### Read bounds

The route resolves the authoritative session projection before reading retained
events. Missing or synthetic sessions and sessions outside the plan's readable
history return the same `404` as Session Detail without scanning their event
streams.

For a readable session, the worker counts only replay-relevant event kinds inside
the projection's `startedAt`–`lastEventAt` bounds. It refuses more than 10,000
rows with `413 replay too large` before loading payloads. The payload query also
uses `LIMIT 10001` as a concurrent-ingest guard.

Replay never truncates. A partial timeline could understate totals and move the
apparent session bounds, so an explicit unavailable response is the only honest
capacity failure.

---

## Publish-Safe Boundary

Replay may show derived labels, counts, timings, tool names, status, cost, token totals, and event categories.

Replay must never show:

- Prompts
- Commands
- File paths
- Diffs
- stdout or stderr
- Commit messages

This boundary applies to worker labels, web narrative copy, tooltips, legends, docs examples, and tests.

---

## Shipped Keyframes

| Kind | Backing event |
|------|---------------|
| `session-start` | First `session.start` |
| `first-tool-call` | First `tool.call` |
| `first-error` | First `tool.call` with `errored === true` |
| `verification-failed` | First failed verification event |
| `peak-burn` | Highest-cost tool-call moment |
| `biggest-commit` | `session.delta` commit milestone |
| `session-end` | `session.end` |

`biggest-commit` uses commit/file counts, not raw LOC or content.

---

## Web Behavior

Scope is controlled by URL params:

| Param | Meaning |
|-------|---------|
| `projects` | Comma-separated project ids; absent or empty means all projects |
| `range` | 1, 7, 30, or 90 days; absent means today |
| `sessions` | Comma-separated session ids inside the current project/range scope |
| `q` | Question mode for the review console queue (`summary`, `attention`, `review`) — also toggled in-console |
| `focus` | Project drill-down (project level) |
| `session` | Session drill-down (session level) |
| `compare` | Up to two session ids selected for side-by-side comparison |
| `lens` | The open lens id; absent means the sheet is closed |

Customize means scope: projects, range, and selected sessions. It does not mean visualization settings. Stage render mode lives with the playback controls, not in Customize.

### Picking sessions at period scale

A 90-day range can hold hundreds of sessions, and the default selection is all of them.

- **Filter, then take.** The picker's master control sits in the table header's last cell, directly above the column of toggles it commands, and acts on **what the filter is showing** — sessions the filter hid keep whatever state they had. "Only these" is therefore clear → filter → take, in standard table order, rather than a second control that means something subtly different from the first. It reads mixed while part of the shown set is selected, because a master toggle showing "off" over a partly-selected set is a small lie.
- **The strip states the selection** (`12 of 418 selected`). At a handful you can count the toggles; at hundreds you cannot, and the master control needs its effect to be legible.
- **Search covers every column the row shows**, including the project name. It had covered status, agent, tool, recency, tokens, cost, calls, and duration — but not project, which is the first column and the first thing a reader with several projects types.
- **Replay payloads load through a bounded pool** (`pooledMap`, six in flight) and are drawn as they land. One request per selected session, all issued at once, is a thundering herd against D1 at period scale and leaves the stage blank until the slowest returns.

The selection itself is **not** capped to make the fetch cheaper. Taking "the most recent N" would move the scope origin to the newest of them, so a 90-day read would draw a six-day chart still labelled 90d — the same failure the worker's no-truncation rule exists to prevent, one level up. Instead the scope stays whole: a session with no payload yet still contributes its summary totals, and `scopeLoadNote` states the coverage while it fills.

The list is not virtualized. At a few hundred rows the filter and search reach what you want before the row count is what hurts; if a real scope gets far past that, virtualize then rather than on speculation.

### Levels

Replay reads at three levels, all in the URL so a read is shareable:

| Level | URL | Question |
|-------|-----|----------|
| Period | no `focus`/`session` | What happened across the range? |
| Project | `?focus=repoId` | What happened in this project? |
| Session | `?session=sessionId` | What happened in this session? |

Each level narrows the stage's series **and** its timeline, so drilling in is also a zoom. The header breadcrumb is the way back out.

### Timeline origin

The stage timeline has **one origin — the earliest session start in scope** — and every elapsed value downstream (chart points, stage markers, review items, playback stop targets) is measured from it.

This is the load-bearing rule. Keying each session to its own start superimposed every session at x=0 and set the axis length from the single longest session, which crushed a day of short bursts into a hairline and left "where did attention spike" with no representation at all. For a single-session scope the origin **is** the session start, so single-session replay is unchanged.

The playhead runs on the scope clock; each session reads it on its own clock (`toSessionElapsedMs`). A session that had not started yet contributes nothing to playhead stats, and an ended session stops contributing a bucket delta.

The timeline also carries a **span per session** (`sessionSpans`, scope-relative start and end), which is what `sessionsRunningAt` reads for concurrency. A session with no captured end is bounded at its **last capture**, never at now — claiming it ran through a stretch with no events behind it would invent the part we cannot see.

### Stage

- Custom SVG stage (`ReplayTimeStage.tsx`), plus domain-free window math in `components/viz/time/timeWindow.ts`.
- **Render modes:** `lines` (one line per series) or `lanes` (one named band per series). Lanes are the default above 5 series, because hashed project hues are not separable at that density and series identity must not be color-only. The toggle is hidden with a single series.
- **Focus window:** an overview strip under the axis shows the whole scope — aggregate activity plus attention-tick density — and drag-brushes a focus window; dragging the band pans it. `+` / `-` zoom around the playhead, `0` resets, `PageUp` / `PageDown` page. **Full range** appears in the control row only while zoomed.
- **Window-scoped normalization:** the y-axis normalizes to the largest value **inside the window**, not the whole scope. One peak-burn bucket used to divide every other series down to the floor; rescaling to what is on screen makes zooming into a quiet stretch pay off. In lanes mode each lane also prints its own peak on that shared 0–100 scale, so a quiet lane still reports a number.
- **Gaps break the line.** Activity buckets are contiguous inside a session (a quiet bucket is a real zero), so a gap wider than one bucket width means no session was running. Drawing across it would invent activity, so the path breaks instead.
- **Marker rail:** markers bin into fixed columns carrying a count and the highest-priority tone in the bin. Each bin is still backed by real markers; hover names the count and how many need attention. Ungrouped, a period-scale scope drew hundreds of 2px ticks as an unreadable dust cloud.
- **Hover has a distance ceiling.** A series only reports a value when its nearest bucket is within one gap threshold; otherwise it is omitted rather than reporting a bucket hours from the cursor.
- The x-axis labels switch from elapsed to an absolute stamp past ~6 hours of scope (time → weekday → date), because past a few hours the reader wants to know *when*.
- Hover inspects without scrubbing; click/drag scrubs. The plot is the ARIA slider: arrows scrub, `Home`/`End` jump to the scope bounds, and the focus window is announced in `aria-valuetext`.
- Playback runs at review speed over the **focus window**, not the whole scope, and turns pages when the playhead leaves the window rather than scrolling continuously — so the shape inside a page holds still and normalization only rescales at a page turn.
- Stop picker trigger reads **Continuous** (no auto-pause) or **Auto-pause, Highlights** / **Auto-pause, All moments** with a pause icon. Menu hints explain each mode; **Continuous** stays available for shape-watching without interruption.

### Cockpit layout

Replay fills the viewport from its own top edge down and **does not scroll the page**. Three surfaces that serve different moments were previously stacked as vertical peers, which pushed the stage off screen exactly when you were scrubbing it.

```
scope tray, projects, customize, ask, summary, lens ▾, range
┌──────────────────────────────┬──────────────┐
│ stage (grows)                │ inspector    │
│ marker rail, axis, strip     │ (scrolls in  │
│ legend                       │  place)      │
├──────────────────────────────┴──────────────┤
│ transport                                   │
└─────────────────────────────────────────────┘
```

- The **inspector** is the review console: clock, playhead readings, queue filter, event list — one flex column, docked beside the stage so scrubbing never loses the reading. It scrolls internally. It is written as its own composition rather than restyling a two-column grid, because overriding grid placement to fake a column is one specificity slip away from the filter control landing on top of the stats.
- The **lens sheet** slides up over a dimmed stage. It is a near-solid surface, not glass — the design language keeps large content surfaces near-white so evidence stays legible, and a frosted panel under a dense table makes the reader fight the chart for contrast. `Escape` closes it.
- The transport carries playback only. Lens choice moved to the scope tray, where the other scope decisions already live.
- The cockpit claims the shell's **end-of-read bottom padding**. That 88px is breathing room at the end of a scroll; a surface that never scrolls cannot use it, and `useViewportFill` honestly reserves it, so it read as dead screen under a stage that wanted the height. Replay's `.page` pulls its bottom edge into that padding and leaves a 24px gutter — gated on the same thresholds the hook pins at, because below them the page scrolls again and a scrolling page still wants the full padding. It lives in Replay's own CSS rather than as a shell modifier so the `DashboardApp` chunk does not grow for it.
- The **stop picker opens upward**. It sits in the transport, on the bottom edge of a cockpit that clips its own overflow, so a menu hung below the trigger rendered past that edge and was invisible — the control read as dead while all three modes were still there.
- `useViewportFill` measures both what sits above the cockpit and what the page renders *below* it — following siblings plus every ancestor's bottom padding, border, and margin. Reading `document.scrollHeight` does not work: the shell sets `min-height: 100vh`, so the document never measures shorter than the viewport and the slack is invisible. The content wrapper's 88px bottom padding is exactly how much the page scrolled by before this accounted for it. Below 900px wide or 640px tall the hook returns null and the view falls back to normal document flow — pinning a tall stage on a small screen is worse than letting the page scroll.

### Playhead readings

The inspector reads in two tiers, because a running total and an instantaneous rate answer different questions and had been given the same weight.

**At the playhead** — the readings that exist *only* because there is a playhead:

| Reading | Backed by | Absent when |
|---------|-----------|-------------|
| **Burn now** (`$/min`) | The activity bucket the playhead is **inside**, summed across live sessions | No live session is inside a measured bucket, or every live one is unpriced |
| **Running** (`n of m`) | `sessionSpans` covering the playhead | Hidden at a single-session scope, where `1 of 1` is noise |

`bucketContainingElapsedMs` is deliberately not `bucketAtElapsedMs`: the clamped lookup is right for a running total and wrong for a rate, because past a session's end it would keep reporting that session's final burst as if it were still burning. A host that cannot price its work reports `costUsd: null` on the session; its buckets still carry `0`, so it is excluded from the rate rather than printed as `$0.00/min`. When nothing was running the pane says so in a sentence — a stretch between sessions is a reading, not a blank.

**Through here** — running totals from the scope origin, as a compact ledger rather than stat cards. Six rows fit in less room than four cards did, and the list keeps the height it had.

| Row | Also carries |
|-----|--------------|
| Cost | Bucket delta, and the share of the scope's measured spend landed by here |
| Tool calls and tokens | Bucket delta |
| Errors | Tool calls with `errored === true` at or before the playhead |
| Checks failed | `n of m` verification runs; `—` while none has run, since `0 of 0` reads like a clean run |
| Messages sent | `session.prompt` rows at or before the playhead |

**A row appears when the scope captured something behind it.** `0 errors` is a real absence once tool calls are being logged and a claim we have no right to make when they are not, so `ReplayNowModel.captured` states what the stream actually carried and the last three rows are gated on it.

The clock names the wall-clock instant once the scope passes ~6 hours — the same threshold the axis switches on — and stays elapsed-only below it.

Deliberately **not** playhead readings: a per-project split at the instant (the stage already draws one line or lane per project, and the legend names them — a bar chart of the same thing at lower fidelity is duplication), and any "is it waiting on you right now" state, which would infer agent state from the gap between two captured events. The `interruptions` lens measures that gap honestly instead.

Cumulative counts are indexed once per scope (`ReplayNowIndex`) and read with a binary search, because the playhead moves every animation frame and a scope runs to 10,000 rows.

### Summary

**Summary** is a glass chip in the scope tray and opens the **same annotated reveal Overview opens** (`PeriodClarityReveal`): a bottom-fade dialog whose numbers are hoverable terms backed by facet notes with connectors and citations. Replay compiles its own `PeriodClarity` via `compileReplayClarity`; Overview compiles one from `OverviewSnapshot`. One component, two compilers — a second, flatter prose path would drift out of agreement with the first.

The old clickable summary stats are gone. Jumping to a moment belongs to the lens rows and the inspector queue, which scrub directly; the Summary read explains what the numbers mean instead of doubling as navigation.

---

## Lenses

A **lens** is a self-describing question over the replay payload plus a pure function that answers it as plain serializable data. The split mirrors the widget catalog: `ReplayLensDef` carries `id`, `name`, `description`, `question`, `viz`, `dataKeys`, `levels`, `windowed`, and `emptyHint`; `computeReplayLens(id, input)` returns a `ReplayLensResult` of rows.

Nothing under `lenses/` may import React or touch the DOM. The cockpit renders a result; a future `GET /replay/lenses/:id` or MCP tool returns the same object verbatim, so an agent reads exactly what a person reads. Compute lives in `packages/web` rather than `packages/types` because that package is publish-safe only and excludes evaluation implementation — when the worker grows the API, these functions move there unchanged.

Code anchors: `packages/web/src/views/ReplayView/lenses/`, rendered by `sheet/ReplayLensView.tsx`.

### Forms

One renderer per form, driven entirely by the result — there is no per-lens JSX.

`ranked-bars`, `timeline-marks`, `distribution`, `table`, `stat-grid`, `compare-rows`

### Catalog

| Lens | Answers | Reads | Levels |
|------|---------|-------|--------|
| `tool-mix` | Which tools ran, how often, how many errored | `toolName`, `errored`, `costUsd` | all |
| `cost-concentration` | Where measured cost went, by tool | `costUsd`, `toolName` | all |
| `file-touch` | What kind of files the work touched | `fileCategory`, `fileLanguage` | all |
| `rework` | Work the agent changed back | `undoKind` | all |
| `verification` | Whether checks went red, and came back | `verificationKind`, `verificationPassed` | all |
| `interruptions` | How often it stopped for you, and how long it waited | `notificationType`, `at` | all |
| `cadence` | Bursts versus stalls | `at` | all |
| `projects` | Every project in the period | totals, keyframes | period |
| `sessions` | Every session in scope | totals, keyframes | period, project |
| `session-detail` | Totals plus keyframes for one session | totals, keyframes | session |
| `session-compare` | Two sessions side by side | totals, keyframes | project, session |
| `period-compare` | This range against the previous one | session summaries | period |

`fileCategory` and `fileLanguage` had shipped from the worker on every tool-call moment and were rendered nowhere; `file-touch` is where they surface.

### Discovery

Lenses are grouped by the question they answer — Replay's own three — and both pickers render those groups from `lensGroupsForLevel(level)`. Grouping is compute, not markup: a question with no lens at this level is omitted rather than heading an empty list, and adding a lens to `catalog.ts` adds it to every picker.

| Surface | Role |
|---------|------|
| **Lens menu** in the scope tray (`L`) | Entry. Names every lens for this level with what it answers, under its question |
| **Rail** inside the sheet | Switching. The same grouped catalog beside the result, so comparing two lenses is one click |

**The two are never on screen together.** They render the same groups from the same catalog, so a menu opened over the sheet paints a second identical copy of the list the rail is already showing. The tray trigger therefore toggles the whole lens surface, not just its menu: with nothing open it opens the menu; with a lens open it closes the sheet, and takes the engaged fill and the raised chevron so it states which of the two it will do. `L` follows the trigger.

The old tray was a flat row of pills in the transport: at the far end of the screen from every other scope decision, unreadable past about a dozen entries, and silent about what any lens answers. The menu carries a one-line description per row and is sized so all three questions are visible at once — a menu you must scroll to discover "Where attention spiked" is the flat tray again with extra steps. The full sentence, written for a reader who cannot see the screen, stays in the row's title and the sheet header.

Picking the open lens again closes it: the trigger toggles the sheet rather than being a one-way door into it.

### Lens rules

- **Windowed lenses report the focus window.** The seven analytic lenses re-read for whatever the stage is zoomed to, so brushing a burst also asks "what was this burst made of". The structural lenses are scope-level. Every result states its own `coverage`.
- **Honest-empty carries a reason.** A lens with nothing behind it explains *why* it is empty and distinguishes absence from missing capture: `rework` says nothing was changed back is "a real absence, not missing capture", while `tool-mix` says tool-call logging fills it in.
- **No invented buckets.** `file-touch` groups by category, falls back to language when capture derived no category and says so, and never creates an "uncategorized" bucket for moments that have neither.
- **A wait is a measurement.** `interruptions` measures the gap from a stop to the next captured moment in the same session. When the stop is the last captured moment, the wait is absent rather than estimated.
- **A gap never crosses a session boundary** in `cadence` — that gap would just be time you were not working.
- **Zero draws as zero.** A distribution band with no members takes no width; a minimum sliver would draw nothing as if it were something.
- Period comparison folds **session summaries**, not replay payloads, so a range comparison does not need every replay loaded. The headline says so.
- A percentage against a zero baseline is not a number: a metric with no previous value reads `new`, and a window with no earlier sessions says so instead of showing `+100%`.
- Only **attention** and **uncommitted files** carry a direction. Cost, tokens, elapsed, tool calls, and messages are reported without a verdict — more spend is not by itself worse, and Seorak does not grade the developer.

### Lens interaction

A row either names an instant or names a scope object. Rows with `elapsedMs` scrub the stage; rows with a `target` open that project or session. Inside `sessions` at project level a row instead picks for comparison, because that is where the compare pair is chosen.

Summary prose uses Metric tones to link numbers to chart semantics (same pattern as detail-view answers). Stats with a backed action show a hover highlight and jump locally:

| Stat | Action |
|------|--------|
| Sessions | When a project is focused (`?focus=`), scroll to the session table below |
| Cost / tokens | Return to chart and scrub to the first peak-burn keyframe |
| To revisit | Set queue to Revisit and scrub to the first highlight |
| Need attention | Set queue to Attention and scrub to the first alert or peak (summary says "tool errors or cost spikes") |
| Commits | Set queue to Revisit and scrub to the first commit highlight |
| Tool calls | Return to chart and scrub to the first tool-call moment |
| Steering ticks | Return to chart only (prompt text is not in the contract) |
| Follow-ups / messages | Return to chart only (counts `session.prompt` rows as messages to the agent, not prompt text) |
| Uncommitted files | Return to chart and scrub to session-end when that stat is present |

Project count is plain prose (not clickable). Stats without a backing target return to the chart without scrubbing.

### Review console

Below the stage:

| Pane | Role |
|------|------|
| At the playhead / Through here | The two tiers above, plus the moments nearest the playhead |
| Review path | Clickable highlight queue; filtered by `?q=` at display layer only |
| Session bounds | Neutral lifecycle bookmarks (`session-start`, `session-end`) — not highlights |

In the cockpit this renders as the docked inspector: the instant pair reads at display scale, the ledger below it in mono, the queue filter uses each mode's `shortLabel`, and the list takes the remaining height instead of a viewport-relative cap. The sessions table moved into the `sessions` lens.

Ask opens the stat chat panel from scope controls (stubbed). Question modes filter the highlight queue at display layer only; playback stop targets stay mode-agnostic. Overview / Attention / Revisit toggles in the review console sync with `?q=`.

`ReplayTotals.promptCount` counts human steering ticks (`session.prompt` envelope rows) — no prompt text.

`ReplayTotals.filesTouchedUncommitted` comes from the session's `session.delta` row when present — distinct uncommitted files at session end, not raw LOC.

`ReplayMoment.fileLanguage` is the language family of an edited file when capture derived it — same publish-safe pattern as `fileCategory`.

The throughput index is not in the public replay contract. It currently combines cost, tool calls, and tokens in `replayTransforms.ts`; long-term this may become a named worker-derived metric if a second surface needs the same normalization. `buildChartData` returns **raw** index values — the stage normalizes to the focus window, so normalization is a render-time concern and never bakes a scope-wide max into the data.

---

## Copy Rules

- User-facing copy says **stat**, not "signal".
- Empty states should explain absence honestly.
- Do not explain inferred "why" unless the contract has a backed event for it.
- Narrative modes stay question-shaped: "What happened?", "Where did attention spike?", "Which sessions need review?"
