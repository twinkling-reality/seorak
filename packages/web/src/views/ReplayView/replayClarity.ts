/**
 * compileReplayClarity — PURE. The Replay Summary read, in the same annotated
 * form Overview uses: prose whose numbers are hoverable terms backed by facet
 * notes. Replay had been rendering a flat bordered card while Overview rendered
 * the reveal, which made one product look like two.
 *
 * Overview compiles an OverviewSnapshot; this compiles a replay scope. Both
 * produce `PeriodClarity`, and both feed the one `PeriodClarityReveal`.
 */

import type {
  PeriodClarity,
  SummaryNote,
  SummaryParagraph,
  SummarySegment,
} from '../../periodClarity/compilePeriodClarity.js';
import { formatDuration } from '../../lib/utils.js';
import { count, plural } from '../../lib/voice/index.js';
import { formatCost, formatTokens } from '../../widgets/utils.js';
import type { ReplayScopeSummary } from './replayReviewModel.js';
import { replayRangePhrase, type ReplayRangeDays } from './replayScope.js';
import { formatProjectScope } from './replayScopeSummary.js';

export interface ReplayClarityContext {
  rangeDays: ReplayRangeDays;
  /** Project names in the current replay scope, sorted. */
  projectLabels: string[];
  customSessionSelection: boolean;
  /** Named when a project or session is focused, so the read says what it covers. */
  focusLabel?: string | null;
}

function t(text: string): SummarySegment {
  return { type: 'text', text };
}

function term(noteId: string, text: string): SummarySegment {
  return { type: 'term', noteId, term: text };
}

function paragraph(role: SummaryParagraph['role'], segments: SummarySegment[]): SummaryParagraph {
  return { role, segments };
}

