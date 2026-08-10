// Where attention went: rework, checks, waits, cadence.

import { formatTimelineAxis, windowFrac } from '../replayTimeline.js';
import type {
  ReplayLensInput,
  ReplayLensResult,
  ReplayLensRow,
} from './types.js';
import {
  coverageFor,
  countLabel,
  emptyResult,
  formatGap,
  humanize,
  placedMoments,
  type PlacedMoment,
} from './shared.js';

function markPosition(input: ReplayLensInput, elapsedMs: number): number {
  return Math.max(0, Math.min(1, windowFrac(input.window, elapsedMs)));
}

function clock(input: ReplayLensInput, elapsedMs: number): string {
  return formatTimelineAxis(input.timeline, elapsedMs);
}

/**
 * Work the agent changed back inside the session. `undoKind` is a closed enum
 * from capture, so this is a real discard, not an inference about intent.
 */
export function computeRework(input: ReplayLensInput): ReplayLensResult {
  const moments = placedMoments(input, true).filter((placed) => placed.moment.undoKind);
  const coverage = coverageFor(input, moments.length, true);
  if (moments.length === 0) {
    return emptyResult(
      'rework',
      'timeline-marks',
      'Nothing was changed back here. That is a real absence, not missing capture.',
      coverage,
    );
  }

  const byKind = new Map<string, number>();
  for (const { moment } of moments) {
    const kind = moment.undoKind!;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }

  const rows: ReplayLensRow[] = moments.map(({ moment, elapsedMs }, index) => ({
    id: `rework-${index}-${moment.seq}`,
    label: humanize(moment.undoKind!),
    value: elapsedMs,
    display: clock(input, elapsedMs),
    share: markPosition(input, elapsedMs),
    elapsedMs,
    tone: 'warning',
    facts: moment.toolName ? [{ label: 'tool', value: moment.toolName }] : [],
  }));

  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
  const headline = `${countLabel(moments.length, 'change')} were rolled back${
    kinds.length > 0 ? `, most often ${humanize(kinds[0]![0]).toLowerCase()}` : ''
  }.`;

  return { id: 'rework', viz: 'timeline-marks', headline, rows, empty: null, coverage };
}

/** Verification runs and whether they passed — did checks go red, did they come back. */
export function computeVerification(input: ReplayLensInput): ReplayLensResult {
  const moments = placedMoments(input, true).filter(
    (placed) =>
      placed.moment.verificationKind != null || placed.moment.verificationPassed != null,
  );
  const coverage = coverageFor(input, moments.length, true);
  if (moments.length === 0) {
    return emptyResult(
      'verification',
      'timeline-marks',
      'No verification runs were captured here.',
      coverage,
    );
  }

  const rows: ReplayLensRow[] = moments.map(({ moment, elapsedMs }, index) => {
    const failed = moment.verificationPassed === false;
    const passed = moment.verificationPassed === true;
    return {
      id: `check-${index}-${moment.seq}`,
      label: moment.verificationKind ? humanize(moment.verificationKind) : 'Verification',
      value: elapsedMs,
      display: clock(input, elapsedMs),
      share: markPosition(input, elapsedMs),
      elapsedMs,
      tone: failed ? ('negative' as const) : passed ? ('positive' as const) : undefined,
      facts: [
        {
          label: 'result',
          value: failed ? 'failed' : passed ? 'passed' : 'not recorded',
          tone: failed ? ('negative' as const) : passed ? ('positive' as const) : undefined,
        },
      ],
    };
  });

  const failures = moments.filter((placed) => placed.moment.verificationPassed === false).length;
  const last = moments[moments.length - 1]!.moment;
  const recovered = failures > 0 && last.verificationPassed === true;
  const headline =
    failures === 0
      ? `${countLabel(moments.length, 'check')} ran and none failed.`
      : recovered
        ? `${countLabel(moments.length, 'check')} ran, ${failures.toLocaleString()} failed, and the last one passed.`
        : `${countLabel(moments.length, 'check')} ran and ${failures.toLocaleString()} failed.`;

  return { id: 'verification', viz: 'timeline-marks', headline, rows, empty: null, coverage };
}

/**
 * How often the agent stopped for you, and how long it then sat. The wait is
 * the gap to the NEXT captured moment in the same session — a measurement, not
 * an estimate of when you noticed. When a stop is the session's last captured
 * moment, the wait is simply absent.
 */
