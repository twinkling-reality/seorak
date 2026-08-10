/**
 * frame.ts (PURE): assembles the whole terminal board from a layout + BoardData.
 *
 * The board is a header box, then the facts in whichever FORM the layout asks
 * for (sentences by default, label-and-value rows under `/view list`), then the
 * door to the dashboard. Both forms are built from one fact layer in
 * narrative.ts, so the preference changes how the board reads and never what it
 * claims.
 *
 * Degrade ladder:
 *   1. neither endpoint answered, handled by the shell (renderUnreachable)
 *   2. first run (no live + overview present + no project history), "No sessions yet"
 *   3. overview down (null) but live present: the live half still renders and the
 *      window half says it is missing, never a wall of fake "--"
 */
import { FRAME_MAX_WIDTH, formatAgo, frameBoxWidth, paint, visibleWidth, wrapText } from "./format.ts";
import { hostOf, identityBlock, miniMark } from "./identity.ts";
import { boxLines } from "./box.ts";
import { ALLOWED_RANGE_DAYS } from "../layout.ts";
import { liveRows, nowSentence, projectRollup, projectRows, projectSentences, projectTable, windowRows, windowSentences } from "../narrative.ts";
import { renderList } from "./list.ts";
import { renderProjects } from "./projects.ts";
import type { OverviewSnapshot } from "@seorak/types";
import type { BoardData, IdentityFacts, RenderContext, TerminalLayout } from "../types.ts";

/** Indent applied to every board line; cells are sized against the remaining width. */
const INDENT = 2;
/** Rows the all-projects table shows before it starts counting. Anything past
 *  this is named as dropped, never silently cut. */
const PROJECT_TABLE_LIMIT = 12;

/**
 * rangePills — PURE. The window filter as a control affordance, the terminal
 * analogue of the web's RangePills: the windows with the ACTIVE one marked
 * (bold accent with color, bracketed `[30d]` without). Lives top-right in the
 * header, mirroring the web's date-picker-in-header placement.
 *
 * `maxRangeDays` is the plan's ceiling as advertised by the last snapshot
 * (docs/specs/pricing.md). A window above it is DROPPED rather than dimmed,
 * because a dim pill is this surface's idiom for "available, not selected" and
 * offering a control that cannot work is worse than not offering it. Absent
 * means no ceiling was advertised, so every supported window shows.
 */
function rangePills(rangeDays: number, color: boolean, maxRangeDays?: number): string {
  const dim = (s: string) => paint(color, "2", s);
  return ALLOWED_RANGE_DAYS.filter(
    (d) => maxRangeDays === undefined || d <= maxRangeDays,
  )
    .map((d) => {
      const t = `${d}d`;
      if (d === rangeDays) return color ? paint(true, "1;36", t) : `[${t}]`;
      return dim(t);
    })
    .join("  ");
}

/** A stale-data note ("updated 2m ago"), or null while data is fresh. Surfaces
 *  ONLY once /live stops advancing `generatedAt`, so healthy use shows nothing. */
function freshnessNote(data: BoardData, ctx: RenderContext): string | null {
  const ago = formatAgo(data.generatedAt, ctx.now);
  return ago === "just now" ? null : `updated ${ago}`;
}

/** The working board's header border: the muted accent the identity block
 *  wears. The block never renders on a board with rows (ADR-2a), so the header
 *  IS the working board's identity moment; the input box stays dim chrome
 *  (BOARD-CRAFT round 2, buyer-picked V3). */
const HEADER_BORDER_CODE = "2;36";

/** The header's identity: the two-cell peak beside the bold wordmark. Shared by
 *  the live header and the no-identity connecting/unreachable fallbacks so every
 *  header path reads the same. */
function headerLeft(title: string, color: boolean): string {
  return ` ${miniMark(color)} ${paint(color, "1", title)}`;
}

