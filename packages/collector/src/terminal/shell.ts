/**
 * shell.ts — the IMPURE terminal session: fetch → render → input → repaint. The
 * PURE pieces it orchestrates (frame, layout, fetch client, parser, router) are
 * unit-tested without a TTY. This module owns the alternate-screen buffer, poll
 * intervals, and raw-mode keypress input behind an injectable terminal runtime
 * so entry and cleanup behavior are executable tests rather than manual claims.
 *
 * Dependency choice (documented per the design constraint): ZERO new deps — raw
 * ANSI + node:readline keypress events. No neo-blessed / Ink / React. This keeps
 * the collector's "Node built-ins only" promise and the cleanest OSS-extraction +
 * supply-chain story; a stat stack + one input line does not justify a TUI lib.
 *
 * The board is a 1-D vertical stack repainted in full on each poll tick and each
 * keystroke (cheap at this size); we own the bottom input line entirely (rather
 * than fighting readline's own line rendering above a repainting region).
 */
import { emitKeypressEvents } from "node:readline";
import { fetchBoard, fetchLive, fetchOverviewConditional } from "./fetch.ts";
import { ALLOWED_RANGE_DAYS, loadLayout, saveLayout, setRangeDays, setView } from "./layout.ts";
import { overviewForWindow, renderConnecting, renderEntry, renderFrame, renderUnreachable } from "./render/frame.ts";
import { entryCard, parseNews, type EntryCard } from "./news.ts";
import { scopeChoices, type Scope } from "./narrative.ts";
import { collectorVersion, loadNews, readLastSeenVersion, writeLastSeenVersion } from "./news-store.ts";
import { completeBuffer, renderFooter, resolveOnEnter, suggestions } from "./render/prompt.ts";
import { parseInput } from "./input/parser.ts";
import { routeInput } from "./input/router.ts";
import { hostOf } from "./render/identity.ts";
import { dashboardDeepLink } from "../dashboard.ts";
import { readShippingStatus } from "../shipping-status.ts";
import { getDemoBoard, type DemoScenarioId } from "./demo/fixtures.ts";
import {
  isAggregateCacheStale,
  type OverviewSnapshot,
  type SessionSummary,
} from "@seorak/types";
import type { BoardData, IdentityFacts, RenderContext, TerminalLayout } from "./types.ts";

/** Short-cadence /live poll — the live board "feel". */
const LIVE_POLL_MS = 3000;
/** Slow-cadence /overview poll — the heavy windowed aggregate. */
const OVERVIEW_POLL_MS = 15000;
/** Quiet-state shimmer cadence (the connecting spinner rides the same timer).
 *  The timer exists ONLY while an identity block is on screen (day-zero,
 *  connecting, unreachable-empty) and only with color on — a board with real
 *  rows never runs a frame loop, and color off is the static path. ~10fps is
 *  what makes the gradient read as one smooth motion instead of stepped jumps. */
const ANIM_MS = 100;
/** A shimmer introduces the screen; it is not ambient work. The budget belongs
 *  to the whole interactive session, so polls, resizes, and later quiet states
 *  cannot replenish it. This caps a session at 150 full-screen animation
 *  repaints even when the worker stays down indefinitely. */
const ANIM_BUDGET_MS = 15_000;
const MAX_ANIMATED_FRAMES = Math.floor(ANIM_BUDGET_MS / ANIM_MS);
/** The resting footer: what you can PRESS, not what you can already read. The
 *  window used to be echoed here ("showing the last 7 days") and the paragraph
 *  already opens with it, so the line spent itself agreeing with the screen. */
/** Keys are SPELLED, not drawn. U+2190..2193 (←↑↓→) are not cell-exact in a
 *  monospace font: most terminals font-fall-back for them and render them at a
 *  different size and baseline than the text beside them, which no amount of
 *  app-side alignment can fix. This is the same lesson the identity mark already
 *  carries about ▲ (Block Elements only, never Geometric Shapes). Words also
 *  read better to someone who has not memorised the board. */
const HINTS = ["left/right change the window, up/down focus a project, /help for more"];
/** After this many consecutive failures a poll loop drops to its slow cadence
 *  (mirrors the web's POLL_MS → SLOW_POLL_MS degradation): a downed worker gets
 *  probed gently, and the first success snaps the cadence back. */
