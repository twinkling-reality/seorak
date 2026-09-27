import type { OverviewSnapshot, PeriodDelta, ProjectRollup } from '@seorak/types';

import { fmtCount, formatCost } from '../../lib/voice/index.js';

export type PeriodComparisonMetricId = 'sessions' | 'cost' | 'lines-added';

export interface PeriodComparisonValue {
  raw: number;
  text: string;
}

/**
 * A compact, measured current/prior pair. `previous` is never synthesized: when
 * the prior leg is absent, the entire evidence row is omitted.
 */
export interface PeriodComparisonEvidence {
  id: PeriodComparisonMetricId;
  label: string;
  current: PeriodComparisonValue;
  previous: PeriodComparisonValue;
  difference: PeriodComparisonValue;
  note: string;
}

export interface PeriodComparisonNarrativeLine {
  role: 'lead' | 'comparison' | 'empty';
  text: string;
  evidenceId?: PeriodComparisonMetricId;
}

export interface PeriodComparison {
  scope: {
    kind: 'all-work' | 'project';
    label: string;
    repoId: string | null;
  };
  rangeDays: number;
  currentWindowLabel: string;
  previousWindowLabel: string;
  narrative: PeriodComparisonNarrativeLine[];
  evidence: PeriodComparisonEvidence[];
}

interface MeasuredPair {
  current: number;
  previous: number;
}

function measuredPair(delta: PeriodDelta | null | undefined): MeasuredPair | null {
  if (
    delta == null ||
    delta.previous == null ||
    !Number.isFinite(delta.current) ||
    !Number.isFinite(delta.previous) ||
    delta.current < 0 ||
    delta.previous < 0
  ) {
    return null;
  }
  return { current: delta.current, previous: delta.previous };
}

function signedCount(value: number): string {
  if (value > 0) return `+${fmtCount(value)}`;
  return fmtCount(value);
}

function signedCost(value: number): string {
  if (value > 0) return `+${formatCost(value, 2)}`;
  if (value < 0) return `-${formatCost(Math.abs(value), 2)}`;
  return formatCost(0, 2);
}

function countEvidence(
  id: Extract<PeriodComparisonMetricId, 'sessions' | 'lines-added'>,
  label: string,
  pair: MeasuredPair,
  note: string,
): PeriodComparisonEvidence {
  const difference = pair.current - pair.previous;
  return {
    id,
    label,
    current: { raw: pair.current, text: fmtCount(pair.current) },
    previous: { raw: pair.previous, text: fmtCount(pair.previous) },
    difference: { raw: difference, text: signedCount(difference) },
    note,
  };
}

function costEvidence(pair: MeasuredPair, partial: boolean): PeriodComparisonEvidence {
  const difference = pair.current - pair.previous;
  return {
    id: 'cost',
    label: 'Measured cost',
    current: { raw: pair.current, text: formatCost(pair.current, 2) },
    previous: { raw: pair.previous, text: formatCost(pair.previous, 2) },
    difference: { raw: difference, text: signedCost(difference) },
    note: partial
      ? 'Compares priced captured cost. The current value is a floor because some model use is unpriced.'
      : 'Compares priced captured cost in adjacent equal windows.',
  };
}

function comparisonSentence(
  evidence: PeriodComparisonEvidence,
  currentWindow: string,
  previousWindow: string,
): string {
  if (evidence.id === 'sessions') {
    return `Sessions were ${evidence.current.text} in ${currentWindow}, compared with ${evidence.previous.text} in ${previousWindow}.`;
  }
  if (evidence.id === 'cost') {
    return `Measured cost was ${evidence.current.text} in ${currentWindow}, compared with ${evidence.previous.text} in ${previousWindow}.`;
  }
  return `Captured edits added ${evidence.current.text} lines in ${currentWindow}, compared with ${evidence.previous.text} in ${previousWindow}.`;
}