/**
 * header — PURE. The product identity in its OWN rounded box, width-aligned with
 * the bottom input box (same `frameBoxWidth`, same corners, same left edge) so the
 * session is framed symmetrically top and bottom. The peak mark + wordmark sit
 * left under the muted accent border (the working board's identity moment); the
 * window filter (range pills) sits flush right, like the web's date-picker. A
 * stale-data note tucks in after the title only when load-bearing AND there is
 * room beside the pills (the control is never dropped for the note).
 */
function header(
  rangeDays: number,
  data: BoardData,
  ctx: RenderContext,
  title: string,
  maxRangeDays?: number,
): string[] {
  const inner = frameBoxWidth(ctx.width) - 2;

  const right = rangePillsRight(rangeDays, ctx.color, maxRangeDays); // trailing space off the border
  let left = headerLeft(title, ctx.color);

  const note = freshnessNote(data, ctx);
  if (note) {
    const withNote = `${left}  ${paint(ctx.color, "33", note)}`;
    if (visibleWidth(withNote) + 1 + visibleWidth(right) <= inner) left = withNote;
  }
  return boxLines(left, right, ctx.color, inner, HEADER_BORDER_CODE);
}

/**
 * overviewForWindow (PURE). The overview in hand, but ONLY when the worker built
 * it for the window currently on screen (it echoes the window as `rangeDays`).
 *
 * A range switch repaints the instant the key is pressed, while the new
 * /overview poll is still in flight, so what sits in `data.overview` for that
 * moment is the PREVIOUS window's numbers. Rendering them makes the zone label's
 * one falsifiable claim ("past 90 days", BOARD-CRAFT ADR-1) false, and the range
 * pills agree with the label, so nothing on screen would let the reader catch
 * it. Holding the aggregates back costs only the couple of seconds the new
 * window takes to build, a blink now that the worker reads hour rollups.
 *
 * A PLAN CEILING IS THE OTHER REASON THE WINDOWS CAN DISAGREE, and it must not
 * be treated the same way. A clamp is permanent, not in flight: the plan will
 * never build the wider window, and this surface persists its window to
 * `~/.seorak/terminal-layout.json`, so blanking here would leave a Free owner
 * with an aggregate-free board forever rather than for a blink. When the
 * mismatch is explained by `maxRangeDays`, the narrower snapshot is served and
 * the caller relabels it (docs/specs/pricing.md).
 *
 * Tolerant, like every other read on this surface: a body WITHOUT `rangeDays`
 * (an older worker, a cached response) is taken at face value rather than
 * blanking a board over a field we cast instead of parsed. The same applies to
 * an absent `maxRangeDays`, which simply means no ceiling was advertised.
 */
export function overviewForWindow(
  overview: OverviewSnapshot | null,
  days: number,
): OverviewSnapshot | null {
  if (overview === null) return null;
  const builtFor = overview.rangeDays as number | undefined;
  if (typeof builtFor !== "number" || builtFor === days) return overview;
  // Narrower because the plan says so, not because a poll is mid-flight.
  const ceiling = overview.maxRangeDays as number | undefined;
  if (typeof ceiling === "number" && days > ceiling && builtFor === ceiling) {
    return overview;
  }
  return null;
}

/** Indent a board line (leaving blank separators blank). */
function indent(line: string): string {
  return line === "" ? "" : `${" ".repeat(INDENT)}${line}`;
}

/**
 * renderFrame (PURE). Header, the board in the layout's chosen form, the
 * gateway. `title` lets the shell label it.
 */