export function computeInterruptions(input: ReplayLensInput): ReplayLensResult {
  const all = placedMoments(input, false);
  const windowed = placedMoments(input, true);
  const stops = windowed.filter((placed) => placed.moment.notificationType);
  const coverage = coverageFor(input, stops.length, true);
  if (stops.length === 0) {
    return emptyResult(
      'interruptions',
      'timeline-marks',
      'The agent never stopped for you here.',
      coverage,
    );
  }

  const nextInSession = (placed: PlacedMoment): PlacedMoment | null => {
    for (const candidate of all) {
      if (candidate.lane.sessionId !== placed.lane.sessionId) continue;
      if (candidate.elapsedMs > placed.elapsedMs) return candidate;
    }
    return null;
  };

  let measuredWaitMs = 0;
  let measuredCount = 0;

  const rows: ReplayLensRow[] = stops.map((placed, index) => {
    const { moment, elapsedMs } = placed;
    const next = nextInSession(placed);
    const waitMs = next ? next.elapsedMs - elapsedMs : null;
    if (waitMs != null) {
      measuredWaitMs += waitMs;
      measuredCount += 1;
    }
    const blocking = moment.notificationType === 'permission_prompt';
    return {
      id: `wait-${index}-${moment.seq}`,
      label: blocking ? 'Needs you' : humanize(moment.notificationType!),
      value: elapsedMs,
      display: clock(input, elapsedMs),
      share: markPosition(input, elapsedMs),
      elapsedMs,
      tone: blocking ? ('warning' as const) : undefined,
      facts:
        waitMs == null
          ? [{ label: 'waited', value: 'still the last captured moment' }]
          : [{ label: 'waited', value: formatGap(waitMs) }],
    };
  });

  const headline =
    measuredCount > 0
      ? `The agent stopped for you ${countLabel(stops.length, 'time')} and waited ${formatGap(measuredWaitMs)} in total.`
      : `The agent stopped for you ${countLabel(stops.length, 'time')}.`;

  return { id: 'interruptions', viz: 'timeline-marks', headline, rows, empty: null, coverage };
}

/** Gap bands, widest-lasting first in label order. Fixed so runs stay comparable. */
const CADENCE_BANDS: { id: string; label: string; maxMs: number }[] = [
  { id: 'under-5s', label: 'Under 5s', maxMs: 5_000 },
  { id: 'under-30s', label: '5s – 30s', maxMs: 30_000 },
  { id: 'under-2m', label: '30s – 2m', maxMs: 120_000 },
  { id: 'under-10m', label: '2m – 10m', maxMs: 600_000 },
  { id: 'over-10m', label: 'Over 10m', maxMs: Number.POSITIVE_INFINITY },
];

/**
 * How the gaps between captured moments were distributed — bursts versus
 * stalls. Gaps are measured inside a session, never across a session boundary,
 * where the "gap" would just be time you were not working.
 */
export function computeCadence(input: ReplayLensInput): ReplayLensResult {
  const moments = placedMoments(input, true);
  const bySession = new Map<string, number[]>();
  for (const { lane, elapsedMs } of moments) {
    const list = bySession.get(lane.sessionId) ?? [];
    list.push(elapsedMs);
    bySession.set(lane.sessionId, list);
  }

  const gaps: number[] = [];
  for (const list of bySession.values()) {
    const sorted = [...list].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]! - sorted[i - 1]!);
  }

  const coverage = coverageFor(input, moments.length, true);
  if (gaps.length === 0) {
    return emptyResult(
      'cadence',
      'distribution',
      'Two or more captured moments are needed before a cadence exists.',
      coverage,
    );
  }

  const counts = CADENCE_BANDS.map((band) => ({ band, count: 0 }));
  for (const gap of gaps) {
    const slot = counts.find((entry) => gap < entry.band.maxMs) ?? counts[counts.length - 1]!;
    slot.count += 1;
  }

  const rows: ReplayLensRow[] = counts.map(({ band, count }) => ({
    id: band.id,
    label: band.label,
    value: count,
    display: countLabel(count, 'gap'),
    share: count / gaps.length,
  }));

  const longest = Math.max(...gaps);
  const quick = counts
    .filter((entry) => entry.band.maxMs <= 30_000)
    .reduce((sum, entry) => sum + entry.count, 0);
  const quickPct = Math.round((quick / gaps.length) * 100);
  const headline = `${quickPct}% of ${countLabel(gaps.length, 'gap')} were under 30 seconds; the longest stall was ${formatGap(longest)}.`;

  return { id: 'cadence', viz: 'distribution', headline, rows, empty: null, coverage };
}