const SLOW_AFTER_FAILURES = 3;
const LIVE_POLL_SLOW_MS = 30_000;
const OVERVIEW_POLL_SLOW_MS = 60_000;

export interface ShellOptions {
  workerUrl: string;
  color: boolean;
  /** Owner access token, sent as `Authorization: Bearer` on
   *  the read polls when the worker is armed. Resolved by the CLI from env/plist;
   *  undefined against an open/local worker. */
  accessToken?: string;
  /** Which agents this machine actually captures ("Claude Code and Codex"),
   *  resolved by the CLI from the real hooks + tailer root; null when nothing is
   *  installed yet. Feeds the identity block's `watching` row (ADR-2a). */
  watching?: string | null;
  /** When set, render demo fixtures instead of fetching (no worker needed). */
  demo?: DemoScenarioId;
  /** In-memory `--days` window override; when set it supersedes the persisted
   *  layout's rangeDays for this run (not saved). */
  rangeDays?: number;
}

export interface TerminalInput {
  isTTY?: boolean;
  setRawMode(enabled: boolean): void;
  pause(): unknown;
  resume(): unknown;
  on(
    event: "keypress",
    listener: (
      value: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ) => void,
  ): unknown;
  off(
    event: "keypress",
    listener: (
      value: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ) => void,
  ): unknown;
}