export function renderFrame(
  layout: TerminalLayout,
  data: BoardData,
  ctx: RenderContext,
  title = "seorak",
): string {
  const dim = (s: string) => paint(ctx.color, "2", s);
  // The projects table is ABOUT every project, so a focus cannot narrow it
  // without reducing it to one useless row. In that view the selection is a
  // CURSOR rather than a scope: the table marks it and nothing else filters, and
  // the header says no breadcrumb, because a header that claims "chesstinker"
  // over a table listing nine other repos is the screen falsifying itself.
  const focusApplies = layout.view !== "projects";
  const scope = focusApplies ? ctx.scope : undefined;
  const cursorRepoId = ctx.scope?.repoId;
  const board = data.live
    .filter((s) => s.status !== "ended")
    .filter((s) => !scope || s.repoId === scope.repoId);
  const overview = overviewForWindow(data.overview, ctx.days);
  // The window the header CLAIMS has to be the window the numbers under it cover.
  // Those differ only when a plan ceiling clamped the request, and in that case
  // the served window is the true one -- the alternative is a header reading
  // "90d" over 30 days of aggregates, which is the falsifiable-claim failure the
  // zone labels exist to prevent (BOARD-CRAFT ADR-1, docs/specs/pricing.md).
  const shownDays = overview?.rangeDays ?? ctx.days;
  const ceiling = overview?.maxRangeDays;
  // The focused project's rollup. Null when the window holds no history for it
  // (a repo running right now that has not accrued in-window rows yet), which
  // reads as an honest "nothing in this window" rather than a blank.
  const focused = scope && overview ? projectRollup(overview, scope.repoId) : null;

  // First-run, mirroring the web's `hasAnyData` gate: only claim "no sessions
  // yet" when we actually HAVE the aggregate body and it is empty. With the
  // identity facts resolved, the day-zero screen is the full identity block
  // (ADR-2a) — the one moment the screen has room to say who seorak is.
  const firstRun = board.length === 0 && overview !== null && overview.usage.projects.length === 0;
  if (firstRun && ctx.identity) {
    return [
      ...identityBlock(ctx.identity, shownDays, ctx.color, ctx.width, ctx.animFrame ?? 0),
      "",
      ...(ctx.shippingBlocked
        ? [
            `  ${paint(ctx.color, "33", "captured events are waiting to ship (run seorak status)")}`,
            "",
          ]
        : []),
      "  No sessions yet. Your next Claude Code or Codex session will show up here.",
      "  When a session needs your attention, this screen says so first.",
    ].join("\n");
  }

  const out: string[] = [
    ...header(shownDays, data, ctx, scope ? `${title} ${dim("›")} ${scope.project}` : title, ceiling),
    "",
  ];

  // Mid-session full outage: the board below is the last real data, not live.
  if (ctx.connectionLost) {
    out.push(`  ${paint(ctx.color, "33", "connection lost, retrying (run seorak status if this keeps up)")}`, "");
  } else if (ctx.overviewStale) {
    out.push(`  ${paint(ctx.color, "33", "showing the last complete snapshot while the worker refreshes")}`, "");
  }
  if (ctx.shippingBlocked) {
    out.push(
      `  ${paint(ctx.color, "33", "captured events are waiting to ship (run seorak status)")}`,
      "",
    );
  }

  if (firstRun) {
    out.push("  No sessions yet. Your next Claude Code or Codex session will show up here.");
    out.push("  When a session needs your attention, this screen says so first.");
    return out.join("\n");
  }

  // THE PRODUCT. Attention leads because it is the only thing on this surface
  // you might have to act on, and both forms
  // put a blocked session in front of everything else for that reason.
  const usable = Math.max(20, Math.min(ctx.width, FRAME_MAX_WIDTH) - INDENT * 2);
  const aggregatesUnavailable = overview === null;

  if (layout.view === "projects") {
    // Attention leads in EVERY view. The projects table is about the window, but
    // a board that cannot tell you something is waiting on you has stopped doing
    // this surface's one job.
    for (const line of wrapText(nowSentence(board, ctx.now), usable)) out.push(indent(line));
    if (overview === null) {
      // the loader/failure notice below is the whole board in this state
    } else {
      out.push("");
      const table = projectTable(overview, PROJECT_TABLE_LIMIT);
      for (const line of renderProjects(table, ctx.color, usable, shownDays, cursorRepoId)) {
        out.push(indent(line));
      }
      if (ctx.interactive && table.rows.length > 1) {
        const picked = table.rows.find((r) => r.repoId === cursorRepoId);
        out.push(
          indent(
            dim(
              picked
                ? `up/down picks a project, enter opens ${picked.project}`
                : "up/down picks a project, enter opens it",
            ),
          ),
        );
      }
    }
  } else if (layout.view === "list") {
    const stats =
      overview === null ? [] : scope ? (focused ? projectRows(overview, focused) : []) : windowRows(overview, ctx.now, shownDays);
    for (const line of renderList(liveRows(board, ctx.now), stats, ctx.color, usable, shownDays)) {
      out.push(indent(line));
    }
    if (scope && overview !== null && focused === null) {
      out.push(indent(dim(`Nothing from ${scope.project} in the last ${shownDays} days yet.`)));
    }
  } else {
    for (const line of wrapText(nowSentence(board, ctx.now), usable)) out.push(indent(line));
    // The window paragraph. Sentences carry their own caveats, so there is no
    // zone label above them: "past 7 days" was the falsifiable claim a grid of
    // bare numerals could not make for itself, and each sentence now spells its
    // own window ("In the last 7 days ..."). A label repeating it would be the
    // decoration the same ADR rules out.
    if (overview !== null) {
      const sentences = scope
        ? focused
          ? projectSentences(overview, focused, shownDays)
          : [`Nothing from ${scope.project} in the last ${shownDays} days yet.`]
        : windowSentences(overview, ctx.now, shownDays);
      const paragraph = sentences.join(" ");
      if (paragraph !== "") {
        out.push("");
        for (const line of wrapText(paragraph, usable)) out.push(indent(line));
      }
    }
  }

  // The unavailable state names the WINDOW that isn't answering and what fills
  // it in next, never a shrug. No zone label here: the label scopes numbers, and
  // there are none (BOARD-CRAFT round 2). It says "past N days" rather than "the
  // N day view" so the wait wears the same words the numbers would have arrived
  // under.
  //
  // The live session tells LOADING apart from FAILED, because every window now
  // builds in about two seconds: a wait that outlasts a blink is a failure, and
  // saying "still waiting" through it would be a slow lie. The old "switches to
  // a smaller window" remedy retired on the same measurement, since 7d and 90d
  // cost within half a second of each other, so a narrower window fixes nothing
  // and blaming it would send the reader somewhere that cannot help. `seorak
  // status` is not offered either: /live is answering (that is why the board is
  // on screen instead of the unreachable one), so status would report a
  // healthy worker and contradict the line above it.
  if (aggregatesUnavailable) {
    if (ctx.interactive && !ctx.overviewFailing) {
      // In flight: a spinner, because a static "still waiting" line through a
      // two-second build reads as a stall rather than as work happening.
      out.push("", `  ${loaderLine(`reading the last ${ctx.days} days`, ctx.color, ctx.animFrame)}`);
    } else {
      const notice = ctx.interactive
        ? `The last ${ctx.days} days did not come back. Still retrying.`
        : `The last ${ctx.days} days did not come back.`;
      out.push("", `  ${dim(notice)}`);
    }
  }

  for (const line of gatewayLines(ctx, dim)) out.push(line);

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/**
 * gatewayLines (PURE). The door to the dashboard, which is the OTHER half of
 * this surface's job: the paragraph says what is true, and this says where the
 * rest of it lives. The terminal is deliberately not the place to browse depth.
 *
 * The URL is printed WITHOUT the one-click `#token` fragment that `seorak init`
 * attaches. Init prints once into scrollback; this sits on screen for as long as
 * the session is open, through every screen share and screenshot, and a bearer
 * token does not belong there. Cmd-click still opens it, and `seorak init` is
 * still the path that signs the browser in.
 */
function gatewayLines(ctx: RenderContext, dim: (s: string) => string): string[] {
  if (!ctx.gateway) return [];
  return ["", `  ${dim("Charts, replay, and the model live in the dashboard:")}`, `  ${ctx.gateway}`];
}

/** The loader's glyphs: braille dots that travel around the cell, the standard
 *  CLI spinner. ~10fps reads as motion rather than a strobe. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/**
 * loaderLine (PURE). A labelled spinner: `⠹ reading the last 30 days`. Shown
 * while a fetch is genuinely in flight and never otherwise, so the motion is
 * caused by a request rather than by a timer looking busy.
 *
 * Color off (or no frame) drops to static text with a leading `…`, which is the
 * reduced-motion path every other animated element on this surface takes.
 */
export function loaderLine(label: string, color: boolean, frame?: number): string {
  const glyph = color && frame !== undefined ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length]! : "…";
  return paint(color, "2", `${glyph} ${label}`);
}

