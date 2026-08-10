import { useMemo } from 'react';

import {
  FocusedDetailView,
  Metric,
  distributionQuestion,
  rateQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot, VerificationRollup } from '../../../../lib/apiSchemas.js';
import { countMetric, fmtCount, plural } from '../../../../lib/voice/index.js';
import styles from '../ToolsDetailView.module.css';

/**
 * ToolsDetailView → ErrorsPanel — the quality surface.
 *
 *   - "errors": `tools.callStats.errorRate` (0..1, errored / calls that
 *     returned). Real now that the collector stamps `errored`; null until a call
 *     returns a boolean flag (honest "--", never a fabricated 0%).
 *   - "verification": `tools.verification` — FAILURES by kind, NOT a pass rate.
 *     On Claude Code a passing Bash run reports no exit signal and is excluded
 *     from the denominator, so passRate is structurally pinned at 0/null and is
 *     NEVER rendered as a pass rate (that would read as "0% of my checks passed").
 *     We surface how many checks FAILED, by kind, mirroring VerificationWidget.
 *
 * Both are real capture; the panel renders an honest empty only when neither has
 * landed yet.
 */
export function ErrorsPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const { callStats, verification } = overview.tools;
  const { errorRate } = callStats;

  const verRows = useMemo(
    () => [...verification].filter((v) => v.runs > 0),
    [verification],
  );

  const questions: FocusedQuestion[] = [];

  if (errorRate != null) {
    const pct = Math.round(errorRate * 100);
    questions.push(
      rateQuestion({
        id: 'top',
        question: 'How often do tool calls fail?',
        answer: (
          <>
            {/* Neutral ink, not an amber grade above some cutoff: there is no
                principled error-rate line (an 8% flip was a magic number), and the
                DotMatrix below carries no matching warn tone, so a tinted number
                would be a lone decoration. The rate reads as a fact, not a verdict. */}
            <Metric>{pct}%</Metric> of tool calls errored.
          </>
        ),
        rate: errorRate,
        // The widget face carries this rule only as a hover hint (the 2-row
        // stat card has no room for prose), so the drill is where the Codex
        // denominator gate is stated in visible text.
        note: overview.tools.byAgent.some((a) => a.agent === 'codex')
          ? 'Over the calls that returned a result. Codex reports results on shell calls only.'
          : 'Over the calls that returned a result.',
      }),
    );
  }

  if (verRows.length > 0) {
    // failed = result-returning runs that did NOT pass. On Claude Code passRate is
    // pinned at 0 (passes report no exit signal) so failed === runs; null when no
    // run of this kind returned a result. We never draw passRate as a pass %.
    const verFailures = verRows.map((v: VerificationRollup) => ({
      kind: v.kind,
      failed: v.passRate == null ? null : Math.round(v.runs * (1 - v.passRate)),
    }));
    const maxFailed = Math.max(1, ...verFailures.map((r) => r.failed ?? 0));
    const totalFailed = verFailures.reduce((s, r) => s + (r.failed ?? 0), 0);
    const anyMeasured = verFailures.some((r) => r.failed != null);
    questions.push(
      distributionQuestion({
        id: 'verification',
        question: 'Which checks failed?',
        answer: (
          <>
            {/* Neutral to match the deliberately-muted --soft failure bars below:
                the count is a fact, not an amber grade (its viz already forgoes a
                warn tint), so the number stays ink for the tone to tie to. */}
            <Metric tone="neutral">
              {anyMeasured ? fmtCount(totalFailed) : '--'}
            </Metric>{' '}
            verification {plural(totalFailed, 'check')} failed across{' '}
            {countMetric(verRows.length, 'kind')}.
          </>
        ),
        note: "Passing runs aren't separately reported, so this counts checks that failed, not a pass rate.",
        items: verFailures.map((r) => ({
          key: r.kind,
          label: r.kind,
          // Bar = relative failure count, a static metric: neutral --soft, never
          // --accent. null/zero renders an empty bar; the structural-zero passRate
          // is never drawn as a pass fill.
          fillPct: r.failed == null ? 0 : (r.failed / maxFailed) * 100,
          fillColor: 'var(--soft)',
          value: r.failed == null ? '--' : r.failed === 0 ? 'none failed' : `${r.failed} failed`,
        })),
      }),
    );
  }

  if (questions.length === 0) {
    return (
      <span className={styles.empty}>
        Error rate and verification fill in as tool calls and test/build runs report a result.
      </span>
    );
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}
