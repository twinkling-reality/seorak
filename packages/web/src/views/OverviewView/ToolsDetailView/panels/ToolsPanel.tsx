import { useMemo } from 'react';

import {
  FocusedDetailView,
  Metric,
  treemapQuestion,
  volumeQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { type HeroStatDef } from '../../../../components/viz/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import { perSessionAverage } from '../../../../lib/detail/index.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';

import {
  averageClause,
  count,
  countMetric,
  fmtCount,
  metric,
  windowPhrase,
} from '../../../../lib/voice/index.js';

import styles from '../ToolsDetailView.module.css';

/**
 * ToolsDetailView → ToolsPanel — the honest tool-mix view.
 *
 * `tools.callStats.totalCalls` is the only tools value derivable from current
 * session state — the sum of `toolCallCount` over resident sessions — and it
 * always renders. `tools.byTool[]` comes from the retained event log; it stays
 * empty until tool calls accrue (KV alone holds only a scalar count + the last
 * tool, so a per-tool split can't be reconstructed from it — never synthesized).
 * When `byTool` populates (or in demo mode), the per-tool breakdown renders,
 * laned built-in vs custom/MCP. Until then, only the total shows.
 */
export function ToolsPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const { byTool, callStats } = overview.tools;

  const tools = useMemo(
    () => [...byTool].filter((t) => t.calls > 0).sort((a, b) => b.calls - a.calls),
    [byTool],
  );
  const toolsTotal = tools.reduce((s, t) => s + t.calls, 0);

  if (callStats.totalCalls === 0 && tools.length === 0) {
    return (
      <span className={styles.empty}>
        No tool calls captured in {windowPhrase(overview.rangeDays)}.
      </span>
    );
  }

  // Volume hero: the total plus its per-session intensity — two DIFFERENT lenses
  // on the same number, not the face restated. A single-stat hero that just
  // repeats totalCalls (the tab face) would be a broken drill; per-session is the
  // finer read, so it rides the hero rather than a second thin question.
  const sessions = overview.usage.totals.sessions;
  const avgCalls = perSessionAverage(callStats.totalCalls, sessions);
  const perSession =
    avgCalls != null && callStats.totalCalls > 0 && sessions > 0
      ? Math.round(avgCalls * 10) / 10
      : null;

  const heroStats: HeroStatDef[] = [
    {
      key: 'total',
      value: fmtCount(callStats.totalCalls),
      label: 'tool calls',
    },
  ];
  if (perSession != null) {
    heroStats.push({
      key: 'per-session',
      value: String(perSession),
      label: 'per session',
    });
  }

  const perSessionClause =
    perSession != null ? averageClause({ n: sessions, per: metric(perSession) }) : null;

  // "How much tool work ran?" is answered by the per-tool breakdown: the bars
  // decompose the calls, so the magnitude AND which tools carried it read at
  // once. byTool comes from the event log, so a KV-only account (total known,
  // split not yet) falls back to the scalar hero rather than synthesizing a
  // split from the count.
  const questions: FocusedQuestion[] = [];

  if (tools.length > 0 && toolsTotal > 0) {
    const top = tools[0];
    // The "why is 'other' large" caveat, moved off the widget face (stat-only)
    // to here where there's room for it: Codex reports an open, dynamic tool
    // vocabulary that folds to the `other` bucket, so a large other share is a
    // naming limit, not a usage pattern. A visible `note` (a guard, not a
    // pointer — a reader who misses it misreads the mix), only when Codex ran.
    const hasCodex = overview.tools.byAgent.some((a) => a.agent === 'codex');
    questions.push(
      treemapQuestion({
        id: 'volume',
        question: 'How much tool work ran?',
        answer: (
          <>
            You made {countMetric(callStats.totalCalls, 'tool call')} over{' '}
            {windowPhrase(overview.rangeDays)}, and <Metric>{top.tool}</Metric> leads at{' '}
            <Metric>{Math.round((top.calls / toolsTotal) * 100)}%</Metric>.
          </>
        ),
        note: hasCodex
          ? 'Codex names only Shell and ApplyPatch; its other calls fold into “other”, so a large other share is a naming limit, not a usage pattern.'
          : undefined,
        // The tool set is unbounded (MCP servers add tools), so the whole mix
        // rides an area map: every tool is on it, no cap or residue, and the
        // leader's share (named in the answer) reads as the biggest tile.
        items: tools.map((t) => ({
          key: t.tool,
          label: t.tool,
          value: t.calls,
          valueLabel: count(t.calls, 'call'),
          title: `${t.tool}: ${count(t.calls, 'call')}`,
        })),
        ariaLabel: 'Tool calls by tool',
      }),
    );
  } else {
    questions.push(
      volumeQuestion({
        id: 'volume',
        question: 'How much tool work ran?',
        answer:
          perSession != null ? (
            <>
              You made {countMetric(callStats.totalCalls, 'tool call')} over{' '}
              {windowPhrase(overview.rangeDays)}
              {perSessionClause != null ? (
                <>
                  , {perSessionClause} across {countMetric(sessions, 'session')}
                </>
              ) : (
                <> across {countMetric(sessions, 'session')}</>
              )}
              .
            </>
          ) : (
            <>
              You made {countMetric(callStats.totalCalls, 'tool call')} over{' '}
              {windowPhrase(overview.rangeDays)}.
            </>
          ),
        stats: heroStats,
      }),
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
