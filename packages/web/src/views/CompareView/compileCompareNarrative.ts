import type { DeveloperModelSnapshot, HourBucket } from '@seorak/types';

import { daypartMeta, localizeHourBuckets } from '../../lib/localTime.js';
import { fmtCount } from '../../lib/voice/index.js';
import { dominantDaypart } from '../ModelView/portrait/daypart.js';
import type {
  ModelInsight,
  ModelNarrativeSegment,
  ModelPresentation,
  NarrativeInsightFacet,
} from '../ModelView/modelPresentationTypes.js';
import type {
  PeriodComparison,
  PeriodComparisonEvidence,
} from './compilePeriodComparison.js';

const PRIOR_MIN_SESSIONS = 4;
const SURVIVAL_MOVE = 0.1;

const WORK_TYPE_COPY: Record<string, string> = {
  feature: 'building new things',
  fix: 'fixing what was broken',
  refactor: 'reshaping existing code',
  chore: 'upkeep',
  other: 'work its branch did not name',
};

interface AnnotatedSentence {
  segments: ModelNarrativeSegment[];
  insights: ModelInsight[];
}

function text(value: string): ModelNarrativeSegment {
  return { type: 'text', text: value };
}

function insight(id: string): ModelNarrativeSegment {
  return { type: 'insight', insightId: id };
}

function appendSentence(
  prose: ModelNarrativeSegment[],
  insights: ModelInsight[],
  sentence: AnnotatedSentence | null,
): void {
  if (!sentence) return;
  if (prose.length > 0) prose.push(text('\n\n'));
  prose.push(...sentence.segments);
  insights.push(...sentence.insights);
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function totalSessions(buckets: HourBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.sessions, 0);
}

function identityShift(
  snapshot: DeveloperModelSnapshot | null,
  offsetMinutes: number,
): AnnotatedSentence | null {
  const accrual = snapshot?.accrual;
  if (!snapshot || !accrual || accrual.sessions < PRIOR_MIN_SESSIONS) return null;

  const offsetHours = -offsetMinutes / 60;
  const currentHours = localizeHourBuckets(snapshot.activity.hourlyDistribution, offsetHours);
  const previousHours = localizeHourBuckets(accrual.hourlyDistribution, offsetHours);
  const currentDaypart = dominantDaypart(currentHours, totalSessions(currentHours));
  const previousDaypart = dominantDaypart(previousHours, totalSessions(previousHours));

  if (currentDaypart && previousDaypart && currentDaypart.id !== previousDaypart.id) {
    const currentLabel = daypartMeta(currentDaypart.id).label;
    const previousLabel = daypartMeta(previousDaypart.id).label;
    const linkedTerm = `${previousLabel} into ${currentLabel}`;
    const id = 'compare-rhythm';
    return {
      segments: [text('Your workday moved from '), insight(id), text('.')],
      insights: [
        {
          id,
          facet: 'rhythm',
          linkedTerm,
          label: 'Workday shift',
          hoverLines: [`The center of your session starts moved to the ${currentLabel}`],
          squircle: {
            detail: `Your sessions shifted from the ${previousLabel} into the ${currentLabel}.`,
            citations: [
              {
                text: `${currentDaypart.sessions} session starts fell in the ${currentLabel} this period`,
                field: 'activity.hourlyDistribution',
              },
              {
                text: `${previousDaypart.sessions} session starts fell in the ${previousLabel} in the prior period`,
                field: 'accrual.hourlyDistribution',
              },
            ],
          },
        },
      ],
    };
  }

  if (snapshot.scope.repoId === null) {
    const currentFocus = snapshot.focus.projectFocus[0];
    const previousFocus = accrual.projectFocus[0];
    if (currentFocus && previousFocus && currentFocus.repoId !== previousFocus.repoId) {
      const linkedTerm = `${previousFocus.project} to ${currentFocus.project}`;
      const id = 'compare-focus';
      return {
        segments: [text('Your attention moved from '), insight(id), text('.')],
        insights: [
          {
            id,
            facet: 'focus',
            linkedTerm,
            label: 'Project focus',
            hoverLines: [`${currentFocus.project} now leads the period`],
            squircle: {
              detail: `${previousFocus.project} led the prior period; ${currentFocus.project} leads this one.`,
              projectKey: currentFocus.repoId,
              citations: [
                {
                  text:
                    currentFocus.share === null
                      ? `${currentFocus.project} leads current sessions`
                      : `${currentFocus.project} has ${percent(currentFocus.share)} of current sessions`,
                  field: 'focus.projectFocus',
                },
                {
                  text:
                    previousFocus.share === null
                      ? `${previousFocus.project} led prior sessions`
                      : `${previousFocus.project} had ${percent(previousFocus.share)} of prior sessions`,
                  field: 'accrual.projectFocus',
                },
              ],
            },
          },
        ],
      };
    }
  }

  const currentWork = topWorkType(snapshot.identity?.branchWorkTypeMix);
  const previousWork = topWorkType(accrual.branchWorkTypeMix);
  if (currentWork && previousWork && currentWork.workType !== previousWork.workType) {
    const currentLabel = WORK_TYPE_COPY[currentWork.workType] ?? `${currentWork.workType} work`;
    const previousLabel = WORK_TYPE_COPY[previousWork.workType] ?? `${previousWork.workType} work`;
    const linkedTerm = `toward ${currentLabel}`;
    const id = 'compare-shape';
    return {
      segments: [text('Your branches shifted '), insight(id), text('.')],
      insights: [
        {
          id,
          facet: 'shape',
          linkedTerm,
          label: 'Work shape',
          hoverLines: [`${currentLabel} now leads your branch mix`],
          squircle: {
            detail: `The named purpose of your branches moved from ${previousLabel} to ${currentLabel}.`,
            citations: [
              {
                text: `${currentWork.sessions} current sessions ran on branches named for ${currentLabel}`,
                field: 'identity.branchWorkTypeMix',
              },
              {
                text: `${previousWork.sessions} prior sessions ran on branches named for ${previousLabel}`,
                field: 'accrual.branchWorkTypeMix',
              },
            ],
          },
        },
      ],
    };
  }

  return null;
}

