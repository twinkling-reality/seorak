# Developer model (introspection)

The **developer model** job is a period portrait of who you have been as a
developer lately, grounded in whether that work landed. It helps answer when,
where, and with which tools work tended to hold up. Parent:
[VISION.md](../VISION.md).

**Status:** shipped end to end on web (identity, conditional payoff, project
scope, accrual). Any change to intervention settings remains a deliberate user
choice.

**Surface:** **web only, deliberately.** [surfaces.md](./surfaces.md) settled mobile as two jobs on three screens with retrospective depth on web, and this pillar is retrospective depth. That is a decision against equal surfaces, made once and written down here rather than left as a silent gap: a portrait belongs on a screen you read, and the phone answers "how did it go" in one sentence and stops. Revisit only if the surface-allocation open question in [STATUS.md](../STATUS.md) resolves the other way.

---

## What it is

**Job (one line):** Open Model and instantly feel who you've been as a developer this period — rhythm, focus, habits, stack — with outcomes woven in as texture, not as a second Overview.

Model is **identity-led performance tracking**: a readable summary of *you*, not a second Overview. Overview compiles to widgets; Model compiles to a **portrait**.

Its practical payoff is better self-knowledge. A developer can compare their
own measured conditions and outcomes, decide what appears worth keeping or
changing, and set intervention boundaries accordingly. Seorak reports
associations in the record. It does not claim that a tool, time, or behavior
caused an outcome when the evidence cannot establish causality.

### Insight facets

Each facet surfaces as **color-coded inline insights** in the hero prose. Click an insight for supported detail in a topic squircle; hover for a short peek. Numbers stay out of the lead.

| Facet | Answers | Examples in prose |
|-------|---------|-------------------|
| **Rhythm** | When you show up | "evening developer", "Tuesdays are steadiest", "quiet weekends" |
| **Focus** | Where attention went | "mostly cleanerchat", "seorak in bursts" |
| **Stack** | What you touched | "TypeScript-heavy", "Rust on seorak" |
| **Shape** | How you work | "feature branches", "close the chat when done" |
| **Payoff** | Whether it landed | "mornings tended to stick", "late nights looped" |

**Payoff** is outcomes — line survival, ship, stuckness, conditional slices — synthesized into plain language in the read, with rates and counts only in squircle bodies.

### What it is not

