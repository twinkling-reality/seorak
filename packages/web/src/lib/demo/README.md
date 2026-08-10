# Demo data

One source of truth for every fixture rendered in the dashboard under `?demo`.
Each scenario returns an `OverviewSnapshot` and, when the Model tab should
change, a matching `DeveloperModelSnapshot`. There are no team, global/rank,
reports, memory, or conversation fixtures: those product surfaces do not exist
in Seorak.

Scenarios are **product claims** (insight · intervention · introspection ·
honesty), not only widget coverage switches.

## How it works

1. The `?demo` URL flag (or any dev build) shows two surfaces:
   - **Popover**: the bottom-right scenario switcher (`components/DemoSwitcher`).
     Grouped by category, with plain-English summaries.
   - **Browse page**: `/demo` (`views/DemoView`). The full table of every
     scenario with category / dimensions / affects-views columns.
2. Picking a scenario writes the id to the URL and dispatches a
   `seorak:demo-scenario-changed` event.
3. Consumers subscribe to that event and short-circuit their network calls when
   demo is active:
   - `useOverview` reads the active scenario's `OverviewSnapshot` instead of
     fetching `GET /overview`.
   - `useDeveloperModel` reads the scenario's `DeveloperModelSnapshot` instead
     of fetching `GET /developer-model`.
   - `lib/stores/polling` re-runs its poll (which resolves to the demo snapshot)
     on the event so a scenario swap updates without a reload.
4. Each scenario builder returns a `DemoData`
   (`{ overview: OverviewSnapshot; developerModel?: DeveloperModelSnapshot }`).
   No widget reads mock data from anywhere outside `lib/demo/`.

## Files

| File           | Role                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `scenarios.ts` | Registry. `DemoData` shape, scenario builders, `getDemoData(id)`. The only file to edit to add a scenario.                                     |
| `baseline.ts`  | The "Working right now" payload. Builds live `SessionSummary[]`, derives the current-state aggregates, and — DEMO ONLY — fills the event-log / deep-capture fields with synthetic data. |
| `developerModel.ts` | Model tab fixture from the same seeds as `baseline.ts`. Evening-heavy cadence + focus rollups so the compiler yields a populated portrait. |
| `interventions.ts` | Fired watches derived from live seeds (stuck → `stuck_loop`, idle → `went_cold`, spend → `cost_spike`). Catalog copy only. |
| `replay.ts` | Per-session replay keyframes for the Replay view (capability-shaped). |
| `empty.ts`     | `createEmptyOverviewDemo()`: the honest empty `OverviewSnapshot` (zero sessions, empty arrays, null cost) for the empty-state scenarios.       |
| `rng.ts`       | Deterministic helpers (`wobble`, `hash`, `allocateIntegerShares`, `buildDaySpine`, `weekdayWeight`). Keep fixtures stable across refreshes.    |
| `index.ts`     | Public surface. Components import from here, not from the internal files.                                                                      |

## Honesty: demo vs live

`baseline.ts` is the one sanctioned place for fabrication. The
baseline/healthy scenario (and the `solo-cc` / `high-cost` variants spread from
it) INTENTIONALLY fill every event-log / deep-capture field —
`dailyTrends`, `hourlyDistribution`, `byTool`, `endReasons`, `stuckness`,
`oneShotRate`, `byModel`, `errorRate` — with deterministic synthetic data so
`?demo` can exercise each widget's populated state against the design.

Fabrication is still **capability-shaped**: agent capability objects are copied
from `CAPABILITY_REGISTRY` (never hand-authored). The healthy baseline includes
a Codex live session and a second `tools.byAgent` row; Codex is priced via the
`session.tokens` carrier (`hasTokens` / `cost: 'estimated'`), with fair edit
lines and a partial error leg. `solo-cc` remains Claude-only (single `byAgent`
row).

The **never-synthetic** rule applies to the LIVE path only: the worker
`/overview` endpoint and `useOverview` must ship honest empties (empty arrays /
null, never zero-filled) for those fields. They stay empty until the worker
retains an event log (daily trends, hourly heatmap, end reasons) and the
collector emits deeper per-call / per-model capture (per-tool split, per-model
spend). Demo richness never leaks into live. The `empty` and `no-live-sessions`
scenarios model that honest empty state.

The live sessions board is an explicit demo fixture and may be populated; the
current-state aggregates (`usage.totals`, `usage.cost`, `usage.projects`,
`activeCount` / `endedCount`, `tools.callStats.totalCalls`) are DERIVED from
those sessions in every scenario.

## The scenarios

| ID                 | Category     | What it asserts                                                                                       |
| ------------------ | ------------ | ----------------------------------------------------------------------------------------------------- |
| `healthy`          | baseline     | Working right now: multi-repo live + look-now states, dual-agent honesty, Model portrait. Reference dataset. |
| `empty`            | empty-states | A new account with zero activity. Every widget shows a real empty state, never a fake zero or ghost.  |
| `solo-cc`          | coverage     | One session on Claude Code in one repo. Live board shows a single row; totals reflect that session.   |
| `no-live-sessions` | empty-states | No sessions running; window history remains so Overview/Model stay populated. |
| `high-cost`        | outcomes     | Window spend scaled 3.2× across live, trends, Agents, and Model. |

Each registry entry carries metadata that drives the UI:

- `category` (one of `baseline`, `coverage`, `outcomes`, `empty-states`):
  top-level grouping in the popover and table.
- `dimensions` (subset of `live-presence`, `cost`, `capture-depth`,
  `intervention`, `introspection`, `honesty`): what product pillar this
  scenario varies vs the healthy baseline. Drives the dimension filter.
- `views` (subset of `overview`, `tools`, `project`, `compare`, `replay`, `model`): which routes' UI
  meaningfully changes. Drives the popover's scope filter, never which sidebar
  tabs exist. Primary destinations (Overview, Compare, Agents, Replay, Model,
  Settings) always stay in the rail; thin fixtures use each view's honest-empty.
  Be honest — if a scenario doesn't list `model`, the Model tab keeps the
  forming read.
- `summary`: one line, plain English, no widget jargon.
- `whatToCheck`: one sentence on the visual change to look for.

## Adding a scenario

1. Pick the product claim. "What does X look like when Y?" — prefer a vision job
   sentence (insight / intervention / introspection / honesty), not only a widget.
2. Add the id to the `DemoScenarioId` union in `scenarios.ts`.
3. Write a builder that calls `createBaselineOverview()` (or
   `createEmptyOverviewDemo()`) and overrides only the `OverviewSnapshot`
   fields the question needs. Attach `createBaselineDeveloperModel()` or
   `createEmptyDeveloperModel()` when Model should change. Keep the current-state
   aggregates derived from `live` so the numbers stay internally consistent.
4. Register it in `DEMO_SCENARIOS` with the metadata above.
5. The switcher and `/demo` browse page pick it up automatically.

The rule: nothing in the dashboard should read mock data from a path that isn't
`lib/demo/`. If you find scattered fixtures, fold them in.
