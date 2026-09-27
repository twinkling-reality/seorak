# @seorak/web

Two build targets in one workspace: **the primary dashboard** (`src/`, built to
`dist-dashboard`) and **Seorak's own website** (`site/` + `src/marketing/`,
built to `dist`). React + Vite. Only the dashboard is part of the public core;
the marketing tree is private.

Light-default, Figtree + IBM Plex Mono, white canvas, logo-derived
lavender/pink/sage accents. A sticky rounded-card icon rail (`Sidebar`) carries
Overview, Compare, Agents, Replay, Model and Settings; Overview itself is a
**customizable widget board** (`ViewHeader`, `RangePills`, `CustomizeButton`,
`WidgetGrid`) whose tiles come from the catalog in `src/widgets/catalog/`. Six
picker categories (live, usage, outcomes, activity, codebase, tools & models)
over nine viz kinds, including a `stat` tile, a `live-list` that renders
`LiveSessionsTable`, rings, heatmaps and proportional bars. Tiles drill into the
detail views under `src/views/`.

Design tokens live in `src/styles/tokens.css` and `src/app.css`; tool SVGs live
in `public/assets/`, self-hosted font cuts in `public/fonts/`.
Typography and the marketing/product visual language live in [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md).

## Run

From the repository root:

```bash
npm run dev:collector   # the local plane on :4317 (the default dev API target)
npm run dev:web         # vite on :5173, proxies /api → 127.0.0.1:4317
```

`SEORAK_DEV_API` overrides the proxy target, so `npm run dev:worker` (wrangler on
:8787) works as the API instead when you are exercising the hosted path. Open
http://localhost:5173; the dashboard mounts at `/dashboard` and `/` is the
marketing site. To get data in, run the collector and a Claude Code or Codex
session (`SETUP.md`). Clear local worker state:
`rm -rf packages/worker/.wrangler/state/v3/kv`. `/dashboard/demo` and `?demo`
render fixtures without any plane, in dev and behind `VITE_ENABLE_DEMO`; a plain
production build ignores them.

## Data

The dashboard is a presenter with no business logic of its own. It renders the
`SessionSummary` and `OverviewSnapshot` view-models declared in `@seorak/types`,
over one route contract with three possible authorities: the collector's
loopback plane, a worker the developer self-hosts, or a Seorak-managed one.
`src/lib/dataPlane.ts` probes which, and that probe is what lets the Free
product open with no account. Routes and responses are declared in
`@seorak/types` (`api.ts`); transport lives in `src/lib/api.ts`. `/live` polls on
an adaptive cadence, `/overview` polls as a conditional GET with `If-None-Match`
and backs off after repeated failures.

Web schemas require the current response contract instead of filling omitted
fields for an older plane. A malformed refresh preserves the prior snapshot as
stale, or shows a schema error on a cold load; it never fabricates an empty
measured section. Narrow enum fallbacks remain for additive future values.

**Multi-repo:** Overview merges all repos; Project view scopes to one; **repo
compare** ships at `/dashboard/compare`, specified in
[`docs/specs/multi-repo.md`](../../docs/specs/multi-repo.md). The header
`N repos` control opens a single Project view; it is not a filter.

Replay reads the retained event log and renders keyframes at `/dashboard/replay`.
Intervention is evaluated by whichever plane is serving: the collector's own
watch engine locally, the worker's engine when hosted, surfacing here as session
status and in the outcomes tiles.