function trendPhrase(evidence: PeriodComparisonEvidence): string {
  const difference = evidence.difference.raw;
  const label =
    evidence.id === 'sessions'
      ? 'sessions'
      : evidence.id === 'cost'
        ? 'measured cost'
        : 'captured lines';
  if (difference === 0) return `${label} was unchanged at ${evidence.current.text}`;
  if (evidence.previous.raw === 0) {
    return `${label} rose from ${evidence.previous.text} to ${evidence.current.text}`;
  }
  const percent = Math.round((Math.abs(difference) / evidence.previous.raw) * 100);
  return `${label} ${difference > 0 ? 'rose' : 'fell'} ${fmtCount(percent)}%`;
}

function naturalJoin(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

/**
 * Compile an all-work or one-project adjacent-period read from measurements the
 * overview contract already names. It never infers a missing prior period, never
 * ranks the periods, and does not compile current-only outcomes into Compare.
 */
export function compilePeriodComparison(
  overview: OverviewSnapshot,
  selectedProject?: ProjectRollup | null,
): PeriodComparison {
  const project = selectedProject ?? null;
  const rangeDays = overview.rangeDays;
  const currentWindowLabel = `Last ${rangeDays} days`;
  const previousWindowLabel = `Prior ${rangeDays} days`;
  const currentWindow = `the last ${rangeDays} days`;
  const previousWindow = `the prior ${rangeDays} days`;
  const scopeLabel = project?.project.trim() || (project ? 'This project' : 'All work');
  const repoId = project?.repoId ?? null;

  const sessionsPair = measuredPair(
    project ? project.sessionsDelta : overview.usage.totals.sessionsDelta,
  );
  const costPair = measuredPair(project ? project.costDelta : overview.usage.cost.delta);
  const linesPair = project
    ? project.lines?.priorAdded == null
      ? null
      : measuredPair({
          current: project.lines.added,
          previous: project.lines.priorAdded,
        })
    : measuredPair(overview.usage.lines?.delta);

  const evidence: PeriodComparisonEvidence[] = [];
  if (sessionsPair) {
    evidence.push(
      countEvidence(
        'sessions',
        'Sessions',
        sessionsPair,
        'Counts captured session starts that ran a tool or spent something, in adjacent equal windows.',
      ),
    );
  }
  if (costPair) {
    evidence.push(costEvidence(costPair, project == null && overview.usage.cost.costPartial === true));
  }
  if (linesPair) {
    evidence.push(
      countEvidence(
        'lines-added',
        'Captured lines added',
        linesPair,
        'Counts lines added by captured edit calls, not git net change.',
      ),
    );
  }

  const narrative: PeriodComparisonNarrativeLine[] = [];

  if (evidence.length === 0) {
    narrative.push({
      role: 'lead',
      text: `No prior ${rangeDays}-day window has been measured for ${
        project == null ? 'all work' : scopeLabel
      } yet.`,
    });
  } else {
    const orderedEvidence = [...evidence].sort(
      (a, b) =>
        ['sessions', 'lines-added', 'cost'].indexOf(a.id) -
        ['sessions', 'lines-added', 'cost'].indexOf(b.id),
    );
    const directions = orderedEvidence.map((item) => Math.sign(item.difference.raw));
    const directionSummary =
      directions.every((direction) => direction > 0)
        ? 'every compared stat rose'
        : directions.every((direction) => direction < 0)
          ? 'every compared stat fell'
          : directions.every((direction) => direction === 0)
            ? 'the compared stats were unchanged'
            : 'the compared stats moved differently';
    narrative.push({
      role: 'lead',
      text: `${
        project == null ? 'Across all work' : `For ${scopeLabel}`
      }, ${directionSummary} in ${currentWindow}: ${naturalJoin(
        orderedEvidence.map(trendPhrase),
      )}.`,
    });
    for (const item of evidence) {
      narrative.push({
        role: 'comparison',
        text: comparisonSentence(item, currentWindow, previousWindow),
        evidenceId: item.id,
      });
    }
  }

  return {
    scope: {
      kind: project ? 'project' : 'all-work',
      label: scopeLabel,
      repoId,
    },
    rangeDays,
    currentWindowLabel,
    previousWindowLabel,
    narrative,
    evidence,
  };
}