function topWorkType(mix?: Array<{ workType: string; sessions: number }>) {
  if (!mix || mix.length === 0) return null;
  return [...mix].filter((row) => row.sessions > 0).sort((a, b) => b.sessions - a.sessions)[0] ?? null;
}

function evidenceTerm(row: PeriodComparisonEvidence): string {
  const direction = Math.sign(row.difference.raw);
  if (row.id === 'sessions') {
    return direction > 0
      ? 'session activity grew'
      : direction < 0
        ? 'session activity fell'
        : 'session activity held level';
  }
  if (row.id === 'lines-added') {
    return direction > 0
      ? 'captured editing expanded'
      : direction < 0
        ? 'captured editing contracted'
        : 'captured editing held level';
  }
  if (row.note.includes('floor') && direction <= 0) {
    return 'measured cost is incomplete';
  }
  return direction > 0
    ? row.note.includes('floor')
      ? 'measured cost rose by at least this much'
      : 'measured cost rose'
    : direction < 0
      ? 'measured cost fell'
      : 'measured cost held level';
}

function evidenceFacet(row: PeriodComparisonEvidence): NarrativeInsightFacet {
  if (row.id === 'sessions') return 'volume';
  if (row.id === 'cost') return 'cost';
  return 'shape';
}

function evidenceDetail(row: PeriodComparisonEvidence): string {
  const direction = Math.sign(row.difference.raw);
  const amount = row.difference.text.replace(/^[+-]/, '');
  if (row.id === 'sessions') {
    if (direction === 0) return 'Captured session starts were unchanged.';
    return `Captured session starts ${direction > 0 ? 'rose' : 'fell'} by ${amount}.`;
  }
  if (row.id === 'lines-added') {
    if (direction === 0) return 'Captured added-line volume was unchanged.';
    return `Captured added-line volume ${direction > 0 ? 'rose' : 'fell'} by ${amount}.`;
  }
  if (row.note.includes('floor')) {
    return 'This comparison is a floor because some current model use is unpriced.';
  }
  if (direction === 0) return 'Measured captured cost was unchanged.';
  return `Measured captured cost ${direction > 0 ? 'rose' : 'fell'} by ${amount}.`;
}

