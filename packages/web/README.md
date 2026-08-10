# @seorak/web

The web dashboard for retrospective deep dives over Seorak session data. React + Vite.

Light-default, Figtree + IBM Plex Mono, white canvas, logo-derived lavender/pink/sage accents. Sticky rounded-card icon sidebar (3-chevron summit logo, Overview, repos, theme toggle) + an Overview with `ViewHeader`, `RangePills`, a **live sessions** table (status dot, `ToolIcon`, colored repo name, cost, duration, black View pill) and big-number `StatCard`s.

Design tokens live in `styles/tokens.css` and `src/app.css`; tool SVGs live in `public/assets/`.
Typography and the marketing/product visual language live in [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md).

## Run

```bash
npm run dev:worker   # wrangler dev on :8787 (provides /sessions)
npm run dev:web      # vite on :5173, proxies /api → :8787
```

Open http://localhost:5173. To get data in, run the collector and a Claude Code or Codex session (`SETUP.md`). Clear local state: `rm -rf packages/worker/.wrangler/state/v3/kv`. `/dashboard/demo` and `?demo` render fixtures without a worker.

## Data

The dashboard is a presenter with no business logic of its own. It renders the `SessionSummary` and `OverviewSnapshot` view-models from `@seorak/types` (`sessionToSummary`), fetched from the worker's public HTTP API, the same projection seam the mobile push path reads from. Routes and responses are declared in `@seorak/types` (`api.ts`); transport lives in `src/lib/api.ts`. `/live` polls on an adaptive cadence, `/overview` polls as a conditional GET and backs off after repeated failures.

The supported deployment builds the dashboard and worker together on one origin.
Web schemas therefore require the current response contract instead of filling
omitted fields for an older worker. A malformed refresh preserves the prior
snapshot as stale, or shows a schema error on a cold load; it never fabricates an
empty measured section. Narrow enum fallbacks remain for additive future values.

**Multi-repo:** Overview merges all repos; Project view scopes to one; **repo compare** ships at `/dashboard/compare` — see [`docs/specs/multi-repo.md`](../../docs/specs/multi-repo.md). The header `N repos` control opens a single Project view; it is not a filter.

Replay renders once the worker persists an event log; until then the replay surface has nothing to draw. The intervention engine (stuck/cost detection and push) runs in the worker and surfaces here as session status.