- Not a widget grid or stat soup (that's Overview / period clarity)
- Not a grade, rank, archetype, or permanent "developer type"
- Not peer norms or “compared to other developers”
- Not session replay or intervention history (link out only)

Surfaces as **"Who you've been lately"** / **"Your patterns"** — never a manager view.

**Web:** sidebar **Model** → `/dashboard/model`; page chrome **Introspection** eyebrow, **Model** title. Honest-empty when window is thin. No middot (`·`) separators in UI copy.

---

## Hard rules

1. **Identity leads, outcomes support** — hero prose is rhythm, focus, stack, shape; payoff is one plain paragraph when n supports it
2. **Observed patterns, not person grades** — period-scoped ("this month", "lately")
3. **Effectiveness = outcome | dimension**, never volume | dimension
4. **Performance of the work, not a review of the person** — no composite score
5. **Identity v1 = the local install** — no login; later opt-in salted `developerId`, self-scoped only
6. **Mostly projection** — reuses captured signals; new aggregates in modular worker builders
7. **Association is not causation** — say "tended to" or "was associated with," never invent a causal why
8. **The developer decides what changes** — Model never writes intervention settings or modifies agent behavior

Period clarity answers the window; Model answers identity over the same
evidence. A developer may use that evidence to change an intervention setting,
but Model does not recommend, create, or apply a rule automatically.

---

## Architecture

```
D1 events → packages/worker/src/developerModel.ts → DeveloperModelSnapshot
         → packages/web/.../portrait/* producers → assemble → portrait UI
```

| Layer | Owns |
|-------|------|
| `@seorak/types` | Publish-safe snapshot shapes, shared n-floors |
| Worker | `buildDeveloperModel()`, row assemblers in `eventlog/*` |
| Web | One producer per portrait sentence, the assembler, squircle drill-down |

**One producer per sentence.** `portrait/` holds a module per sentence of the
read (rhythm, focus, stack, craft, habits, shift, survival, daypart payoff, trend,
friction),
each returning its own insights and its own complete grammar; `assemble.ts` only
chooses which sentence opens a paragraph and never edits inside one. Adding a
facet is a new file plus a line in `registry.ts`. The previous single compiler
function spliced connectives between blocks that could not see each other and
shipped two grammar defects to production.

### The clock is the reader's

The worker buckets session hours in UTC (`getUTCHours` / `getUTCDay`) because it
never sees a timezone. **Every claim about when a developer works is therefore a
shift performed on read**, against one shared daypart table in
`packages/web/src/lib/localTime.ts`.

This has a hard consequence for the contract: a **UTC-day rollup cannot ship**,
because collapsing the hour away leaves nothing for a surface to shift.
`identity.dayOfWeekCadence` and the developer-model's `outcomes.endReasonsByDay`
were removed for exactly that reason — weekdays are derived on the surface from
`activity.hourlyDistribution`, which keeps the hour.

For the same reason, **conditional outcomes ship as counts, not rates**
(`conditional.lineSurvivalByStartHour`, `conditional.shipByStartHour`). The
surface folds the hours onto the reader's dayparts and applies
`CONDITIONAL_OUTCOME_FLOOR` *after* the fold: twenty-four hourly slices each fail
an n-floor that the four dayparts they sum to clear comfortably. Both cuts are
pure joins over rows the build already reads, so the facet costs **zero extra D1
statements** (`eventlog/conditionalOutcomes.ts`, pinned by the op-budget test).

### Accrual — the change dimension

A snapshot answers *who are you*. Only a prior window answers **who have you
become**, which is the half of a portrait that carries a why and a when. `accrual`
is the same adjacent split every other period-over-period leg uses (`PeriodDelta`,
ADR-WS4/WS5): current `[now-range, now)`, prior `[now-2*range, now-range)`.

It ships **raw distributions, never prior conclusions** — a prior daypart is a
fact about the reader's clock, so both sides are localized and re-derived through
the same `dominantDaypart` on read. Shipping "you were a morning developer then"
would let a UTC daypart be compared against a localized one and announce a shift
that never happened.

**Cost line, written down so it is not rediscovered:** accrual rides only the
**session-grain** scans — session starts, line survival, and a second in-memory
filter over states `listSessions` already returned. Those are ~1.5% of the build's
rows and grow with sessions, not with how chatty an agent is. It deliberately does
**not** touch the per-hour rollup reads (the other ~98%), which is why there is no
prior language, tool or model mix. There is no prior ship rate either: its legs
aggregate inside a scan shared with `/overview`, and re-cutting that would change
a rate two surfaces already show. **Zero extra D1 statements** — the op-budget test
holds it.

The read speaks **one** change, ranked when-you-work → where-it-went →
what-kind-of-work, and each shift sentence sits immediately after the facet it
changes rather than collected at the end, where it read as an unrelated fact. The
payoff paragraph carries a direction only ("holding up better than it was"), never
a delta — a portrait that printed "+14 points" would be a scoreboard.

**A shift declines across a clock change.** The wire carries `(dow, hour)` and no
date, and the whole compile shifts both windows by one offset — which is wrong for
the prior one whenever a daylight-saving transition falls between them. A
US-Pacific reader who starts every session at 17:15 has their prior buckets land
an hour off, and the read announces a move from afternoon to evening that never
happened. Localizing each bucket by the offset in force at its own timestamp needs
a date on the wire, which the contract deliberately does not carry, so the daypart
shift returns null and the ranking falls through to focus or work type, which
carry no clock. `PortraitContext.priorOffsetMinutes` is injected for the same
reason `offsetMinutes` is: a producer that probed the ambient zone could not be
tested.

### Every card carries its evidence

A term in the read is a claim; the card behind it exists so a reader can check it.
That takes three things, and the cards were shipping an inconsistent subset:

1. **the counts**, never a bare percentage — `84% of landed lines were still there
   later` gave a reader no way to ask *of what*;
2. **the boundary** it was counted against — the hours a daypart covers, the
   window a comparison used, which calls were in the denominator;
3. **the derivation**, when the number does not follow from its name — work type
   is read off a branch NAME, survival is a blame check against the branch tip.

Helpers in `portrait/evidence.ts`. Two rules worth keeping: a numerator is never
reconstructed as `rate × denominator` (that prints a count nobody counted, off by
one at any rounding boundary — `rateOverText` exists for the rate-only case), and
a card never cites a number that is not about the thing it sits under. The focus
card used to quote the window-wide ship rate under a heading naming one project.

`outcomes.shipped`, `shipDeterminable` and `oneShotDeterminable` were added to the
contract for this: the worker already had all three and shipped only the
quotients, so two rates on the merged read were unfalsifiable.

The window-wide ship rate then had nowhere to go for a while. The focus card was
right to stop citing it — on a merged read it is the rate across every repo,
printed under a heading naming one of them — but no producer picked it up, so
three contract fields rendered nowhere at all. It rides the payoff paragraph now,
where shipping is the claim, and it is attached to BOTH the survival card and the
daypart-shipping card so it still has a home when either is silent.

**An insight with no term is unreachable evidence.** The renderer resolves cards
only from `{type:'insight'}` segments, so a producer that returns two insights and
names one of them in its sentence has built a card nobody can open. The daypart
payoff producer did exactly that whenever both cuts agreed: the prose said the
work "shipped most often" and the shipping counts were dropped on the floor. One
term means one card, carrying both measurements.

**Peek and pin are two tiers.** `hoverLines` is the gist, `squircle` is the
receipts. Both rendered the full card before, so `hoverLines` was dead on all
seventeen insights and a hover dumped a wall of citations at someone who had only
brushed a word.

**The card body is a measurement, not an opinion.** `squircle.detail` was the one
line on a pinned card that is not a citation, and every one of them was a fixed
string. Fixed strings failed in exactly two ways and both shipped: they restated
the sentence the reader had just clicked ("Your week leans on a couple of days"
under «Tuesdays and Wednesdays»), or they asserted an adverb no gate had measured
("Most of your sessions ran here" over a 30% leader, printed directly above its
own counts disproving it). Eleven of the seventeen were one or the other.

The body now states the **remainder** — what the leading count leaves out —
derived from the same two numbers the card already cites, so it cannot disagree
with them and cannot be a restatement. It is also the thing a reader checking a
proportion cannot get without doing the subtraction: on the owner's live window,
`42%, 187 of 446 sessions` is a fraction, and *the other 259 sessions were spread
across 20 other projects* is what makes that fraction legible. `remainderText` in
`portrait/evidence.ts`; the change cards state the live count for the thing that
moved instead, which is the fact their sentence has no room for.

**A header names what the card measured, not its facet.** The hue already carries
the facet, and heading by facet put four simultaneously-openable cards under "How
you work" and five under "Whether it landed" — including the quiet-sessions card,
which is about work that has not finished at all. One legitimate collision
remains and is listed in the guard: the tied-focus pair is one measurement about
two projects, told apart by the coloured squircle in its own header.

**A visual element encodes the number under it or it does not render.** Only the
focus cards carry the filled bar, because it is drawn from the project's own hue
and there is no equivalent mark for a language or a daypart. The shift-focus card
carried the hue and no `share`, so it was the one focus card with no bar; it has
one now. Everything else states its proportion in words. `portrait-cards --flags`
lists every card that states a proportion and shows nothing, as a standing note
rather than a defect, so the choice stays a choice.

### Every field renders

A projection with no render is a number nobody can check, and the snapshot
carried nine of them. The mapping is now total — if a field is added here, it
gets a producer or it does not ship.

| Snapshot field | Sentence |
|----------------|----------|
| `activity.hourlyDistribution` | rhythm (daypart, steadiest weekdays) |
| `focus.projectFocus` | focus, silent when the read is repo-scoped |
| `identity.fileLanguageMix`, `tools.byModel` | stack |
| `identity.branchWorkTypeMix`, `tools.byTool`, `tools.callStats` | craft (the error rate and its two counts, as citations only) |
| `tools.verification`, `outcomes.endReasons` | habits (runs only, never a pass count) |
| `outcomes.lineSurvival` | survival |
| `conditional.*` | daypart payoff |
| `outcomes.stuckness` (with `inFlight`) | friction, the live half only |
| `outcomes.shipRate`, `.shipped`, `.shipDeterminable` | payoff citation, on the survival card and the daypart-shipping card |
| `accrual.hourlyDistribution`, `.projectFocus`, `.branchWorkTypeMix` | the one shift sentence, beside the facet it changed |
| `accrual.lineSurvival` | payoff trend |
| `activity.endReasonsByHour` | reserved measured input; no automatic intervention rule follows from it |

### A gate is a separation, not a share

Almost every threshold in the portrait was a SHARE test — "does the leader hold
40% of the window" — and almost none of them asked the question a reader actually
cares about, which is "does the leader beat the runner-up by enough to be true
next period too". The difference is not academic: with four dayparts, two can sit
at 41% and 39% and both clear a 40% share gate, so the opening clause of the whole
page was decided by one session and said the opposite thing next period on
unchanged behaviour.

The gates that now require a SEPARATION, and what each costs:

| Gate | Rule | Goes quiet on |
|------|------|---------------|
| `dominantDaypart` | leader beats runner-up by 10% of starts | flat and near-tied weeks (exact ties included, which used to resolve silently by array order) |
| `steadiestDays` | exactly two weekdays in the `0.75 × lead` band | flat weeks, which used to name an arbitrary pair decided by payload order |
| `daypartShift` / `focusShift` / `workTypeShift` | leader separated by 15 points **in both windows** | one-session reversals reported as a change of identity |
| `standoutDaypart` | gap worth two units of the coarser sample | 3-of-5 vs 2-of-5, and survival slices where one line was 25 points |
| `trendProducer` | move worth more than five lines of the smaller sample | a four-line baseline judging a twelve-hundred-line window |

Two others are floors rather than separations and were simply missing: the stack
sentence had no n-floor on its language half, so one `.rs` edit printed "You
worked mostly in Rust" with the card agreeing at 100% of 1; and the work-type
shift ran a bare argmax while the craft sentence beside it required three
classified sessions and a 40% lead, so the read hedged the present and overclaimed
the past in consecutive sentences. Both now go through the same gate as their
neighbour — `craft.leadingWorkType` is exported and shared precisely so the two
cannot drift apart again.

**Adverbs are measured too.** "Most", "mostly" and "usually" are frequency claims,
and four of them were printed off gates that measured existence. `format.isMajority`
is strict for this reason and is now what decides the word in focus ("most of" vs
"more of ... than anywhere else"), habits ("usually" vs "most often", and "often"
when verification runs are under one per two sessions), and both survival and
one-shot, which compared `>= 0.5` and so called an exact half "mostly".

**`other` is never a spoken work type.** The collector returns it for a null
branch, a trunk branch, and any unrecognised prefix, so a developer committing on
`main` — this product's own default buyer — made it dominant, and "You were mostly
work its branch did not name" is not a sentence about a person. It stays on the
card as a runner-up.

### Read against the owner's own log

Every gate and every weight below was tuned on fixtures until 2026-07-30, when the
portrait was first compiled against the live event log. Four things only real data
could say:

**A rate can be dead.** `outcomes.oneShotRate` marks a session one-shot when the
run-length-encoded stream of its tool names visits each tool at most once, and the
read spoke it above 50%. On the owner's log it is **1.8% at 7 days, 2.3% at 30 and
1.7% at 90** — unreachable by a factor of twenty-five, because an agent that reads,
edits and reads again has already failed the test, and "without doubling back"
promised a claim about retry loops that the measurement never made. The facet, the
contract field and the D1 read that fed it are all gone; the measurement still
ships on `/overview`, where surfaces render it. That returned a statement to the
build, so the op budget is **14, not 15**.

**An unmeasurable half must not score.** `concentration` returns the neutral 0.5
for a null share, which is the right default for a producer with no opinion and
the wrong term inside a `Math.max` over two halves. The craft sentence took that
max, and on the live window its work-type half is silent (`other` leads the branch
names, 344 of 413, and `other` is never spoken) — so the ABSENT half scored 0.5,
beat the tool half's measured 0.35, and pushed "you spent more of it running
commands and reading" past the rhythm lead into the read. A facet ranked higher
for having less to say, and it took the opening claim of the page with it.
`format.bestConcentration` skips halves that measured nothing and scores a
single-category leader at zero, which is what every producer's comment already
said and none of them got.

**A threshold fitted to one example is still a coin flip.** `steadiestDays` was
suppressing a real answer: the owner's localized week is Thu 96, Wed 91, Fri 72,
Sat 63, Mon 62, Sun 57, Tue 44, and the band's cliff at `0.75 x 96` is exactly 72,
so Friday joined the top and the sentence went quiet. The first fix was a second
ratio, and it decided the same window by eight tenths of a session. The gate now
asks whether the drop from the second day to the third is LARGER than the gap
inside the pair — no constant, scale-free, and true at any volume (19 against 5
here). A flat week, a flat-with-a-tilt week and a gentle 10/9/8/7 slope all stay
quiet, which is what the previous rule was written for.

**The three identity sentences are decided by nothing.** On the live 30-day window
they score 0.246, 0.243 and 0.242, inside half a point of each other, so which
three of five facets a reader sees is settled by rounding. That is not a defect to
patch with a weight — it is the honest shape of a window where nothing is unusual
— but it is worth knowing before anyone reads a ranking change as meaningful.
`npm run portrait -- --rank` prints the table.

### One row per session

`session.start` rows are a count of session RESUMPTIONS, not of sessions: the
collector maps every Claude Code `SessionStart` hook to phase `start`, and that
hook fires on startup, resume, clear and compact, each time with a fresh event id
and a fresh `at`. Every other session count in the build de-duplicates; the
start-row folds did not, so one session resumed four times could clear
`PRIOR_MIN_SESSIONS` on its own and unlock the whole "what changed" paragraph, and
a session started in the prior window that compacted in the current one landed a
row in BOTH slices. `buildDeveloperModel` now collapses the widened scan to the
earliest row per session before splitting the windows. Pure in-memory, zero extra
D1.

### The conditional cut reads the widened scan

The survival check fires days after the work landed, so checks inside
`[now-range, now)` belong to sessions that started roughly
`[now-range-3d, now-3d)`. The daypart cut joined them against a CURRENT-window
hour map, so every entry outside the overlap hit `hour === undefined` and vanished
— at 7d that is most of a week's rated work. The daypart cards could not be
reconciled with the headline above them, and the coverage line reported dayparts
as "not enough measured work to rate" when their entries had in fact been
discarded. The hour map is built from the widened rows now, which were already in
memory, so it still costs no statement; the repo scope moved onto the start rows'
own payloads for the same reason (`sessionRepo` is reduced from current-window
states and would re-drop what the widening recovered).

---

## Shipped

- Web **Model** tab — `/dashboard/model` wired to `GET /developer-model`
- **`GET /developer-model`** — snapshot + ETag, with `identity` (language and branch
  work-type mix) and `conditional` (survival and shipping per session-start hour)
- **Producer portrait** — `portrait/*` compiles one sentence per facet; the read
  covers rhythm, focus, stack, craft, habits, survival, daypart payoff, friction
- **Reader-clock rhythm** — dayparts and weekdays localized on read against the
  shared table, so a portrait is the same on any machine and true for any timezone
- **Project scope** — `?repoId=` reachable from the Model header; focus goes quiet
  when scoped rather than restating the reader's own choice
- **Accrual** — the prior adjacent window, for zero extra D1 statements; one shift
  sentence beside the facet it changed, and a payoff direction with no delta
- **Checkable rates** — `outcomes.shipped` / `shipDeterminable`,
  `stuckness.inFlight` and `tools.callStats.erroredCalls` / `callsWithResult` all
  ride the contract, so every percentage on a card states the division it is. All
  four are free: the worker already summed them to divide them
- **A card harness** — `npm run portrait --workspace @seorak/web` compiles the
  1,024-combination structural matrix plus a value matrix that walks each gate to
  its boundary, and prints every DISTINCT rendered card: term, header, peek, body,
  citations, and which visual fields are bound. `--flags` is the mechanical pass,
  `--rank` the ranking table, `--real <snapshot.json>` the live read. The guard
  that fails a build is `__tests__/portraitCards.test.ts` over the same matrix
- **`useDeveloperModel`** hook + demo parity
- **Fail-closed web cache** — malformed current-contract bodies never synthesize a
  portrait or advance the ETag; a warm read keeps its last complete portrait as
  stale, while a cold read surfaces an explicit schema error
- Partial outcomes on **Overview** and mobile Today (outcome card)

---

## Remaining

- [ ] **Survival rung curve** — the daypart cut reads the `3d` rung only, because
      that is the only rung the collector lands (ADR-OA2)

Not planned: a mobile portrait (see **Surface** above), automatic
pattern-informed intervention rules, personal playbooks, or automatic changes
to future agents.

---

## Code anchors

| Area | Path |
|------|------|
| Types | `packages/types/src/developer-model.ts` |
| Worker | `packages/worker/src/developerModel.ts` |
| Conditional cut | `packages/worker/src/eventlog/conditionalOutcomes.ts` |
| Outcomes input | `packages/worker/src/eventlog/outcomes.ts` |
| Web view | `packages/web/src/views/ModelView/` |
| Producers | `packages/web/src/views/ModelView/portrait/` |
| Shared clock | `packages/web/src/lib/localTime.ts` |
| Card harness | `packages/web/scripts/portrait-cards.ts` (+ `portraitMatrix.ts`) |
| Card guard | `packages/web/src/views/ModelView/__tests__/portraitCards.test.ts` |