function measuredChanges(period: PeriodComparison): AnnotatedSentence | null {
  if (period.evidence.length === 0) return null;
  const ordered = [...period.evidence].sort(
    (a, b) =>
      ['sessions', 'lines-added', 'cost'].indexOf(a.id) -
      ['sessions', 'lines-added', 'cost'].indexOf(b.id),
  );
  const segments: ModelNarrativeSegment[] = [
    text(`Compared with the prior ${period.rangeDays} days, `),
  ];
  const insights: ModelInsight[] = [];

  ordered.forEach((row, index) => {
    if (index > 0) segments.push(text(index === ordered.length - 1 ? ' and ' : ', '));
    const id = `compare-${row.id}`;
    const linkedTerm = evidenceTerm(row);
    segments.push(insight(id));
    insights.push({
      id,
      facet: evidenceFacet(row),
      linkedTerm,
      label: row.label,
      hoverLines: [evidenceDetail(row)],
      squircle: {
        detail: evidenceDetail(row),
        citations: [
          {
            text: `${period.currentWindowLabel}: ${row.current.text}`,
            field: `${row.id}.current`,
          },
          {
            text: `${period.previousWindowLabel}: ${row.previous.text}`,
            field: `${row.id}.previous`,
          },
          {
            text: `Change: ${row.difference.text}`,
            field: `${row.id}.difference`,
          },
        ],
      },
    });
  });
  segments.push(text('.'));
  return { segments, insights };
}

function survivalChange(snapshot: DeveloperModelSnapshot | null): AnnotatedSentence | null {
  const accrual = snapshot?.accrual;
  if (!snapshot || !accrual || accrual.sessions < PRIOR_MIN_SESSIONS) return null;
  const current = snapshot.outcomes.lineSurvival;
  const previous = accrual.lineSurvival;
  if (current.rate === null || previous.rate === null) return null;
  const move = current.rate - previous.rate;
  if (Math.abs(move) < SURVIVAL_MOVE) return null;

  const improved = move > 0;
  const linkedTerm = improved ? 'stayed in the code' : 'was changed back';
  const id = 'compare-survival';
  return {
    segments: [
      text('More of your landed work '),
      insight(id),
      text(' than in the period before.'),
    ],
    insights: [
      {
        id,
        facet: 'payoff',
        linkedTerm,
        label: 'What lasted',
        hoverLines: [
          improved
            ? 'A larger share of landed lines survived'
            : 'A larger share of landed lines was rewritten',
        ],
        squircle: {
          detail: improved
            ? 'A larger share of your landed lines is still in the code.'
            : 'A larger share of your landed lines was rewritten after the session.',
          citations: [
            {
              text: `${percent(current.rate)} survived this period across ${fmtCount(current.sessionsRated)} rated sessions`,
              field: 'outcomes.lineSurvival',
            },
            {
              text: `${percent(previous.rate)} survived the prior period across ${fmtCount(previous.sessionsRated)} rated sessions`,
              field: 'accrual.lineSurvival',
            },
          ],
        },
      },
    ],
  };
}

/**
 * A Compare-specific read in the same annotation contract as Model. It combines
 * Overview's exact adjacent legs with the developer-model accrual slice, which is
 * where prior rhythm, focus, work shape, and line survival honestly live.
 */
export function compileCompareNarrative(
  period: PeriodComparison,
  model: DeveloperModelSnapshot | null,
  options: { offsetMinutes: number },
): ModelPresentation {
  const prose: ModelNarrativeSegment[] = [];
  const insights: ModelInsight[] = [];

  appendSentence(prose, insights, identityShift(model, options.offsetMinutes));
  appendSentence(prose, insights, measuredChanges(period));
  appendSentence(prose, insights, survivalChange(model));

  if (prose.length === 0) {
    prose.push(
      text(
        period.narrative.find((line) => line.role === 'lead')?.text ??
          `No prior ${period.rangeDays}-day window has been measured yet.`,
      ),
    );
  }

  return {
    displayName: 'Compare',
    prose,
    insights,
    forming: null,
  };
}
