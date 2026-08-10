// Replay lenses — the analysis layer, deliberately React-free.
//
// A lens is a self-describing question over the replay payload plus a PURE
// function that answers it as plain, serializable data. That split is the whole
// point: the cockpit is one consumer of a lens result, and a future
// `GET /replay/lenses` route or MCP tool can return the same object verbatim,
// so an agent reads exactly what a person reads — described by its own
// metadata rather than by whatever the UI happened to render.
//
// Nothing in this directory may import React or touch the DOM. Inputs are the
// replay payload and session summaries; outputs are rows of numbers and
// already-formatted strings. Compute lives here rather than in
// `packages/types` because that package is publish-safe only and explicitly
// excludes scoring and evaluation implementation; when the worker grows the
// API, these functions move there unchanged.

import type { SessionSummary } from '../../../lib/apiSchemas.js';
import type { ReplayTimeline, ReplayWindow } from '../replayTimeline.js';
import type { SessionLane } from '../replayTransforms.js';

/** Which of Replay's three questions a lens answers. */
export type ReplayLensQuestion = 'what-happened' | 'attention' | 'revisit';

/**
 * A question and the lenses that answer it at one level. Every lens picker
 * renders from these groups rather than from a flat list, so the catalog's own
 * structure — Replay's three questions — is what the reader navigates by.
 */
export interface ReplayLensGroup {
  question: ReplayLensQuestion;
  /** Group heading, question-shaped. */
  label: string;
  lenses: ReplayLensDef[];
}

/**
 * The canonical form vocabulary. One form per data shape — a lens picks the
 * form that fits its rows, and the renderer draws it. Adding a form is a
 * deliberate act, not a per-lens escape hatch.
 */
export type ReplayLensViz =
  | 'ranked-bars'
  | 'timeline-marks'
  | 'distribution'
  | 'table'
  | 'stat-grid'
  | 'compare-rows';

/** Replay's three reading levels. */
export type ReplayLevel = 'period' | 'project' | 'session';

export type ReplayLensTone = 'neutral' | 'positive' | 'warning' | 'negative';

/**
 * Which captured fields a lens reads. Documentation and future API schema, not
 * a gate — a lens with nothing behind it returns an honest-empty result rather
 * than being hidden by a flag someone forgot to set.
 */
export type ReplayLensDataKey =
  | 'moments.toolName'
  | 'moments.costUsd'
  | 'moments.errored'
  | 'moments.fileCategory'
  | 'moments.fileLanguage'
  | 'moments.undoKind'
  | 'moments.verificationKind'
  | 'moments.verificationPassed'
  | 'moments.notificationType'
  | 'moments.at'
  | 'keyframes'
  | 'activity'
  | 'totals'
  | 'sessions';

export interface ReplayLensDef {
  id: string;
  /** Short label for the tab strip. */
  name: string;
  /** The question this lens answers, in one sentence. Agent-readable. */
  description: string;
  question: ReplayLensQuestion;
  viz: ReplayLensViz;
  dataKeys: ReplayLensDataKey[];
  /** Levels where this lens has something to say. */
  levels: ReplayLevel[];
  /**
   * True when the lens reports on the focus window rather than the whole
   * scope. Zooming into a burst then re-reads these lenses for that burst.
   */
  windowed: boolean;
  /** Shown when the lens has no backing data. Explains the absence honestly. */
  emptyHint: string;
}

/** A secondary, already-formatted fact hanging off a row. */
export interface ReplayLensFact {
  label: string;
  value: string;
  tone?: ReplayLensTone;
}

export interface ReplayLensRow {
  id: string;
  label: string;
  /** Primary magnitude, raw. Sorting and bar widths use this. */
  value: number;
  /** Primary magnitude, formatted for display. */
  display: string;
  /** 0..1 share of the lens total, for bar forms. Absent when share is meaningless. */
  share?: number;
  facts?: ReplayLensFact[];
  tone?: ReplayLensTone;
  /** Scope-relative elapsed to scrub to, when the row names an instant. */
  elapsedMs?: number;
  /** Where clicking the row should navigate, when it names a scope object. */
  target?: { kind: 'project' | 'session'; id: string };
  /** Cell values for the `table` and `compare-rows` forms, aligned to `columns`. */
  cells?: string[];
  /** Per-cell tones for the same, aligned to `cells`. */
  cellTones?: (ReplayLensTone | undefined)[];
}

/** What the numbers actually cover — stated, never implied. */
export interface ReplayLensCoverage {
  sessionCount: number;
  /** Sessions whose replay payload is loaded; the rest cannot contribute. */
  loadedCount: number;
  /** True when the result is scoped to the focus window rather than the scope. */
  windowed: boolean;
  /** Moments the lens actually read. */
  momentCount: number;
}

/**
 * A supporting block under the primary rows — the same row shape in a second
 * form. Lets a lens carry "these numbers, and the moments behind them" without
 * inventing a bespoke result type per lens.
 */
export interface ReplayLensSection {
  label: string;
  viz: ReplayLensViz;
  rows: ReplayLensRow[];
  columns?: string[];
}

export interface ReplayLensResult {
  id: string;
  viz: ReplayLensViz;
  /** One honest sentence about the rows. Null when there is nothing to claim. */
  headline: string | null;
  rows: ReplayLensRow[];
  /** Column headers for the `table` and `compare-rows` forms. */
  columns?: string[];
  secondary?: ReplayLensSection;
  /** Set when the lens has nothing backed to show; rows are then empty. */
  empty: string | null;
  coverage: ReplayLensCoverage;
}

export interface ReplayLensInput {
  /** Lanes in the current scope — already narrowed by level. */
  lanes: SessionLane[];
  timeline: ReplayTimeline;
  /** The stage's focus window. Windowed lenses report only on this span. */
  window: ReplayWindow;
  level: ReplayLevel;
  /** Session summaries — period comparison folds these, not replay payloads. */
  sessions: SessionSummary[];
  rangeDays: number;
  /** Sessions picked for side-by-side comparison. */
  compareSessionIds: string[];
  /** Injected so compute stays deterministic and testable. */
  nowMs: number;
}

export type ReplayLensCompute = (input: ReplayLensInput) => ReplayLensResult;