/**
 * renderConnecting — PURE. The boxed "connecting…" placeholder shown once before
 * the first poll lands, so the very first paint already carries the frame. With
 * color on and a `frame` index (the shell advances it on a short timer), a
 * spinner glyph leads the line; color off (or no frame) stays static text — the
 * reduced-motion path. When the worker URL is known it is named (identity
 * through state): a wrong target is visible
 * at a glance instead of surfacing later as "unreachable".
 */
export function renderConnecting(
  color = false,
  width = FRAME_MAX_WIDTH,
  title = "seorak",
  frame?: number,
  workerUrl?: string,
  _identity?: IdentityFacts,
  rangeDays = 7,
): string {
  // Deliberately NOT the identity block. The first /live lands in about a
  // quarter of a second, so rendering the full block here made it flash on
  // screen and vanish before it could be read, which is the worst of both: too
  // slow to be invisible, too fast to be a screen. The block is now the entry
  // card (renderEntry), which persists because it has something to say, and this
  // is a loader, which is what a quarter second of waiting actually deserves.
  const head = boxLines(headerLeft(title, color), rangePillsRight(rangeDays, color), color, frameBoxWidth(width) - 2, HEADER_BORDER_CODE);
  const target = workerUrl ? ` to ${hostOf(workerUrl)}` : "";
  return [...head, "", `  ${loaderLine(`connecting${target}`, color, frame)}`].join("\n");
}

