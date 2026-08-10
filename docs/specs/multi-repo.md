# Multi-repo scope and comparison

Solo developers run many repos. The web surfaces answer different questions:

| Surface | Where | Primary question |
|---------|-------|------------------|
| **Overview** | Dashboard home | What is true across all work in this window? |
| **Project** | `/dashboard/project/:id` | What is true in this repo in this window? |
| **Compare** | `/dashboard/compare` | What changed from the prior equal window? |
| **Agents** | `/dashboard/agents` | How did my coding tools differ on comparable evidence? |

Overview's repo menu navigates to one Project. It is not a multi-select filter.
The Projects leaderboard ranks many repos on one stat. Neither invents a pair for
Compare.

**Deferred:** subset merge, saved repo groups, and any unmeasured outcome trend.

---

## Compare view

Compare stays in the primary rail because change over time is a core period
clarity question. Its bare route always means:

> All work in the selected window versus the immediately prior equal window.

The default window is 7 days. A reader can choose 30 or 90 days and can narrow
the same comparison to one project. Project links use the stable `repoId`, never
the basename.

Canonical period URLs:

- `/dashboard/compare`
- `/dashboard/compare?range=30`
- `/dashboard/compare?scope=<repoId>&range=30`

The primary composition is:

1. scope and equal-window controls;
2. a short factual read of the measured changes;
3. a compact current, prior, and absolute-change evidence table;
4. current-window outcome context, visibly separated and explicitly not called a
   prior-period comparison.

Measured adjacent-window rows:

| Stat | All work | One project |
|------|----------|-------------|
| Sessions | `usage.totals.sessionsDelta` | `ProjectRollup.sessionsDelta` |
| Measured cost | `usage.cost.delta` | `ProjectRollup.costDelta` |
| Captured lines added | `usage.lines.delta` | `ProjectRollup.lines.priorAdded` |

The compiler is
`packages/web/src/views/CompareView/compilePeriodComparison.ts`. It is a pure
presentation projection over one `GET /overview` snapshot. The worker reuses the
existing widened event-log read for per-project session legs; Compare adds no D1
read.

The rendered read then combines those exact scalar legs with the existing
`GET /developer-model` accrual slice. Accrual can add one notable shift in work
rhythm, project focus, or branch work shape, plus a line-survival change when both
periods clear their measurement floors. These claims use the same color-coded
term, connector, and cited annotation system as Model, Agents, and Overview
Summary. Compare does not list every current stat as if it had a prior leg.

### Honest-empty rules

- A missing prior leg omits the whole comparative row. It never becomes zero,
  unchanged, or a directional claim.
- A project absent from the selected window stays unavailable. Compare never
  substitutes another repo.
- Ship rate and line survival stay on Overview and Project until prior-window
  outcome legs exist. Line survival may join Compare through developer-model
  accrual only when both adjacent legs are measured; Compare does not mix a
  current-only outcome into a period read.
- Thin data does not remove Compare from navigation.

---

## Explicit repo A/B drill

`Repos` is a secondary mode for the real but less frequent question, "How did
these two repos differ inside one shared window?" The reader must choose both
repos deliberately. Sidebar and Overview never prefill the busiest or first two.

Canonical route:

`/dashboard/compare?mode=repos&a=<repoId>&b=<repoId>&range=30`

The table reads two `ProjectRollup` rows from the same overview snapshot. Rows
come from `COMPARE_METRICS` in
`packages/web/src/views/CompareView/compareMetrics.ts`.

| Row group | Source |
|-----------|--------|
| Context | `character`, `workMix`, portfolio temperature, git context |
| Volume and cost | `ProjectRollup` scalars and `lines` |
| Current outcomes | `ProjectRollup` outcome and coverage fields |
| Work shape and cadence | `workMix`, tools, models, files, git momentum |
| Attention | `interventionFires` |

Null or empty cells render `--`. One picked repo never becomes a one-sided
comparison. Picking the same repo twice asks for a different second repo.
Legacy basename links can still be read, but every newly written link uses
`repoId` so colliding repo names remain distinct.

In a Shared workspace, `repoId` remains machine-salted. When two members capture
the same git repo under different ids, Settings offers an explicit project claim
that folds the joining id into the chosen canonical card. Capture still creates
projects automatically; the claim joins evidence already sent to that workspace
and never imports Personal history.

---

## Code

| Area | Path |
|------|------|
| Rollup contract | `packages/types/src/overview.ts` |
| Worker project projections | `packages/worker/src/overviewProjects.ts` |
| Period compiler | `packages/web/src/views/CompareView/compilePeriodComparison.ts` |
| Repo metric registry | `packages/web/src/views/CompareView/compareMetrics.ts` |
| Project scoping | `packages/web/src/views/ProjectView/useProjectData.ts` |