export interface TerminalOutput {
  columns?: number;
  write(value: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

export interface TerminalRuntime {
  input: TerminalInput;
  output: TerminalOutput;
  enableKeypressEvents(): void;
}

const processTerminalRuntime: TerminalRuntime = {
  input: process.stdin,
  output: process.stdout,
  enableKeypressEvents: () => emitKeypressEvents(process.stdin),
};

/** Apply the optional `--days` override to a freshly-loaded layout (in-memory). */
function withRangeOverride(layout: TerminalLayout, override?: number): TerminalLayout {
  return override === undefined ? layout : { ...layout, rangeDays: override };
}

function width(output: TerminalOutput = process.stdout): number {
  return output.columns ?? 80;
}

function makeContext(
  layout: TerminalLayout,
  options: ShellOptions,
  output: TerminalOutput = process.stdout,
  shippingBlocked = false,
): RenderContext {
  const gateway = gatewayUrl(options);
  return {
    color: options.color,
    width: width(output),
    now: Date.now(),
    days: layout.rangeDays,
    identity: identityFacts(options),
    ...(shippingBlocked ? { shippingBlocked: true } : {}),
    ...(gateway === undefined ? {} : { gateway }),
  };
}

function localShippingBlocked(options: ShellOptions): boolean {
  if (options.demo) return false;
  const status = readShippingStatus();
  return status.kind === "current" && status.snapshot.state === "blocked";
}

/**
 * resolveEntry, the entry card for this launch, and the write that stops it
 * repeating. The version is recorded HERE rather than on dismissal: a note you
 * ctrl-C out of has still been on your screen, and nagging is worse than a note
 * you skipped.
 *
 * Every read is best-effort. A missing NEWS.md or an unwritable state dir costs
 * a note, never a session.
 */
function resolveEntry(options: ShellOptions): EntryCard | null {
  // Two demo scenarios exist ONLY to make this screen viewable: it otherwise
  // needs an uninstalled machine or an unseen version, neither of which you can
  // arrange on a machine that already runs seorak. They render the real card
  // from the real NEWS.md, against demo identity facts, so nothing leaks.
  if (options.demo === "welcome") {
    return entryCard({ version: "0.0.0", lastSeen: null, news: "", watching: null });
  }
  if (options.demo === "news") {
    // The newest release in NEWS.md, whatever it is. Deliberately NOT run through
    // the version comparison: the point is to see what a note LOOKS like, and on
    // a build whose version has never been bumped no release is ever "newer".
    const newest = parseNews(loadNews())[0];
    return newest
      ? { reason: "news", label: `new in ${newest.version}`, body: newest.lines }
      : { reason: "news", label: "new", body: ["NEWS.md has no entries yet."] };
  }
  if (options.demo) return null; // every other demo is for screenshots, not news
  const version = collectorVersion();
  const lastSeen = readLastSeenVersion();
  const card = entryCard({
    version,
    lastSeen,
    news: loadNews(),
    watching: options.watching ?? null,
  });
  if (lastSeen !== version) writeLastSeenVersion(version);
  return card;
}

/** The dashboard this session hands off to. Demo mode offers none: the demo
 *  exists to be screenshotted, and a workers.dev host carries the owner's
 *  account name. No token rides the URL (see `gatewayLines`). */
export function gatewayUrl(options: ShellOptions): string | undefined {
  return options.demo ? undefined : dashboardDeepLink(options.workerUrl);
}

/** The identity block's facts, resolved once from the shell options. Demo mode
 *  never shows the real worker host: demo exists to be looked at (and
 *  screenshotted), and a workers.dev host carries the owner's account name. */
export function identityFacts(options: ShellOptions): IdentityFacts {
  return {
    // The welcome demo is a machine that captures NOTHING, so the facts row has
    // to agree with the card in front of it: showing "Claude Code and Codex"
    // above "nothing is being captured yet" is the screen contradicting itself.
    watching: options.demo === "welcome" ? null : options.watching ?? null,
    workerHost: options.demo ? "demo data (not connected)" : hostOf(options.workerUrl),
  };
}

/**
 * runOnce — the `seorak --once` render: fetch (or demo) a single board, print it,
 * exit. `json` dumps the assembled snapshot instead.
 * Never fails the exit code — a glance, not a health gate (`seorak status` owns
 * that contract).
 */
export async function runOnce(options: ShellOptions & { json?: boolean }): Promise<number> {
  const layout = withRangeOverride(loadLayout(), options.rangeDays);

  let data: BoardData;
  let reachable: boolean;
  if (options.demo) {
    data = getDemoBoard(options.demo, Date.now(), layout.rangeDays);
    reachable = true;
  } else {
    ({ data, reachable } = await fetchBoard(options.workerUrl, layout.rangeDays, options.accessToken));
  }

  if (options.json) {
    console.log(JSON.stringify(reachable ? data : { error: "unreachable", workerUrl: options.workerUrl }, null, 2));
    return 0;
  }

  if (!reachable) {
    console.log(
      renderUnreachable(options.workerUrl, options.color, width(), "seorak", identityFacts(options), layout.rangeDays),
    );
    return 0;
  }
  console.log(
    renderFrame(
      layout,
      data,
      makeContext(layout, options, process.stdout, localShippingBlocked(options)),
      "seorak",
    ),
  );
  return 0;
}

/**
 * runInteractive — the live session (`seorak`). Falls back to `runOnce` when
 * stdin is not a TTY (piped / CI) since there is no interactive input to read.
 */
export async function runInteractive(
  options: ShellOptions,
  runtime: TerminalRuntime = processTerminalRuntime,
): Promise<number> {
  const input = runtime.input;
  if (!input.isTTY) return runOnce(options);

  const out = runtime.output;
  let layout = withRangeOverride(loadLayout(), options.rangeDays);
  let data: BoardData = { live: [], generatedAt: null, overview: null };
  let lastLiveOk = false;
  let lastOverviewOk = false;
  let fetchedOnce = false;
  let statusLines: string[] = [...HINTS];
  let buffer = "";
  /** Highlighted palette row (arrow-navigable). Reset to the top whenever the
   *  buffer changes, since the suggestion set changes with it. */
  let selected = 0;
  let stopped = false;
  /** Quiet-state shimmer phase; its timer runs only while the identity block
   *  (or the connecting screen) is what's on screen. */
  let animFrame = 0;
  let animatedFrames = 0;
  let quietTimer: NodeJS.Timeout | undefined;
  /** The entry card, when this launch has something true to say. Dismissed by
   *  any key; the version is recorded the moment it is shown, so a note appears
   *  once per upgrade even if you quit out of it. */
  let entry: EntryCard | null = resolveEntry(options);
  /** The focused project, or null for everything. ↑/↓ walk this the way ←/→
   *  walk the window: two axes, two arrow pairs, symmetric. */
  let scope: Scope | null = null;
  /** Conditional-GET state for /overview: the etag is only valid for the window
   *  it came from, so it resets on a range switch. */
  let overviewEtag: string | null = null;
  let overviewEtagDays = layout.rangeDays;
  /** Monotonic /overview request generation. A range switch fires a fetch while
   *  the previous window's fetch is still in flight (←/→ is one keystroke and the
   *  aggregate takes ~2s to build), and the two can land in either order — so a
   *  response is only allowed to touch this session's state while it is still the
   *  NEWEST one asked for. Without it, the slower first response landed last and
   *  wrote its window's snapshot, etag, and reachability over the newer one:
   *  `overviewForWindow` then held the mismatched aggregate back, blanking the
   *  paragraph until the next poll, and the stale etag stayed paired with the new
   *  window. Generation rather than an AbortController because the fix needed is
   *  discarding on ARRIVAL, and the transport already owns a controller for its
   *  own timeout (fetch.ts); a superseded request costs one in-flight GET that
   *  the worker answers from its cache. */
  let overviewGeneration = 0;
  /** The board as of the PREVIOUS poll observation, per endpoint — the basis of
   *  the value-change flash (ctx.prev). Updated ONLY at poll boundaries, so a
   *  keystroke repaint between polls reuses the same flash set; a failed poll
   *  clears it (stale flash through an outage would claim change that isn't
   *  being observed). TERMINAL-BOARD-CRAFT ADR-5. */
  let prevLive: SessionSummary[] = [];
  let prevOverview: OverviewSnapshot | null = null;
  /** Consecutive failures per poll loop — drives the slow-cadence backoff. */
  let liveFailures = 0;
  let overviewFailures = 0;
  let shippingBlocked = localShippingBlocked(options);
  let liveTimer: NodeJS.Timeout | undefined;
  let overviewTimer: NodeJS.Timeout | undefined;

  const reachable = () => lastLiveOk || lastOverviewOk;

  function paint(): void {
    const ctx = makeContext(layout, options, out, shippingBlocked);
    if (options.color) ctx.animFrame = animFrame;
    ctx.interactive = true;
    // Loading or broken: the aggregate builds in about two seconds, so the
    // notice below an absent overview must not say "still waiting" once a poll
    // has actually come back empty-handed.
    ctx.overviewFailing = overviewFailures > 0;
    if (data.overviewStale !== undefined) {
      ctx.overviewStale = data.overviewStale;
    }
    if (scope) ctx.scope = scope;
    const overview = overviewForWindow(data.overview, layout.rangeDays);
    const hasData = data.generatedAt !== null || data.overview !== null;
    const board = data.live.filter((s) => s.status !== "ended");
    // Same window gate the frame applies, so the two agree on whether this is
    // the day-zero screen: disagreeing would leave the shimmer timer running
    // under a board that has rows.
    const firstRunQuiet = board.length === 0 && overview !== null && overview.usage.projects.length === 0;
    let body: string;
    let quiet: boolean;
    if (entry) {
      body = renderEntry(entry, ctx.identity!, layout.rangeDays, options.color, width(out), animFrame);
      quiet = true;
    } else if (options.demo || reachable()) {
      body = renderFrame(layout, data, ctx, "seorak");
      quiet = firstRunQuiet;
    } else if (!fetchedOnce) {
      body = renderConnecting(
        options.color,
        width(out),
        "seorak",
        options.color ? animFrame : undefined,
        options.workerUrl,
        ctx.identity,
        layout.rangeDays,
      );
      quiet = true;
    } else if (hasData && !firstRunQuiet) {
      // FULL outage mid-session: the last-known board is real data, so keep
      // showing it (the header's "updated N ago" note carries the age) under a
      // connection-lost banner, instead of discarding it for the empty screen.
      ctx.connectionLost = true;
      body = renderFrame(layout, data, ctx, "seorak");
      quiet = false;
    } else {
      body = renderUnreachable(
        options.workerUrl,
        options.color,
        width(out),
        "seorak",
        ctx.identity,
        layout.rangeDays,
        animFrame,
      );
      quiet = true;
    }
    const footer = renderFooter(buffer, layout, statusLines, options.color, width(out), selected);
    const content = [body, "", ...footer.lines].join("\n");
    // Repaint the whole screen, then move the caret back UP into the input box
    // (relative from the bottom, so it's independent of the board's height) and
    // out to the column just after the buffer.
    const linesAfterInput = footer.lines.length - 1 - footer.inputLineOffset;
    const move = `${linesAfterInput > 0 ? `\x1b[${linesAfterInput}A` : ""}\x1b[${footer.cursorCol}G`;
    out.write(`\x1b[H\x1b[J${content}${move}`);
    // The timer runs while a quiet screen is showing OR while a fetch is in
    // flight (the loader's dots). Both are color-gated, and a settled board with
    // nothing outstanding runs no timer at all.
    const animating = quiet || (overview === null && !ctx.overviewFailing);
    if (animating && options.color && !stopped) startShimmer();
    else stopShimmer();
  }

  function startShimmer(): void {
    if (quietTimer || animatedFrames >= MAX_ANIMATED_FRAMES) return;
    quietTimer = setInterval(() => {
      try {
        animFrame++;
        animatedFrames++;
        if (!stopped) paint();
        if (animatedFrames >= MAX_ANIMATED_FRAMES) stopShimmer();
      } catch {
        stop(1);
      }
    }, ANIM_MS);
  }

  function stopShimmer(): void {
    if (quietTimer) {
      clearInterval(quietTimer);
      quietTimer = undefined;
    }
  }

  // ── data refresh ──────────────────────────────────────────────────────────
  function refreshDemo(): void {
    prevLive = data.live;
    prevOverview = data.overview;
    data = getDemoBoard(options.demo!, Date.now(), layout.rangeDays);
    lastLiveOk = true;
    lastOverviewOk = true;
    fetchedOnce = true;
  }
  async function pollLive(): Promise<void> {
    const res = await fetchLive(options.workerUrl, options.accessToken);
    fetchedOnce = true;
    // Either way this is a poll boundary: the flash basis moves forward (a
    // success flashes what changed; a failure clears rather than letting a
    // stale flash survive an outage).
    prevLive = data.live;
    if (res) {
      lastLiveOk = true;
      liveFailures = 0;
      data = { ...data, live: res.live, generatedAt: res.generatedAt };
    } else {
      lastLiveOk = false;
      liveFailures++;
    }
    shippingBlocked = localShippingBlocked(options);
    if (!stopped) paint();
  }
  async function pollOverview(): Promise<void> {
    const requestedDays = layout.rangeDays;
    // The etag is only valid for the window it came from.
    if (overviewEtagDays !== requestedDays) {
      overviewEtag = null;
      overviewEtagDays = requestedDays;
    }
    const generation = ++overviewGeneration;
    const res = await fetchOverviewConditional(
      options.workerUrl,
      requestedDays,
      options.accessToken,
      overviewEtag,
    );
    // Superseded: a newer window was requested while this was in flight, so this
    // answer describes a window that is no longer on screen. Discard it WHOLE —
    // body, etag, and verdict alike. In particular it must not count as a failure
    // or a success: the newer request owns reachability now, and an answer nobody
    // is waiting for is not evidence about the connection. Nothing repaints,
    // because the newer request is what the screen is waiting on.
    if (generation !== overviewGeneration) return;
    fetchedOnce = true;
    // Poll boundary for the aggregate flash basis (a 304 keeps the same object,
    // so nothing reads as changed).
    prevOverview = data.overview;
    if (res.status === "failed") {
      lastOverviewOk = false;
      overviewFailures++;
      // A failed refresh does not invalidate the last complete aggregate, but
      // it does invalidate any claim that the copy is current.
      if (data.overview !== null) data = { ...data, overviewStale: true };
    } else {
      lastOverviewOk = true;
      overviewFailures = 0;
      overviewEtag = res.etag;
      const overviewStale = isAggregateCacheStale(res.cacheStatus);
      // A 304 means the copy in hand still stands; only a fresh body replaces it.
      data =
        res.status === "ok"
          ? { ...data, overview: res.overview, overviewStale }
          : { ...data, overviewStale };
    }
    shippingBlocked = localShippingBlocked(options);
    adoptAdvertisedCeiling();
    if (!stopped) paint();
  }

  /** No asynchronous poll is allowed to reject past the terminal owner. A
   * transport already degrades expected failures, so reaching this catch means
   * an unexpected client/render failure and must restore the TTY before exit. */
  function runPoll(
    poll: () => Promise<void>,
    scheduleNext?: () => void,
  ): void {
    void poll()
      .then(() => {
        if (!stopped) scheduleNext?.();
      })
      .catch(() => stop(1));
  }

  /**
   * Narrow the persisted window to the plan's ceiling once the worker has
   * advertised one (docs/specs/pricing.md).
   *
   * Without this the session keeps ASKING for a window it will never be served,
   * every poll, forever: the window lives in `~/.seorak/terminal-layout.json`, so
   * an owner who selected 90d before a plan change would re-request it on every
   * launch and read a clamped 30d body each time. The render path already labels
   * that honestly, but re-asking is waste with no upside.
   *
   * Persisting rather than only narrowing in memory is deliberate: the ask is
   * what should stop, and the next launch reads the file. The change is not
   * destructive, since a wider plan re-offers the wider pill immediately.
   */
  function adoptAdvertisedCeiling(): void {
    const ceiling = data.overview?.maxRangeDays;
    if (typeof ceiling !== "number" || layout.rangeDays <= ceiling) return;
    layout = setRangeDays(layout, ceiling);
    saveLayout(layout);
  }

  // ── input ───────────────────────────────────────────────────────────────
  /** Adopt a new layout + persist it; a range change must re-pull the overview
   *  against the new window. Shared by slash-commands and the arrow-key window
   *  switcher so both paths behave identically. */
  function adoptLayout(next: TerminalLayout): void {
    layout = next;
    saveLayout(layout);
    if (!options.demo) runPoll(pollOverview);
    else refreshDemo();
  }

  /** The windows this deployment's plan will actually build, which is what the
   *  arrow keys may cycle through. Matches the pills the header draws, so the
   *  control and the affordance cannot disagree. Before any snapshot has
   *  advertised a ceiling, every supported window is cyclable — the worker clamps
   *  regardless (docs/specs/pricing.md). */
  function servableRanges(): number[] {
    const ceiling = data.overview?.maxRangeDays;
    const servable = ALLOWED_RANGE_DAYS.filter(
      (d) => typeof ceiling !== "number" || d <= ceiling,
    );
    return servable.length > 0 ? [...servable] : [...ALLOWED_RANGE_DAYS];
  }

  /** Step the overview window to the previous/next allowed value (wrapping),
   *  driven by the ← / → keys when the input line is empty — the easy switch for
   *  the header's range pills, alongside the explicit `/range` command. */
  function cycleRange(dir: 1 | -1): void {
    const days = servableRanges();
    const i = Math.max(0, days.indexOf(layout.rangeDays));
    const nextDays = days[(i + dir + days.length) % days.length]!;
    if (nextDays !== layout.rangeDays) {
      adoptLayout(setRangeDays(layout, nextDays));
      // No acknowledgement line: the paragraph's own first sentence names the
      // window it covers ("In the last 30 days ..."), so "showing the last 30
      // days" underneath was the screen agreeing with itself. The footer keeps
      // the hints, which is the thing a reader cannot already see.
      statusLines = [...HINTS];
    }
  }

  /** Step the focus to the previous/next project, wrapping through "everything"
   *  at index 0 so there is always a way back out without reaching for Escape. */
  function cycleScope(dir: 1 | -1): void {
    const choices = scopeChoices(data.live, overviewForWindow(data.overview, layout.rangeDays));
    if (choices.length === 0) return;
    const ring: Array<Scope | null> = [null, ...choices];
    const at = scope === null ? 0 : Math.max(0, ring.findIndex((c) => c?.repoId === scope!.repoId));
    scope = ring[(at + dir + ring.length) % ring.length] ?? null;
    statusLines = [...HINTS];
  }

  function applyResult(raw: string): void {
    const result = routeInput(parseInput(raw), layout);
    if (result.quit) {
      stop();
      return;
    }
    if (result.layout) adoptLayout(result.layout);
    if (result.lines) statusLines = result.lines;
    else if (result.message) statusLines = [result.message];
    else if (raw.trim() !== "") statusLines = [];
  }

  function onKeypress(str: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }): void {
    if (key.ctrl && (key.name === "c" || key.name === "d")) {
      stop();
      return;
    }
    // The entry card is a screen, not a modal stack: any key clears it and the
    // board (already polling behind it) takes over.
    if (entry) {
      entry = null;
      if (!stopped) paint();
      return;
    }
    const paletteLen = suggestions(buffer, layout).length;
    if (key.name === "return" || key.name === "enter") {
      // In the projects table with nothing typed, Enter OPENS the picked row:
      // the table is the list, the paragraph is the detail, and this is the step
      // between them. Everywhere else Enter still belongs to the palette.
      if (buffer === "" && layout.view === "projects" && scope) {
        adoptLayout(setView(layout, "paragraph"));
        statusLines = [`showing ${scope.project}`];
        if (!stopped) paint();
        return;
      }
      // Enter CHOOSES the highlighted palette row (or submits free text).
      const { submit, buffer: next } = resolveOnEnter(buffer, layout, selected);
      buffer = next;
      selected = 0;
      if (submit !== null) applyResult(submit);
    } else if (key.name === "tab") {
      // Accept the highlighted suggestion into the buffer (no run).
      const completed = completeBuffer(buffer, layout, selected);
      if (completed !== null) buffer = completed;
      selected = 0;
    } else if ((key.name === "up" || key.name === "down") && paletteLen > 0) {
      // Move the palette highlight (wrapping).
      const dir = key.name === "down" ? 1 : -1;
      selected = (selected + dir + paletteLen) % paletteLen;
    } else if ((key.name === "up" || key.name === "down") && buffer === "") {
      // ↑/↓ focus a project when not mid-edit. Same shape as ←/→ for the window.
      cycleScope(key.name === "down" ? 1 : -1);
    } else if (key.name === "backspace") {
      buffer = buffer.slice(0, -1);
      selected = 0;
    } else if (key.name === "escape") {
      // Escape clears the buffer, or drops the focus when there is nothing to
      // clear: one key for "back out of whatever I am in".
      if (buffer === "") scope = null;
      buffer = "";
      selected = 0;
    } else if ((key.name === "left" || key.name === "right") && buffer === "") {
      // ← / → switch the date range when not mid-edit (the header pills).
      cycleRange(key.name === "right" ? 1 : -1);
    } else if (str && !key.ctrl && !key.meta && str >= " " && str !== "\t") {
      buffer += str;
      selected = 0;
    }
    if (!stopped) paint();
  }

  function onResize(): void {
    if (!stopped) paint();
  }

  function guardCallback(callback: () => void): void {
    try {
      callback();
    } catch {
      stop(1);
    }
  }

  const guardedKeypress = (
    str: string | undefined,
    key: { name?: string; ctrl?: boolean; meta?: boolean },
  ): void => guardCallback(() => onKeypress(str, key));
  const guardedResize = (): void => guardCallback(onResize);

  // ── lifecycle ─────────────────────────────────────────────────────────────
  const timers: NodeJS.Timeout[] = [];
  let resolveExit!: (code: number) => void;
  const done = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  function stop(exitCode = 0): void {
    if (stopped) return;
    stopped = true;
    for (const t of timers) clearInterval(t);
    stopShimmer();
    if (liveTimer) clearTimeout(liveTimer);
    if (overviewTimer) clearTimeout(overviewTimer);
    input.off("keypress", guardedKeypress);
    out.off("resize", guardedResize);
    // Cleanup is best-effort per operation. One failing stream method must not
    // prevent the remaining terminal restoration sequence.
    try {
      if (input.isTTY) input.setRawMode(false);
    } catch {}
    try {
      input.pause();
    } catch {}
    try {
      out.write("\x1b[?25h\x1b[?1049l"); // show cursor + leave alternate screen
    } catch {}
    resolveExit(exitCode);
  }

  try {
    // Enter the alternate screen so the session restores the user's scrollback on exit.
    out.write("\x1b[?1049h\x1b[H\x1b[J");
    runtime.enableKeypressEvents();
    input.setRawMode(true);
    input.resume();
    input.on("keypress", guardedKeypress);
    out.on("resize", guardedResize);

    if (options.demo) {
      refreshDemo();
      paint();
      // Re-tick so relative "ago" stays fresh; demo never hits the network.
      timers.push(
        setInterval(
          () => guardCallback(() => {
            refreshDemo();
            if (!stopped) paint();
          }),
          LIVE_POLL_MS,
        ),
      );
    } else {
      paint(); // starts the quiet-state shimmer itself (connecting is quiet)
      // Self-scheduling poll loops (not fixed intervals) so each tick can pick
      // its cadence: normal while healthy, slow after repeated failures.
      const scheduleLive = (): void => {
        const delay = liveFailures >= SLOW_AFTER_FAILURES ? LIVE_POLL_SLOW_MS : LIVE_POLL_MS;
        liveTimer = setTimeout(
          () => runPoll(pollLive, scheduleLive),
          delay,
        );
      };
      const scheduleOverview = (): void => {
        const delay =
          overviewFailures >= SLOW_AFTER_FAILURES
            ? OVERVIEW_POLL_SLOW_MS
            : OVERVIEW_POLL_MS;
        overviewTimer = setTimeout(
          () => runPoll(pollOverview, scheduleOverview),
          delay,
        );
      };
      runPoll(pollLive);
      runPoll(pollOverview);
      scheduleLive();
      scheduleOverview();
    }
  } catch {
    stop(1);
  }

  return done;
}
