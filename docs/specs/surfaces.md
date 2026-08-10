# Surfaces

One record, three delivery surfaces. Equal weight in copy, never phone-first.

| Surface | Job | Not its job |
|---------|-----|-------------|
| **Terminal** (`seorak`) | A short honest paragraph on what is true now and how the window landed, then a door to the dashboard | Retrospective depth; a widget board to curate; intervention config |
| **Web** | Retrospective depth, period and repo comparison, global notification settings | Real-time glance |
| **Mobile** | Whether your agent needs you, and what is allowed to interrupt you: Live Activity, push, per-project watches | Shrunken web dashboard; a board of stats to curate |

All three read the same worker routes over the same contracts, and all three
consume `@seorak/types`. Aggregate responses carry one serve-mode contract:
current data is `fresh`, while a real last-known-good body is retained and
visibly marked `revalidating` or `stale`. No surface promotes fallback bytes to
current data. If rollups are beyond the fixed safe tail and no last-known-good
body exists, the worker returns retryable `unavailable` without aggregate
product data; clients never receive a partial or fabricated-zero snapshot.
Transport and validation:
[ARCHITECTURE.md](../ARCHITECTURE.md#surface-data-access).

Public routes: **Features · Surfaces · Privacy · Pricing**.

---

## Terminal

A first-class interactive session, not a one-shot print, and deliberately NOT a
dashboard rendered in ANSI. It says one sentence about right now and up to three
about the window, then points at the web for everything deeper. Identity rides
real state, never a splash.

Attention leads: a blocked session always owns the first sentence, with the
measured wait, borrowing mobile Home's precedence. Nothing blocked reads as
"Two sessions are running in seorak and orchescope, and nothing needs you."

The window paragraph is volume and the per-agent token split, then cost, then
whether the work held up. **Every caveat rides the sentence it qualifies**, which
is the thing a grid of stat cells could not do: a partial cost names the model it
cannot price so the total reads as a floor, an outcome rate names the agent it
does not cover, and an agent whose record starts inside the window says so beside
its own share. An unmeasured leg is not spoken at all, so the paragraph shrinks on
thin data rather than filling with `--`.

- `seorak init` sets up hooks and the daemon once. Re-init preserves the configured worker URL and key and heals hooks orphaned by a moved checkout.
- `seorak status` prints a check-per-line list with a remedy on every failure, resolving the worker URL and token exactly as the session does.
- `seorak` opens the live session plus an input line (`/range`, `/view`, `/help`, `/quit`, free text to chat).
- **left/right change the window, up/down focus one project.** A focused board narrows both halves to that repo's rollup, which the worker computes with the same definitions as the global aggregates. Hints spell the keys: `←↑↓→` are not cell-exact in monospace and font-fall-back at the wrong size.
- **`/view`** cycles the paragraph, a list of the same facts, and a table of every project. One fact layer feeds the first two, so form never changes the claim. The table is the only place `--` returns (a cell exists whether or not a number does), and it never caps silently.
- The session opens on an entry card ONLY when it has something true to say (nothing captured yet, or notes for a version you just crossed). Notes ship in the package as `NEWS.md`; there is no central service to broadcast from and no phone-home.
- `seorak --once` renders once and exits.

User-facing copy says **stat**, never "signal". Polls `/live` and `/overview`, the
latter as a conditional GET. The window persists to
`~/.seorak/terminal-layout.json`; there is no widget layout to persist any more.
When the worker serves its last complete aggregate while rebuilding, the board
keeps those real facts under an explicit refresh notice. Successful JSON is
guarded at the transport boundary for every field the terminal dereferences;
malformed bodies follow the same unavailable/stale path as a failed read and
never become an empty measurement. Any unexpected asynchronous failure restores
raw mode, cursor visibility, listeners, timers, and the alternate screen before
the session exits. Local delivery health is independent from those read paths:
a blocked event backlog adds a warning above an otherwise healthy board and
points to `seorak status`, while the last real worker snapshot remains visible.
Code: `packages/collector/src/terminal/`, composition in `narrative.ts`, phrase
primitives in `voice.ts` (a port of the same vocabulary mobile and web carry,
since the collector cannot import from either).

---

## Web

Default cockpit: Overview (merged repos), Project (`/dashboard/project/:id`), Compare (`/dashboard/compare`), Agents (`/dashboard/agents`), Replay, Model, Settings. Compare defaults to the same scope over adjacent equal windows, with explicit repo A/B as a secondary mode. Agents compares tools. Both stay in the sidebar; thin windows use honest-empty pages without changing the product tabs. Widget catalog in `packages/web/src/widgets/catalog/`. Visual system: `packages/web/DESIGN_LANGUAGE.md`.

**Overview:** customizable widget board first. Opt-in **Summary** glass chip opens a bottom page-fade. Annotation language matches Model / Agents: ink prose, facet terms, hover peek + pin in a side lane with connector (below only if the lane is too narrow). Smooth close. Board stays; Customize unchanged.

Overview, Project, Compare, and Agents consume the same aggregate freshness
contract and the same reconnecting banner. A retained snapshot is never rendered
as current after a failed refresh. The shared floater portal owns its preferred
placement, but a missing portal renders the warning inline rather than erasing
the only stale-state cue.

**Compare:** period clarity's change-over-time surface. Bare entry means all
work in the current 7-day window versus the prior 7 days; the reader can widen
the range or choose one stable project scope. The read uses the same color-coded
claim-to-evidence annotations as Model, Agents, and Overview Summary, combining
exact Overview deltas with honestly measured developer-model accrual shifts.
Outcomes without a prior leg stay on Overview and Project rather than appearing
as comparison context. Repo A/B remains an explicit secondary drill and never receives an
automatic pair from navigation. Full contract: [multi-repo.md](./multi-repo.md).

Agents is the personal Claude vs Codex compare surface: a verdict lead, a side-by-side metric matrix, then where (project × agent) and models. Fair cells only, no outcome "winner" until Codex can back session-end legs ([multi-tool.md](./multi-tool.md) Appendix A). Tools remains a widget-only drill.

Notification settings on web are **global** (per-stat on/off, thresholds, quiet
hours) plus **per-project mute**. The Alerts panel also shows the production and
development delivery records from `GET /delivery-health`: registered devices,
completed attempts, last APNs acceptance, and terminal failures over the
retained 30-day window. No completed attempt reads as unobserved, not as zero
failures, and an unavailable response makes no delivery claim. Per-project
*threshold* overrides are intentionally deferred on web; mobile owns that finer
control. This is a UI gap, not a capability gap: `ProjectOverride.overrides` and
the worker's `resolveNotificationConfig` already resolve them end to end, so the
web editor is purely additive. Tracked so it does not become silent drift
against equal surfaces.

### Live drill and "files in play"

Web's job is retrospective depth, so the **Live** drill is the deliberate present-tense exception and stays scoped about what "right now" means.

**Files in play** lists files edited by sessions still on the live board: not ended, and having emitted an event inside the 30-minute silence horizon (`ABANDONED_THRESHOLD_MS`, `packages/types/src/session.ts`). Membership is by **session liveness, not file-edit recency**. A file stays in play while the session that edited it is still running, so "Last edit" can read a few minutes old without the stat overclaiming a this-second edit. Honest-empty: the tab shows nothing when no live session has touched a tracked file. Aggregation is `filesInPlayFromRows` in `packages/worker/src/eventlog/codebase.ts`, narrowed to the live board in `packages/worker/src/overview.ts`.

---

## Mobile

**Two jobs: tell you when your agent needs you, and let you decide what is worth being told.** Both belong on a phone and nowhere else, the first because you are away from the machine and the second because you tune notifications on the device that buzzes. Retrospective depth is web's; the phone answers it in one sentence and stops.

Live Activity and Dynamic Island for ambient session state. Push for intervention. Settings mirror the worker (`GET/PUT /settings`). Per-project threshold overrides ship here; web is global plus mute for now (see Web above).

Live Activity settings also render the app-level token owner's content-free
registration state. Missing signed environment, missing local delivery
authority, retryable reachability, rejected authority, exact dispatcher
misconfiguration, and an accepted environment observation remain distinct.
Only the worker's closed dispatcher error code is terminal for a captured
delivery revision; HTTP status or mutable error prose alone never names the
cause.

The mobile Alerts screen reads the same environment-separated 30-day delivery
record as web. It distinguishes an unobserved window from an observed zero,
labels APNs acceptance without claiming device display, and treats a malformed
or failed read as unavailable. Polling is focus- and foreground-gated; unchanged
records back off rather than creating a permanent D1 read loop.

Connection authority is HTTPS-only outside local development. Plain HTTP is
accepted only for exact loopback hosts (`localhost`, `127.0.0.0/8`, `::1`);
private-LAN, `.local`, and public hosts are refused before any bearer is stored
or sent, with a distinct on-device remedy instead of an ATS-shaped reachability
error.

IA: **Home** / **Projects** / **Settings** are the three top-level jobs.
Project detail, session detail, and the four Settings groups are pushed
destinations inside those jobs; there are no parallel dashboard rooms.

| Top-level job | Owns |
|---------------|------|
| **Home** | The rotating hero deck, then recent activity per project |
| **Projects** | Every tracked repo, its live state, and its mute switch. Tap through to one project's stats, sessions, Live Activity controls, watches, and fire history |
| **Settings** | An index for device config, the **global** watch defaults and quiet hours, and Live Activity project eligibility |

Decided rules worth not re-litigating:

- **The deck turns, and attention pins it.** A clock may move the ambient facts; it may never hide the one that needs you. Motion otherwise is caused by data, never by a timer (MOBILE-EMPHASIS ADR-5).
- **Interruption config splits by scope, not by screen.** Global defaults in Settings, a repo's own watches on that repo. There is no Interventions room, because the two halves belong to different places and neither belonged to a third.
- **The pillar claim is a measurement, not a message.** "You are not here to watch an agent spin" ships as the deck's `friction` card, sourced from real stuckness and retry-loop rates. Nothing general about developers is ever printed at the reader: an uncheckable card teaches people to stop reading the checkable ones beside it.
- **Home's activity list is one comparable column, and the interrupt stays words.** Every row's right side speaks the same unit, picked by a header selector (tokens, est. cost, sessions, lines) and remembered device-locally; per-row standouts were a sampler, not a comparison. What a repo is *doing* is a separate claim: a permission waiting or a live count rides an exceptional state line under the name, in the Projects tab's exact phrasing, absent on a quiet repo. Sorting a blocked repo first and tinting its number is not telling anyone anything, because colour carries nothing to VoiceOver and the hero pins only one card. Deltas ship only where a real prior-window leg exists (cost, lines-added); tokens and sessions show the value alone rather than a fabricated trend.
- **The projects list is a union**, seeded from the shared `/overview` projects (resolved through project-alias merges), then unioned with fire history and existing overrides, so a repo is tunable before any watch has fired and a muted-and-idle repo can still be un-muted. Web's mute list uses the same source.
- **Projects has no aggregate totals sentence.** The rows are the figure: the
  screen exists to open or silence one repo, while portfolio totals and
  retrospective comparison remain web's job.
- **A project's Stats view is one stat drawn and every stat listed.** A pinned panel at
  full page width draws ONE stat; under it, one row per measured metric, name left and
  number right, grouped by when the reading was true. A row press SWAPS what the panel draws and never navigates; pressing the
  panel opens that stat in full, in place, under the same header. Two depths, no route, no
  fourth screen, and no new window: the panel decomposes the window the screen already
  reports rather than adding a retrospective one.
- **The form changes with the stat, which is the whole design.** Only five of the seventeen
  metrics have a per-day series (sessions, cost, tokens, net lines, cost trend); the other
  twelve — five rates, three git snapshots, three live readings and tool calls — have no
  daily leg in the contract and can never be a line. So the panel draws a curve over the
  window's days, a filled proportion on its ground, two marks on one scale, one open-ended
  lane per running session, or labelled ranked bars. A panel that knew one form
  would be drawing a chart of nothing two thirds of the time. Which form a metric gets is a
  property of the metric (`statMark` → `statFeature`), never a preference, and now neither
  is which metrics appear: nothing on this screen is curated.
- **The forms differ by shape, not by colour, and a ground may fade where a reading may
  not.** All five are drawn in the one data ink. The curve's wash dissolves toward the zero
  rule and into the page at both margins — flat, it was a slab with a razor edge at each end
  and a third along the bottom, three straight lines the measurement does not have — but
  the fade is applied at the PAGE's edges only, because the hard edge where a run stops at
  an unmeasured day is the whole of what distinguishes it from a day that measured zero.
- **A snapshot against its own history is a distance, not two bars.** Two stacked
  full-width tracks read as a settings screen and asked the reader to compare two lengths
  across a gap; at four times its baseline a repo drew a long rule over a stub. One scale
  from zero carries the reading as a solid mark and the reference as a ring, larger label
  above and smaller below so equal readings collide in neither. Nothing is tinted and
  neither direction is good: direction is the reading, and this product does not grade.
- **The live reading gets a picture that cannot be read as progress.** One lane per running
  session, each running out past the page's gutter and dissolving at the edge of the screen.
  A lane that stopped somewhere on the width would claim a length — a duration, a share, a
  bar most of the way along — and the session has started and has not ended.
- **The chart is full width because that is what a chart needs.** Four passes were spent
  restyling what went inside a 153pt tile before the tile turned out to be the problem — no
  axis, no date and no legend fits there, so every attempt read as texture and a third of
  the tiles were blank. The tile grid is gone and is not coming back.
- **The panel is not a card.** No rim, no shadow, no rounded surface: a curve runs to the
  width of the page and a container is a second frame inside the phone's own. A hairline
  that fades out at both ends is the entire separation between the panel and the list.
- **Swapping is a transition, not a cut**, and the default subject latches. The old stat
  fades and lifts out before the new one settles in, with the height change animated under
  it. Until a row is pressed the panel opens on the first stat that has something to draw
  (plain first-measured put "Running now, 0" on every quiet repo), and that choice is
  latched once the owner's selection has arrived, so a poll cannot reseat the panel under
  the reader. Reduce Motion gets the answer and none of the travel.
- **One data ink.** `color.data` / `dataGhost` for every chart on the surface. A per-project
  hashed hue was shipped and then rejected: it changes for reasons that have nothing to do
  with the measurement. Lavender is still live, amber is still needs-you, and neither is
  ever spent on a rate.
- **That needed a worker change, and got one.** `ProjectRollup.dailyTrends` carries this
  repo's own sessions, cost and tokens per day, assembled from buckets the per-repo loop
  already held (zero extra D1) and mirroring the global trend's honesty contract exactly:
  inactive days absent rather than zero-filled, `costUsd` null on an all-unpriced day. The
  phone renders that null as a BREAK in the curve — the day has no reading, so the line
  ends and the fill under it stops, which is the only thing distinguishing it from the day
  that measured zero and sits on the axis. Before `dailyTrends` existed there was no
  per-repo cost-per-day or tokens-per-day at all. A worker that predates it draws the
  labelled composition instead of a curve, which is the honest picture that is left.
- **A dash is not a measurement, and there is no footing.** A metric that resolved to "—"
  is not listed; the view switcher still counts it ("5 of 6 measured"). The three lines of
  prose that used to trail the list (the window, the reasons for the dashes, a recency)
  came off: at that size they read as filler at the one place a thumb rests, and the window
  is already in the panel's own caption, beside the figure it qualifies.
- **The phone still has no range control.** Every figure on the surface covers the one
  `rangeDays` window; choosing windows is the web dashboard's job.
- **A failed refresh never looks live.** Shared reads keep the last real body but
  enter a stale state; changing worker authority clears the shared bodies and
  ETags before the new endpoint is read.

Removed, deliberately: the Performance, Interventions, and Agents rooms, the composable tile boards, and the Composer. Performance and Agents were retrospective reading that web does better on a real screen. The boards asked "which numbers do you want on your phone" and the settled answer is *almost none*. Recoverable from git if that judgement proves wrong.

That removal sent the depth somewhere specific — "everything else is a tap into the
project it belongs to" — so a project's own screen is where it landed, and the drawn stat
above is that tap being made worth taking. The line the boards crossed was **curation**:
asking the owner to assemble a screen out of numbers.

**And the 17-metric picker went the same way, because it was the last of that question
still standing.** It existed for the tile grid: seventeen tiles was nine screens of
texture, so something had to be chosen between. A row costs a row. Every measured metric
is listed now, on every project, in the catalog's own order — grouped by when the reading
was true (right now, this window, after it landed), which is the one thing a column of
figures cannot say for itself. A fixed order also makes a figure comparable BETWEEN
projects, which a per-repo selection quietly made impossible. The `projectGlance` settings
family, its worker store, its route wiring and its stored row are all gone; a metric that
resolves to a dash is still not listed, so the list is still only what was measured.

Heroes and empty states never render blank; the copy floor is in [voice-and-scope.md](../reference/voice-and-scope.md).

---

## Open question

Which stats belong on which surface, unvalidated with users. Do not over-bet one surface before that lands.
</content>