export function compileReplayClarity(
  scope: ReplayScopeSummary,
  context: ReplayClarityContext,
): PeriodClarity {
  const paragraphs: SummaryParagraph[] = [];
  const notes: SummaryNote[] = [];
  const range = replayRangePhrase(context.rangeDays);
  const projects = formatProjectScope(context.projectLabels);
  const sessionsPhrase = count(scope.sessionCount, 'session');

  // ── Lead: what this read covers ────────────────────────────────────────
  notes.push({
    id: 'scope-sessions',
    facet: 'volume',
    label: 'Replay scope',
    detail: context.customSessionSelection
      ? 'The sessions you picked in Customize, not every session in the range.'
      : 'Every session in the selected range and projects.',
    citations: [
      `${sessionsPhrase} in scope`,
      `${count(scope.projectCount, 'project')} represented`,
      scope.loadedReplayCount < scope.sessionCount
        ? `${scope.loadedReplayCount.toLocaleString()} of ${scope.sessionCount.toLocaleString()} replays loaded`
        : 'all replays loaded',
    ],
  });

  paragraphs.push(
    paragraph('lead', [
      t(`${range}, you're replaying `),
      term('scope-sessions', sessionsPhrase),
      t(
        context.customSessionSelection
          ? ` you picked across ${projects}.`
          : ` across ${projects}.`,
      ),
      ...(context.focusLabel ? [t(` This read is scoped to ${context.focusLabel}.`)] : []),
    ]),
  );

  // ── Cost ───────────────────────────────────────────────────────────────
  notes.push({
    id: 'scope-cost',
    facet: 'cost',
    label: 'Measured API cost',
    detail:
      'Summed from captured token usage on the sessions in scope. It is what was measured, not a bill.',
    citations: [
      `${formatCost(scope.totalCostUsd)} across ${sessionsPhrase}`,
      scope.tokensTotal > 0 ? `${formatTokens(scope.tokensTotal)} tokens` : 'no token totals captured',
    ],
  });
  paragraphs.push(
    paragraph('body', [
      t('Estimated API cost in this scope is '),
      term('scope-cost', formatCost(scope.totalCostUsd)),
      t('.'),
    ]),
  );

  // ── What is worth revisiting ───────────────────────────────────────────
  if (scope.highlightCount === 0) {
    paragraphs.push(paragraph('body', [t('Nothing here is flagged to revisit yet.')]));
  } else {
    notes.push({
      id: 'revisit',
      facet: 'outcome',
      label: 'Worth revisiting',
      detail:
        'Moments the replay flagged: tool errors, failed verifications, cost spikes, commits, and permission stops. Every one is backed by a captured event.',
      citations: [`${count(scope.highlightCount, 'flagged moment')}`],
    });

    const breakdown: SummarySegment[] = [];
    const pushClause = (segments: SummarySegment[], isLast: boolean, isFirst: boolean) => {
      if (!isFirst) breakdown.push(t(isLast ? ', and ' : ', '));
      breakdown.push(...segments);
    };

    const clauses: SummarySegment[][] = [];
    if (scope.alertCount > 0) {
      notes.push({
        id: 'alerts',
        facet: 'caveat',
        label: 'Tool errors',
        detail:
          'Tool calls that reported an error, plus failed verification runs. An error is not a failure of the session. It is a place the run had to recover.',
        citations: [`${count(scope.alertCount, 'error')} flagged`],
      });
      clauses.push([term('alerts', scope.alertCount.toLocaleString()), t(' from tool errors')]);
    }
    if (scope.peakCount > 0) {
      notes.push({
        id: 'peaks',
        facet: 'caveat',
        label: 'Cost spikes',
        detail: 'The highest-cost moment in each session, by measured token spend.',
        citations: [`${count(scope.peakCount, 'spike')} flagged`],
      });
      clauses.push([term('peaks', scope.peakCount.toLocaleString()), t(' from cost spikes')]);
    }
    if (scope.commitCount > 0) {
      notes.push({
        id: 'commits',
        facet: 'outcome',
        label: 'Commits',
        detail:
          'Commit milestones from the session delta, counted by commits and files touched, never by lines of code.',
        citations: [`${count(scope.commitCount, 'commit milestone')}`],
      });
      clauses.push([term('commits', scope.commitCount.toLocaleString()), t(' from commits')]);
    }
    const remainder = scope.highlightCount - scope.alertCount - scope.peakCount - scope.commitCount;
    if (remainder > 0) {
      clauses.push([t(`${remainder.toLocaleString()} other flagged moments`)]);
    }

    clauses.forEach((segments, index) =>
      pushClause(segments, index === clauses.length - 1, index === 0),
    );

    paragraphs.push(
      paragraph('body', [
        term('revisit', count(scope.highlightCount, 'moment')),
        t(` ${plural(scope.highlightCount, 'is', 'are')} worth revisiting`),
        ...(clauses.length > 0 ? [t(', including '), ...breakdown] : []),
        t('.'),
      ]),
    );
  }

  // ── Capture depth ──────────────────────────────────────────────────────
  if (scope.reviewItemCount > 0) {
    notes.push({
      id: 'capture-depth',
      facet: 'volume',
      label: 'What the replay captured',
      detail:
        'Every content-free moment the worker retained for these sessions. Routine pauses are timeline stops; flagged moments are the review queue.',
      citations: [
        `${count(scope.routineMomentCount, 'routine pause')}`,
        `${count(scope.highlightCount, 'flagged moment')}`,
      ],
    });
    paragraphs.push(
      paragraph('body', [
        t('The replay captured '),
        term('capture-depth', count(scope.reviewItemCount, 'moment')),
        t(
          scope.routineMomentCount > 0
            ? `: ${scope.routineMomentCount.toLocaleString()} routine ${plural(scope.routineMomentCount, 'pause')} on the timeline and ${scope.highlightCount.toLocaleString()} flagged for review.`
            : '.',
        ),
      ]),
    );
  }

  // ── Still running ──────────────────────────────────────────────────────
  if (scope.runningCount > 0) {
    notes.push({
      id: 'running',
      facet: 'live',
      label: 'Still running',
      detail:
        'These sessions have no end event yet, so their totals will keep moving. The replay reads what has arrived so far.',
      citations: [
        `${count(scope.runningCount, 'session')} still running`,
        `${count(scope.endedCount, 'session')} ended`,
      ],
    });
    paragraphs.push(
      paragraph('body', [
        scope.runningCount === scope.sessionCount
          ? t(
              scope.sessionCount === 1
                ? 'That session is '
                : 'All of these sessions are ',
            )
          : t(''),
        ...(scope.runningCount === scope.sessionCount
          ? [term('running', 'still running'), t('.')]
          : [
              term('running', count(scope.runningCount, 'session')),
              t(
                ` of ${scope.sessionCount.toLocaleString()} ${plural(scope.runningCount, 'is', 'are')} still running.`,
              ),
            ]),
      ]),
    );
  }

  // ── Elapsed and usage ──────────────────────────────────────────────────
  if (scope.totalDurationMs > 0) {
    notes.push({
      id: 'elapsed',
      facet: 'volume',
      label: 'Elapsed session time',
      detail:
        'Wall-clock time inside these sessions, summed. Concurrent sessions each count their own time, so this can exceed the period.',
      citations: [`${sessionsPhrase} in scope`],
    });
    paragraphs.push(
      paragraph('body', [
        term('elapsed', formatDuration(Math.round(scope.totalDurationMs / 60_000))),
        t(' of elapsed session time in this scope.'),
      ]),
    );
  }

  const usage: SummarySegment[][] = [];
  if (scope.toolCallCount > 0) {
    notes.push({
      id: 'tool-calls',
      facet: 'volume',
      label: 'Tool calls',
      detail: 'Every captured tool call across these sessions. The Tools lens breaks it down by tool.',
      citations: [`${count(scope.toolCallCount, 'tool call')}`],
    });
    usage.push([
      t('made '),
      term('tool-calls', count(scope.toolCallCount, 'tool call')),
    ]);
  }
  if (scope.tokensTotal > 0) {
    usage.push([t(`used ${formatTokens(scope.tokensTotal)} tokens`)]);
  }
  if (scope.promptCount > 0) {
    notes.push({
      id: 'steering',
      facet: 'volume',
      label: 'Messages to the agent',
      detail:
        'How many times you steered the run. Seorak counts the message envelopes only, never the prompt text.',
      citations: [`${count(scope.promptCount, 'message')} sent`],
    });
    usage.push([
      t('sent '),
      term('steering', count(scope.promptCount, 'message')),
      t(' to the agent'),
    ]);
  }
  if (scope.filesTouchedUncommitted > 0) {
    notes.push({
      id: 'uncommitted',
      facet: 'caveat',
      label: 'Uncommitted at session end',
      detail:
        'Distinct files still uncommitted when the session closed, from the session delta. Not a judgement. Sometimes that is exactly where you meant to stop.',
      citations: [`${count(scope.filesTouchedUncommitted, 'file')} uncommitted`],
    });
    usage.push([
      t('ended with '),
      term('uncommitted', count(scope.filesTouchedUncommitted, 'file')),
      t(' uncommitted'),
    ]);
  }

  if (usage.length > 0) {
    const segments: SummarySegment[] = [t('Across those sessions, you ')];
    usage.forEach((clause, index) => {
      if (index > 0) segments.push(t(index === usage.length - 1 ? ', and ' : ', '));
      segments.push(...clause);
    });
    segments.push(t('.'));
    paragraphs.push(paragraph('body', segments));
  }

  // ── Load caveat, only when something is missing ────────────────────────
  if (scope.errorCount > 0 || scope.emptyReplayCount > 0) {
    notes.push({
      id: 'load',
      facet: 'caveat',
      label: 'Incomplete read',
      detail:
        'Some sessions in scope did not return a replay, so the numbers above cover less than the whole scope.',
      citations: [
        scope.errorCount > 0 ? `${count(scope.errorCount, 'load error')}` : '',
        scope.emptyReplayCount > 0 ? `${count(scope.emptyReplayCount, 'empty replay')}` : '',
      ].filter(Boolean),
    });
    paragraphs.push(
      paragraph('body', [
        t('This read is '),
        term('load', 'incomplete'),
        t(': not every session in scope returned a replay.'),
      ]),
    );
  }

  return { paragraphs, notes };
}