/** The header's right side, shared by the live header and the connecting one so
 *  the window control does not appear only after the data lands. */
function rangePillsRight(rangeDays: number, color: boolean, maxRangeDays?: number): string {
  return `${rangePills(rangeDays, color, maxRangeDays)} `;
}

/**
 * renderEntry (PURE). The one screen the session opens on when it has something
 * true to say: the identity block carrying the message, and a line telling you
 * how to leave. It waits for a keypress, which a loading state never should.
 */
export function renderEntry(
  message: { label: string; body: readonly string[] },
  identity: IdentityFacts,
  rangeDays: number,
  color: boolean,
  width: number,
  pulse = 0,
): string {
  return [
    ...identityBlock(identity, rangeDays, color, width, pulse, message),
    "",
    `  ${paint(color, "2", "press any key to continue")}`,
  ].join("\n");
}

/**
 * renderUnreachable — PURE. The honest screen when neither /live nor /overview
 * answered: local capture is unaffected, so point at status, never fail. Kept
 * inside the SAME header box as the live board so the session never loses its
 * frame just because the network blipped.
 */
export function renderUnreachable(
  workerUrl: string,
  color = false,
  width = FRAME_MAX_WIDTH,
  title = "seorak",
  identity?: IdentityFacts,
  rangeDays = 7,
  pulse = 0,
): string {
  if (identity) {
    // The block already names the worker; the message doesn't repeat the URL.
    return [
      ...identityBlock(identity, rangeDays, color, width, pulse),
      "",
      "  Cannot reach the worker right now. Your sessions are still being",
      "  captured locally. Run seorak status to check the connection.",
    ].join("\n");
  }
  const head = boxLines(headerLeft(title, color), "", color, frameBoxWidth(width) - 2, HEADER_BORDER_CODE);
  return [
    ...head,
    "",
    `  Cannot reach the worker at ${workerUrl}. Your sessions are still being`,
    "  captured locally. Run seorak status to check the connection.",
  ].join("\n");
}
